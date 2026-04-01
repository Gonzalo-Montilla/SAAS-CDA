"""
Onboarding público para registro de nuevos CDA (tenant).
"""
import re
import unicodedata
import uuid
import hashlib
import secrets
from pathlib import Path
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import EmailStr
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_db
from app.core.security import get_password_hash
from app.models.tenant import Tenant
from app.models.usuario import Usuario, RolEnum
from app.schemas.onboarding import (
    OnboardingSendCodeRequest,
    OnboardingSendCodeResponse,
    TenantSelfRegisterResponse,
)
from app.utils.captcha import verify_turnstile_token
from app.utils.email import (
    enviar_email,
    generar_email_bienvenida_tenant,
    generar_email_codigo_onboarding,
)

router = APIRouter()
ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    lowered = normalized.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug


def resolve_available_slug(db: Session, requested_name: str) -> str:
    base_slug = slugify(requested_name)
    if not base_slug:
        base_slug = "cda"

    slug = base_slug
    suffix = 2
    while db.query(Tenant).filter(Tenant.slug == slug).first():
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    return slug


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def register_attempt(
    db: Session,
    ip_address: str,
    admin_email: str,
    tenant_nombre: str,
    successful: bool,
    failure_reason: str | None = None,
):
    db.execute(
        text(
            """
            INSERT INTO onboarding_registration_attempts (
                ip_address,
                admin_email,
                tenant_nombre,
                successful,
                failure_reason,
                created_at
            )
            VALUES (:ip, :email, :tenant_nombre, :successful, :failure_reason, :created_at)
            """
        ),
        {
            "ip": ip_address,
            "email": admin_email.lower().strip(),
            "tenant_nombre": tenant_nombre,
            "successful": successful,
            "failure_reason": failure_reason,
            "created_at": utcnow_naive(),
        },
    )
    db.commit()


def validate_onboarding_rate_limit(db: Session, ip_address: str, admin_email: str):
    window_start = utcnow_naive() - timedelta(minutes=settings.ONBOARDING_RATE_LIMIT_WINDOW_MINUTES)
    normalized_email = admin_email.lower().strip()

    attempts_by_ip = db.execute(
        text(
            """
            SELECT COUNT(1)
            FROM onboarding_registration_attempts
            WHERE ip_address = :ip_address
              AND created_at >= :window_start
            """
        ),
        {"ip_address": ip_address, "window_start": window_start},
    ).scalar() or 0

    if attempts_by_ip >= settings.ONBOARDING_RATE_LIMIT_MAX_ATTEMPTS_IP:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos desde esta IP. Intenta más tarde.",
        )

    attempts_by_email = db.execute(
        text(
            """
            SELECT COUNT(1)
            FROM onboarding_registration_attempts
            WHERE admin_email = :admin_email
              AND created_at >= :window_start
            """
        ),
        {"admin_email": normalized_email, "window_start": window_start},
    ).scalar() or 0

    if attempts_by_email >= settings.ONBOARDING_RATE_LIMIT_MAX_ATTEMPTS_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos para este correo. Intenta más tarde.",
        )


def normalize_nit(nit_raw: str) -> str:
    return re.sub(r"[^0-9A-Za-z-]", "", nit_raw).strip().upper()


def normalize_phone(phone_raw: str) -> str:
    return re.sub(r"[^\d+]", "", phone_raw).strip()


