"""
Onboarding público para registro de nuevos CDA (tenant).
"""
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_db
from app.core.security import get_password_hash
from app.models.tenant import Tenant
from app.models.usuario import Usuario, RolEnum
from app.schemas.onboarding import TenantSelfRegisterRequest, TenantSelfRegisterResponse
from app.utils.captcha import verify_turnstile_token

router = APIRouter()


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


@router.post("/register-tenant", response_model=TenantSelfRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_tenant_self_service(
    request: Request,
    payload: TenantSelfRegisterRequest,
    db: Session = Depends(get_db),
):
    ip_address = get_client_ip(request)
    try:
        validate_onboarding_rate_limit(db, ip_address, payload.admin_email)
    except HTTPException as e:
        register_attempt(
            db=db,
            ip_address=ip_address,
            admin_email=payload.admin_email,
            tenant_nombre=payload.nombre_cda,
            successful=False,
            failure_reason="rate_limit",
        )
        raise e

    if settings.TURNSTILE_ENABLED:
        if not payload.captcha_token:
            register_attempt(
                db=db,
                ip_address=ip_address,
                admin_email=payload.admin_email,
                tenant_nombre=payload.nombre_cda,
                successful=False,
                failure_reason="captcha_missing",
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Captcha requerido para continuar",
            )

        captcha_ok, captcha_reason = verify_turnstile_token(payload.captcha_token, ip_address)
        if not captcha_ok:
            register_attempt(
                db=db,
                ip_address=ip_address,
                admin_email=payload.admin_email,
                tenant_nombre=payload.nombre_cda,
                successful=False,
                failure_reason="captcha_invalid",
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Captcha inválido: {captcha_reason}",
            )

    email_exists = db.query(Usuario).filter(Usuario.email == payload.admin_email).first()
    if email_exists:
        register_attempt(
            db=db,
            ip_address=ip_address,
            admin_email=payload.admin_email,
            tenant_nombre=payload.nombre_cda,
            successful=False,
            failure_reason="email_already_exists",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email del administrador ya está registrado",
        )

    tenant_slug = resolve_available_slug(db, payload.nombre_cda)
    tenant = Tenant(
        nombre=payload.nombre_cda,
        nombre_comercial=payload.nombre_cda,
        slug=tenant_slug,
        activo=True,
        logo_url=payload.logo_url,
    )
    db.add(tenant)
    db.flush()

    admin = Usuario(
        tenant_id=tenant.id,
        email=payload.admin_email,
        hashed_password=get_password_hash(payload.admin_password),
        nombre_completo=payload.admin_nombre_completo,
        rol=RolEnum.ADMINISTRADOR,
        activo=True,
    )
    db.add(admin)
    db.commit()

    register_attempt(
        db=db,
        ip_address=ip_address,
        admin_email=payload.admin_email,
        tenant_nombre=payload.nombre_cda,
        successful=True,
    )

    return TenantSelfRegisterResponse(
        tenant_id=str(tenant.id),
        tenant_slug=tenant.slug,
        admin_email=admin.email,
    )