def build_email_code_hash(email: str, code: str) -> str:
    seed = f"{email.strip().lower()}:{code}:{settings.SECRET_KEY}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def generate_email_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def save_email_verification_code(db: Session, email: str, code_hash: str, expires_at: datetime):
    db.execute(
        text(
            """
            INSERT INTO onboarding_email_verifications (
                email,
                code_hash,
                expires_at,
                attempts,
                verified,
                created_at,
                updated_at
            )
            VALUES (
                :email,
                :code_hash,
                :expires_at,
                0,
                FALSE,
                :now_ts,
                :now_ts
            )
            ON CONFLICT (email)
            DO UPDATE SET
                code_hash = EXCLUDED.code_hash,
                expires_at = EXCLUDED.expires_at,
                attempts = 0,
                verified = FALSE,
                verified_at = NULL,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "email": email.strip().lower(),
            "code_hash": code_hash,
            "expires_at": expires_at,
            "now_ts": utcnow_naive(),
        },
    )
    db.commit()


def validate_email_verification_code(db: Session, email: str, code: str):
    verification_row = db.execute(
        text(
            """
            SELECT code_hash, expires_at, attempts, verified
            FROM onboarding_email_verifications
            WHERE email = :email
            """
        ),
        {"email": email.strip().lower()},
    ).mappings().first()

    if not verification_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Primero solicita el código de verificación de correo",
        )

    if verification_row["verified"]:
        return

    now_ts = utcnow_naive()
    if verification_row["expires_at"] < now_ts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código de verificación expiró. Solicita uno nuevo",
        )

    if verification_row["attempts"] >= settings.ONBOARDING_EMAIL_CODE_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Superaste los intentos permitidos para el código. Solicita uno nuevo",
        )

    expected_hash = build_email_code_hash(email, code.strip())
    if expected_hash != verification_row["code_hash"]:
        db.execute(
            text(
                """
                UPDATE onboarding_email_verifications
                SET attempts = attempts + 1,
                    updated_at = :updated_at
                WHERE email = :email
                """
            ),
            {"email": email.strip().lower(), "updated_at": now_ts},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de verificación inválido",
        )

    db.execute(
        text(
            """
            UPDATE onboarding_email_verifications
            SET verified = TRUE,
                verified_at = :verified_at,
                updated_at = :verified_at
            WHERE email = :email
            """
        ),
        {"email": email.strip().lower(), "verified_at": now_ts},
    )
    db.commit()


def save_logo_upload(logo_file: UploadFile) -> str:
    extension = Path(logo_file.filename or "").suffix.lower()
    if extension not in ALLOWED_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de logo no permitido. Usa PNG, JPG, JPEG o WEBP",
        )

    upload_dir = Path(settings.TENANT_LOGO_UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_name = f"{uuid.uuid4().hex}{extension}"
    destination = upload_dir / file_name
    content = logo_file.file.read()
    max_bytes = settings.TENANT_LOGO_MAX_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El logo supera el límite de {settings.TENANT_LOGO_MAX_SIZE_MB}MB",
        )
    with open(destination, "wb") as f:
        f.write(content)

    relative_url = f"/uploads/tenant-logos/{file_name}"
    return f"{settings.BACKEND_PUBLIC_BASE_URL.rstrip('/')}{relative_url}"


@router.post("/send-email-code", response_model=OnboardingSendCodeResponse)
def send_onboarding_email_code(
    payload: OnboardingSendCodeRequest,
    db: Session = Depends(get_db),
):
    normalized_email = payload.correo_electronico.strip().lower()
    existing_user = db.query(Usuario).filter(Usuario.email == normalized_email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El correo electrónico ya está registrado",
        )

    code = generate_email_code()
    code_hash = build_email_code_hash(normalized_email, code)
    expires_at = utcnow_naive() + timedelta(minutes=settings.ONBOARDING_EMAIL_CODE_TTL_MINUTES)

    save_email_verification_code(db, normalized_email, code_hash, expires_at)

    email_html = generar_email_codigo_onboarding(payload.nombre_cda, code)
    email_sent = enviar_email(
        destinatario=normalized_email,
        asunto=f"{payload.nombre_cda} - Código de verificación para crear tu CDA",
        cuerpo_html=email_html,
    )
    if not email_sent:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo enviar el código de verificación. Intenta nuevamente",
        )

    return OnboardingSendCodeResponse(message="Código enviado al correo electrónico")


@router.post("/register-tenant", response_model=TenantSelfRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_tenant_self_service(
    request: Request,
    nombre_cda: str = Form(...),
    nit_cda: str = Form(...),
    correo_electronico: EmailStr = Form(...),
    nombre_representante_legal_o_administrador: str = Form(...),
    celular: str = Form(...),
    sedes_totales: int = Form(1),
    admin_password: str = Form(...),
    codigo_verificacion_email: str | None = Form(default=None),
    logo_url: str | None = Form(default=None),
    captcha_token: str | None = Form(default=None),
    logo_file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
):
    normalized_email = correo_electronico.strip().lower()
    normalized_nit = normalize_nit(nit_cda)
    normalized_phone = normalize_phone(celular)

    if len(normalized_nit) < 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="NIT del CDA inválido")
    if len(normalized_phone) < 7:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Celular inválido")
    if sedes_totales < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sedes_totales debe ser mayor o igual a 1")
    if sedes_totales > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sedes_totales no puede ser mayor a 100")
    if len(admin_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña debe tener al menos 6 caracteres")
    if not logo_url and logo_file is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes enviar logo_url o subir logo_file",
        )
    if settings.ONBOARDING_EMAIL_VERIFICATION_REQUIRED:
        if not codigo_verificacion_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes ingresar el código de verificación enviado al correo",
            )
        validate_email_verification_code(db, normalized_email, codigo_verificacion_email)

    ip_address = get_client_ip(request)
    try:
        validate_onboarding_rate_limit(db, ip_address, normalized_email)
    except HTTPException as e:
        register_attempt(
            db=db,
            ip_address=ip_address,
            admin_email=normalized_email,
            tenant_nombre=nombre_cda,
            successful=False,
            failure_reason="rate_limit",
        )
        raise e

    if settings.TURNSTILE_ENABLED:
        if not captcha_token:
            register_attempt(
                db=db,
                ip_address=ip_address,
                admin_email=normalized_email,
                tenant_nombre=nombre_cda,
                successful=False,
                failure_reason="captcha_missing",
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Captcha requerido para continuar",
            )

        captcha_ok, captcha_reason = verify_turnstile_token(captcha_token, ip_address)
        if not captcha_ok:
            register_attempt(
                db=db,
                ip_address=ip_address,
                admin_email=normalized_email,
                tenant_nombre=nombre_cda,
                successful=False,
                failure_reason="captcha_invalid",
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Captcha inválido: {captcha_reason}",
            )

    email_exists = db.query(Usuario).filter(Usuario.email == normalized_email).first()
    if email_exists:
        register_attempt(
            db=db,
            ip_address=ip_address,
            admin_email=normalized_email,
            tenant_nombre=nombre_cda,
            successful=False,
            failure_reason="email_already_exists",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email del administrador ya está registrado",
        )

    nit_exists = db.query(Tenant).filter(Tenant.nit_cda == normalized_nit).first()
    if nit_exists:
        register_attempt(
            db=db,
            ip_address=ip_address,
            admin_email=normalized_email,
            tenant_nombre=nombre_cda,
            successful=False,
            failure_reason="nit_already_exists",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El NIT del CDA ya está registrado",
        )

    resolved_logo_url = logo_url
    if logo_file is not None:
        resolved_logo_url = save_logo_upload(logo_file)

    tenant_slug = resolve_available_slug(db, nombre_cda)
    tenant = Tenant(
        nombre=nombre_cda,
        nombre_comercial=nombre_cda,
        nit_cda=normalized_nit,
        correo_electronico=normalized_email,
        nombre_representante=nombre_representante_legal_o_administrador.strip(),
        celular=normalized_phone,
        slug=tenant_slug,
        activo=True,
        logo_url=resolved_logo_url,
        plan_actual="demo",
        subscription_status="trial",
        sedes_totales=sedes_totales,
        plan_started_at=utcnow_naive(),
        demo_ends_at=utcnow_naive() + timedelta(days=15),
        billing_cycle_days=15,
        next_billing_at=utcnow_naive() + timedelta(days=15),
    )
    db.add(tenant)
    db.flush()

    admin = Usuario(
        tenant_id=tenant.id,
        email=normalized_email,
        hashed_password=get_password_hash(admin_password),
        nombre_completo=nombre_representante_legal_o_administrador.strip(),
        rol=RolEnum.ADMINISTRADOR,
        activo=True,
    )
    db.add(admin)
    db.commit()

    register_attempt(
        db=db,
        ip_address=ip_address,
        admin_email=normalized_email,
        tenant_nombre=nombre_cda,
        successful=True,
    )
    login_url = f"{settings.FRONTEND_URL.rstrip('/')}/{tenant.slug}"
    welcome_html = generar_email_bienvenida_tenant(
        nombre_cda=nombre_cda,
        nombre_admin=nombre_representante_legal_o_administrador.strip(),
        login_url=login_url,
    )
    # Mejor esfuerzo: no bloqueamos onboarding si el proveedor SMTP falla.
    enviar_email(
        destinatario=normalized_email,
        asunto=f"{nombre_cda} - Tu CDA fue creado",
        cuerpo_html=welcome_html,
    )

    return TenantSelfRegisterResponse(
        tenant_id=str(tenant.id),
        tenant_slug=tenant.slug,
        admin_email=admin.email,
        login_url=login_url,
    )
