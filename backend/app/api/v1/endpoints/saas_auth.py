"""
Endpoints de autenticación global SaaS (backoffice).
"""
from datetime import datetime, timedelta, timezone
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, aliased
from uuid import UUID

from app.core.deps import (
    get_db,
    get_current_saas_user,
    get_saas_owner,
    require_saas_role,
)
from app.core.config import settings
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.models.audit_log import AuditLog
from app.models.saas_user import SaaSUser
from app.models.support_ticket import SaaSSupportTicket
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.schemas.auth import Token, RefreshTokenRequest
from app.schemas.saas_auth import SaaSUserCreate, SaaSUserResponse
from app.utils.email import enviar_email_con_adjuntos, generar_email_recibo_pago_saas
from app.utils.saas_billing_receipts import build_saas_payment_receipt_pdf

router = APIRouter()


ALLOWED_GLOBAL_ROLES = {"owner", "finanzas", "comercial", "soporte"}
GLOBAL_ROLE_PERMISSIONS = {
    "owner": ["tenants:read", "tenants:write", "billing:read", "billing:write", "support:read", "support:write", "audit:read", "users:manage"],
    "finanzas": ["billing:read", "billing:write", "audit:read"],
    "comercial": ["tenants:read", "tenants:write", "billing:read"],
    "soporte": ["support:read", "support:write", "tenants:read", "audit:read"],
}
MFA_REQUIRED_ROLES = {"owner", "finanzas"}
SUPPORT_PRIORITIES = {"baja", "media", "alta", "critica"}
SUPPORT_STATUSES = {"abierto", "en_progreso", "resuelto", "cerrado"}
IVA_RATE = 0.19
PLAN_DEFINITIONS = {
    "demo": {
        "label": "DEMO",
        "duration_days": 15,
        "base_price": 0.0,
        "additional_branch_price": 0.0,
        "included_branches": 1,  # 1 sede principal + 1 sucursal incluida
        "is_prepay": False,
    },
    "basico": {
        "label": "BÁSICO",
        "duration_days": 90,
        "base_price": 450000.0,
        "additional_branch_price": 250000.0,
        "included_branches": 1,
        "is_prepay": True,
    },
    "emprendedor": {
        "label": "EMPRENDEDOR",
        "duration_days": 180,
        "base_price": 850000.0,
        "additional_branch_price": 450000.0,
        "included_branches": 1,
        "is_prepay": True,
    },
    "empresa": {
        "label": "EMPRESA",
        "duration_days": 365,
        "base_price": 1500000.0,
        "additional_branch_price": 650000.0,
        "included_branches": 1,
        "is_prepay": True,
    },
}


class SaaSTenantSummary(BaseModel):
    id: str
    slug: str
    nombre: str
    nombre_comercial: str
    logo_url: str | None = None
    nit_cda: str | None = None
    correo_electronico: str | None = None
    nombre_representante: str | None = None
    celular: str | None = None
    plan_actual: str
    subscription_status: str
    sedes_totales: int
    sucursales_facturables: int
    sucursales_incluidas: int
    plan_ends_at: datetime | None = None
    demo_ends_at: datetime | None = None
    billing_cycle_days: int
    next_billing_at: datetime | None = None
    last_payment_at: datetime | None = None
    activo: bool
    login_url: str


class SaaSTenantUserSummary(BaseModel):
    id: str
    email: str
    nombre_completo: str
    rol: str
    activo: bool
    created_at: datetime


class SaaSTenantProfile(SaaSTenantSummary):
    total_usuarios: int
    usuarios_recientes: list[SaaSTenantUserSummary]


class SaaSAuditLogItem(BaseModel):
    id: str
    action: str
    description: str
    usuario_email: str | None = None
    usuario_nombre: str | None = None
    success: str
    ip_address: str | None = None
    tenant_slug: str | None = None
    created_at: datetime


class SaaSSecuritySummary(BaseModel):
    current_user_email: str
    current_user_role: str
    current_session_version: int
    mfa_enabled: bool
    total_saas_users: int
    active_saas_users: int
    locked_saas_users: int
    mfa_enabled_users: int


class SaaSUserSecurityItem(BaseModel):
    id: str
    email: str
    nombre_completo: str
    rol_global: str
    activo: bool
    mfa_enabled: bool
    intentos_fallidos: int
    bloqueado_hasta: datetime | None = None
    session_version: int


class SaaSSupportTicketItem(BaseModel):
    id: str
    tenant_id: str
    tenant_slug: str
    tenant_nombre: str
    title: str
    description: str
    category: str
    priority: str
    status: str
    assigned_to_user_id: str | None = None
    assigned_to_user_email: str | None = None
    created_by_user_id: str | None = None
    created_by_user_email: str | None = None
    internal_notes: str | None = None
    tenant_response_message: str | None = None
    tenant_responded_at: datetime | None = None
    sla_due_at: datetime | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None


class SaaSSupportTicketCreateRequest(BaseModel):
    tenant_id: str
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=8, max_length=4000)
    category: str = Field(default="general", max_length=40)
    priority: str = Field(default="media")
    sla_due_at: datetime | None = None


class SaaSSupportTicketUpdateRequest(BaseModel):
    status: str | None = None
    priority: str | None = None
    assigned_to_user_id: str | None = None
    internal_notes: str | None = Field(default=None, max_length=4000)
    tenant_response_message: str | None = Field(default=None, max_length=4000)


class SaaSSupportSummary(BaseModel):
    total_tickets: int
    abiertos: int
    en_progreso: int
    sin_resolver: int
    criticos_abiertos: int
    notificaciones_pendientes: int


class SaaSBillingPlanItem(BaseModel):
    code: str
    label: str
    duration_days: int
    base_price: float
    additional_branch_price: float
    included_branches: int
    iva_rate: float
    is_prepay: bool


class SaaSTenantBillingQuote(BaseModel):
    tenant_id: str
    tenant_slug: str
    plan_code: str
    plan_label: str
    sedes_totales: int
    included_branches: int
    chargeable_additional_branches: int
    subtotal: float
    iva: float
    total: float
    period_days: int


class SaaSAssignPlanRequest(BaseModel):
    plan_code: str
    sedes_totales: int = 1


class SaaSRegisterPaymentRequest(BaseModel):
    amount: float = Field(gt=0)
    paid_at: datetime | None = None
    notes: str | None = None


class SaaSPaymentRegisteredResponse(BaseModel):
    tenant_id: str
    tenant_slug: str
    plan_code: str
    plan_label: str
    amount: float
    paid_at: datetime
    sedes_totales: int
    sucursales_incluidas: int
    sucursales_facturables: int
    period_days: int
    comprobante_referencia: str
    payment_log_id: str
    receipt_download_url: str
    receipt_email_sent: bool
    next_billing_at: datetime | None = None
    subscription_status: str


class SaaSBillingOverviewItem(BaseModel):
    tenant_id: str
    tenant_slug: str
    tenant_nombre: str
    plan_code: str
    plan_label: str
    subscription_status: str
    cobro_status: str
    sedes_totales: int
    sucursales_facturables: int
    next_billing_at: datetime | None = None
    last_payment_at: datetime | None = None
    last_payment_amount: float | None = None
    last_receipt_reference: str | None = None
    last_payment_log_id: str | None = None


class SaaSPaymentHistoryItem(BaseModel):
    id: str
    tenant_id: str
    tenant_slug: str
    amount: float
    paid_at: datetime
    next_billing_at: datetime | None = None
    plan_code: str | None = None
    plan_label: str | None = None
    sedes_totales: int | None = None
    sucursales_facturables: int | None = None
    comprobante_referencia: str | None = None
    payment_log_id: str
    receipt_download_url: str
    actor_email: str | None = None
    notes: str | None = None


def validate_saas_password(password: str):
    if len(password) < 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña debe tener mínimo 10 caracteres")
    if not any(c.isupper() for c in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña debe incluir al menos una mayúscula")
    if not any(c.islower() for c in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña debe incluir al menos una minúscula")
    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña debe incluir al menos un número")
    if not any(c in "!@#$%^&*()-_=+[]{};:,.?/|" for c in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña debe incluir al menos un carácter especial")


def calculate_plan_quote(plan_code: str, sedes_totales: int) -> tuple[dict, int, float, float, float]:
    normalized_code = plan_code.strip().lower()
    if normalized_code not in PLAN_DEFINITIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan inválido")
    if sedes_totales < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sedes_totales debe ser mayor o igual a 1")

    plan = PLAN_DEFINITIONS[normalized_code]
    # 1 sede principal + 1 sucursal incluida. Cobro desde la 3ra sede total.
    chargeable_additional = max(sedes_totales - (1 + plan["included_branches"]), 0)
    subtotal = plan["base_price"] + (chargeable_additional * plan["additional_branch_price"])
    iva = round(subtotal * IVA_RATE, 2)
    total = round(subtotal + iva, 2)
    return plan, chargeable_additional, round(subtotal, 2), iva, total


def calculate_chargeable_branches_for_tenant(plan_code: str, sedes_totales: int) -> tuple[int, int]:
    normalized_code = (plan_code or "demo").strip().lower()
    plan = PLAN_DEFINITIONS.get(normalized_code, PLAN_DEFINITIONS["demo"])
    included_branches = int(plan["included_branches"])
    chargeable_additional = max(int(sedes_totales) - (1 + included_branches), 0)
    return chargeable_additional, included_branches


def sync_expired_demo_tenants(db: Session) -> None:
    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)
    expired_demo_tenants = (
        db.query(Tenant)
        .filter(Tenant.plan_actual == "demo")
        .filter(Tenant.subscription_status == "trial")
        .filter(Tenant.demo_ends_at.isnot(None))
        .filter(Tenant.demo_ends_at < now_ts)
        .all()
    )
    if not expired_demo_tenants:
        return
    for tenant in expired_demo_tenants:
        tenant.subscription_status = "pending_plan"

    overdue_paid_tenants = (
        db.query(Tenant)
        .filter(Tenant.plan_actual != "demo")
        .filter(Tenant.subscription_status == "active")
        .filter(Tenant.next_billing_at.isnot(None))
        .filter(Tenant.next_billing_at < now_ts)
        .all()
    )
    for tenant in overdue_paid_tenants:
        tenant.subscription_status = "past_due"
    db.commit()


def get_cobro_status(subscription_status: str, next_billing_at: datetime | None) -> str:
    if subscription_status in {"pending_plan", "canceled"}:
        return "bloqueado"
    if subscription_status == "trial":
        return "trial"
    if not next_billing_at:
        return "sin_fecha"
    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)
    if next_billing_at < now_ts:
        return "vencido"
    if next_billing_at <= (now_ts + timedelta(days=5)):
        return "por_vencer"
    return "al_dia"


def extract_payment_metadata(log: AuditLog) -> dict:
    data = log.extra_data if isinstance(log.extra_data, dict) else {}
    return data or {}


def create_saas_audit_log(
    db: Session,
    action: str,
    description: str,
    actor: SaaSUser | None = None,
    request: Request | None = None,
    metadata: dict | None = None,
    success: str = "success",
    actor_email_override: str | None = None,
):
    ip_address = None
    user_agent = None
    if request:
        forwarded = request.headers.get("X-Forwarded-For")
        ip_address = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
        user_agent = request.headers.get("User-Agent")

    log = AuditLog(
        action=action,
        description=description,
        usuario_id=actor.id if actor else None,
        usuario_email=actor.email if actor else actor_email_override,
        usuario_nombre=actor.nombre_completo if actor else None,
        usuario_rol=actor.rol_global if actor else None,
        ip_address=ip_address,
        user_agent=user_agent,
        extra_data=metadata,
        success=success,
    )
    db.add(log)
    db.commit()
    return log


def validate_support_priority(priority: str) -> str:
    normalized = (priority or "").strip().lower()
    if normalized not in SUPPORT_PRIORITIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Prioridad inválida. Usa: {', '.join(sorted(SUPPORT_PRIORITIES))}",
        )
    return normalized


def validate_support_status(ticket_status: str) -> str:
    normalized = (ticket_status or "").strip().lower()
    if normalized not in SUPPORT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Estado inválido. Usa: {', '.join(sorted(SUPPORT_STATUSES))}",
        )
    return normalized


def map_support_ticket_row(
    ticket: SaaSSupportTicket,
    tenant_slug: str,
    tenant_name: str,
    assigned_email: str | None,
    created_email: str | None,
) -> SaaSSupportTicketItem:
    return SaaSSupportTicketItem(
        id=str(ticket.id),
        tenant_id=str(ticket.tenant_id),
        tenant_slug=tenant_slug,
        tenant_nombre=tenant_name,
        title=ticket.title,
        description=ticket.description,
        category=ticket.category,
        priority=ticket.priority,
        status=ticket.status,
        assigned_to_user_id=str(ticket.assigned_to_saas_user_id) if ticket.assigned_to_saas_user_id else None,
        assigned_to_user_email=assigned_email,
        created_by_user_id=str(ticket.created_by_saas_user_id) if ticket.created_by_saas_user_id else None,
        created_by_user_email=created_email,
        internal_notes=ticket.internal_notes,
        tenant_response_message=ticket.tenant_response_message,
        tenant_responded_at=ticket.tenant_responded_at,
        sla_due_at=ticket.sla_due_at,
        resolved_at=ticket.resolved_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


@router.post("/login", response_model=Token)
def saas_login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(SaaSUser).filter(SaaSUser.email == form_data.username).first()
    if not user:
        create_saas_audit_log(
            db=db,
            action="saas_failed_login",
            description="Intento fallido de login SaaS: usuario no encontrado",
            request=request,
            success="failed",
            actor_email_override=form_data.username,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.bloqueado_hasta and user.bloqueado_hasta > datetime.now(timezone.utc):
        create_saas_audit_log(
            db=db,
            action="saas_failed_login",
            description="Intento de login SaaS en usuario bloqueado",
            request=request,
            success="failed",
            actor=user,
        )
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Usuario global bloqueado temporalmente",
        )

    if not verify_password(form_data.password, user.hashed_password):
        user.intentos_fallidos += 1
        if user.intentos_fallidos >= 5:
            # Lockout básico para backoffice global (15 minutos).
            from datetime import timedelta
            user.bloqueado_hasta = datetime.now(timezone.utc) + timedelta(minutes=15)
            user.intentos_fallidos = 0
        db.commit()
        create_saas_audit_log(
            db=db,
            action="saas_failed_login",
            description="Intento fallido de login SaaS: contraseña incorrecta",
            request=request,
            success="failed",
            actor=user,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.activo:
        create_saas_audit_log(
            db=db,
            action="saas_failed_login",
            description="Intento de login SaaS en usuario inactivo",
            request=request,
            success="failed",
            actor=user,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario global inactivo",
        )

    if user.rol_global in MFA_REQUIRED_ROLES and not user.mfa_enabled:
        # Bootstrap seguro para owner inicial ya existente en entornos previos.
        if user.email == settings.SAAS_OWNER_EMAIL and user.rol_global == "owner":
            user.mfa_enabled = True
            db.commit()
        else:
            create_saas_audit_log(
                db=db,
                action="saas_mfa_required_block",
                description="Login SaaS bloqueado por política MFA obligatoria",
                request=request,
                success="failed",
                actor=user,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="MFA obligatorio para este rol. Contacta a un owner para activarlo.",
            )

    user.intentos_fallidos = 0
    user.bloqueado_hasta = None
    db.commit()
    create_saas_audit_log(
        db=db,
        action="saas_login",
        description="Login SaaS exitoso",
        request=request,
        actor=user,
    )

    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "rol_global": user.rol_global,
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )
    refresh_token = create_refresh_token(
        data={
            "sub": str(user.id),
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/refresh", response_model=Token)
def saas_refresh_token(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    payload = decode_token(request.refresh_token)
    if payload is None or payload.get("type") != "refresh" or payload.get("auth_scope") != "saas":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    user_id = payload.get("sub")
    token_session_version = payload.get("session_version")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    try:
        user_uuid = UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    user = db.query(SaaSUser).filter(SaaSUser.id == user_uuid).first()
    if not user or not user.activo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario global no encontrado o inactivo",
        )

    if token_session_version is not None and user.session_version != token_session_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión global invalidada",
        )

    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "rol_global": user.rol_global,
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )
    refresh_token = create_refresh_token(
        data={
            "sub": str(user.id),
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )

    return Token(access_token=access_token, refresh_token=refresh_token, token_type="bearer")


@router.get("/me", response_model=SaaSUserResponse)
def saas_me(current_user: SaaSUser = Depends(get_current_saas_user)):
    return current_user


@router.get("/permissions/me")
def saas_my_permissions(current_user: SaaSUser = Depends(get_current_saas_user)):
    return {
        "role": current_user.rol_global,
        "permissions": GLOBAL_ROLE_PERMISSIONS.get(current_user.rol_global, []),
    }


@router.get("/tenants", response_model=list[SaaSTenantSummary])
def list_saas_tenants(
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    from app.models.tenant import Tenant

    sync_expired_demo_tenants(db)
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    base_url = settings.FRONTEND_URL.rstrip("/")

    return [
        SaaSTenantSummary(
            id=str(tenant.id),
            slug=tenant.slug,
            nombre=tenant.nombre,
            nombre_comercial=tenant.nombre_comercial,
            logo_url=tenant.logo_url,
            nit_cda=tenant.nit_cda,
            correo_electronico=tenant.correo_electronico,
            nombre_representante=tenant.nombre_representante,
            celular=tenant.celular,
            plan_actual=tenant.plan_actual,
            subscription_status=tenant.subscription_status,
            sedes_totales=tenant.sedes_totales,
            sucursales_facturables=calculate_chargeable_branches_for_tenant(tenant.plan_actual, tenant.sedes_totales)[0],
            sucursales_incluidas=calculate_chargeable_branches_for_tenant(tenant.plan_actual, tenant.sedes_totales)[1],
            plan_ends_at=tenant.plan_ends_at,
            demo_ends_at=tenant.demo_ends_at,
            billing_cycle_days=tenant.billing_cycle_days,
            next_billing_at=tenant.next_billing_at,
            last_payment_at=tenant.last_payment_at,
            activo=tenant.activo,
            login_url=f"{base_url}/{tenant.slug}",
        )
        for tenant in tenants
    ]


@router.get("/tenants/{tenant_id}", response_model=SaaSTenantProfile)
def get_saas_tenant_profile(
    tenant_id: str,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    from app.models.tenant import Tenant
    from app.models.usuario import Usuario

    sync_expired_demo_tenants(db)
    try:
        tenant_uuid = UUID(tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID de tenant inválido",
        )

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado",
        )

    recent_users = (
        db.query(Usuario)
        .filter(Usuario.tenant_id == tenant_uuid)
        .order_by(Usuario.created_at.desc())
        .limit(5)
        .all()
    )
    total_users = db.query(Usuario).filter(Usuario.tenant_id == tenant_uuid).count()
    base_url = settings.FRONTEND_URL.rstrip("/")

    return SaaSTenantProfile(
        id=str(tenant.id),
        slug=tenant.slug,
        nombre=tenant.nombre,
        nombre_comercial=tenant.nombre_comercial,
        logo_url=tenant.logo_url,
        nit_cda=tenant.nit_cda,
        correo_electronico=tenant.correo_electronico,
        nombre_representante=tenant.nombre_representante,
        celular=tenant.celular,
        plan_actual=tenant.plan_actual,
        subscription_status=tenant.subscription_status,
        sedes_totales=tenant.sedes_totales,
        sucursales_facturables=calculate_chargeable_branches_for_tenant(tenant.plan_actual, tenant.sedes_totales)[0],
        sucursales_incluidas=calculate_chargeable_branches_for_tenant(tenant.plan_actual, tenant.sedes_totales)[1],
        plan_ends_at=tenant.plan_ends_at,
        demo_ends_at=tenant.demo_ends_at,
        billing_cycle_days=tenant.billing_cycle_days,
        next_billing_at=tenant.next_billing_at,
        last_payment_at=tenant.last_payment_at,
        activo=tenant.activo,
        login_url=f"{base_url}/{tenant.slug}",
        total_usuarios=total_users,
        usuarios_recientes=[
            SaaSTenantUserSummary(
                id=str(u.id),
                email=u.email,
                nombre_completo=u.nombre_completo,
                rol=str(u.rol.value if hasattr(u.rol, "value") else u.rol),
                activo=u.activo,
                created_at=u.created_at,
            )
            for u in recent_users
        ],
    )


@router.get("/billing/plans", response_model=list[SaaSBillingPlanItem])
def list_billing_plans(
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    return [
        SaaSBillingPlanItem(
            code=code,
            label=plan["label"],
            duration_days=plan["duration_days"],
            base_price=plan["base_price"],
            additional_branch_price=plan["additional_branch_price"],
            included_branches=plan["included_branches"],
            iva_rate=IVA_RATE,
            is_prepay=plan["is_prepay"],
        )
        for code, plan in PLAN_DEFINITIONS.items()
    ]


@router.get("/billing/quote/{tenant_id}", response_model=SaaSTenantBillingQuote)
def get_tenant_billing_quote(
    tenant_id: str,
    plan_code: str,
    sedes_totales: int = 1,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial"])),
):
    try:
        tenant_uuid = UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    plan, chargeable_additional, subtotal, iva, total = calculate_plan_quote(plan_code, sedes_totales)
    return SaaSTenantBillingQuote(
        tenant_id=str(tenant.id),
        tenant_slug=tenant.slug,
        plan_code=plan_code.strip().lower(),
        plan_label=plan["label"],
        sedes_totales=sedes_totales,
        included_branches=plan["included_branches"],
        chargeable_additional_branches=chargeable_additional,
        subtotal=subtotal,
        iva=iva,
        total=total,
        period_days=plan["duration_days"],
    )


@router.post("/billing/assign-plan/{tenant_id}", response_model=SaaSTenantBillingQuote)
def assign_tenant_plan(
    tenant_id: str,
    payload: SaaSAssignPlanRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial"])),
):
    try:
        tenant_uuid = UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    plan_code = payload.plan_code.strip().lower()
    plan, chargeable_additional, subtotal, iva, total = calculate_plan_quote(plan_code, payload.sedes_totales)
    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)
    period_end = now_ts + timedelta(days=plan["duration_days"])

    tenant.plan_actual = plan_code
    tenant.sedes_totales = payload.sedes_totales
    tenant.plan_started_at = now_ts
    tenant.plan_ends_at = None if plan_code == "demo" else period_end
    tenant.demo_ends_at = period_end if plan_code == "demo" else tenant.demo_ends_at
    tenant.billing_cycle_days = plan["duration_days"]
    tenant.next_billing_at = period_end
    if plan_code == "demo":
        tenant.subscription_status = "trial"
    else:
        tenant.subscription_status = "active"
    db.commit()

    create_saas_audit_log(
        db=db,
        action="saas_assign_plan",
        description=f"Plan {plan_code} asignado a tenant {tenant.slug}",
        actor=current_user,
        request=request,
        metadata={
            "tenant_id": str(tenant.id),
            "tenant_slug": tenant.slug,
            "plan_code": plan_code,
            "sedes_totales": payload.sedes_totales,
            "subtotal": subtotal,
            "iva": iva,
            "total": total,
        },
    )

    return SaaSTenantBillingQuote(
        tenant_id=str(tenant.id),
        tenant_slug=tenant.slug,
        plan_code=plan_code,
        plan_label=plan["label"],
        sedes_totales=payload.sedes_totales,
        included_branches=plan["included_branches"],
        chargeable_additional_branches=chargeable_additional,
        subtotal=subtotal,
        iva=iva,
        total=total,
        period_days=plan["duration_days"],
    )


@router.post("/billing/register-payment/{tenant_id}", response_model=SaaSPaymentRegisteredResponse)
def register_tenant_payment(
    tenant_id: str,
    payload: SaaSRegisterPaymentRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "finanzas"])),
):
    try:
        tenant_uuid = UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    paid_at = payload.paid_at or datetime.now(timezone.utc).replace(tzinfo=None)
    cycle_days = tenant.billing_cycle_days or 30
    next_billing_at = paid_at + timedelta(days=cycle_days)
    plan_code = (tenant.plan_actual or "demo").strip().lower()
    plan = PLAN_DEFINITIONS.get(plan_code, PLAN_DEFINITIONS["demo"])
    chargeable_additional, included_branches = calculate_chargeable_branches_for_tenant(
        tenant.plan_actual,
        tenant.sedes_totales,
    )
    comprobante_referencia = f"PAY-{paid_at.strftime('%Y%m%d%H%M%S')}-{str(tenant.id)[:8]}"

    tenant.last_payment_at = paid_at
    tenant.next_billing_at = next_billing_at
    if tenant.plan_actual == "demo":
        tenant.subscription_status = "trial"
    else:
        tenant.subscription_status = "active"
    db.commit()

    payment_log = create_saas_audit_log(
        db=db,
        action="saas_register_payment",
        description=f"Pago registrado para tenant {tenant.slug}",
        actor=current_user,
        request=request,
        metadata={
            "tenant_id": str(tenant.id),
            "tenant_slug": tenant.slug,
            "amount": round(payload.amount, 2),
            "paid_at": paid_at.isoformat(),
            "next_billing_at": next_billing_at.isoformat(),
            "plan_code": plan_code,
            "plan_label": plan["label"],
            "sedes_totales": tenant.sedes_totales,
            "sucursales_incluidas": included_branches,
            "sucursales_facturables": chargeable_additional,
            "period_days": cycle_days,
            "comprobante_referencia": comprobante_referencia,
            "notes": (payload.notes or "").strip()[:300],
        },
    )

    receipt_pdf = build_saas_payment_receipt_pdf(
        reference=comprobante_referencia,
        tenant_nombre=tenant.nombre_comercial,
        tenant_slug=tenant.slug,
        tenant_nit=tenant.nit_cda,
        plan_label=plan["label"],
        amount=round(payload.amount, 2),
        paid_at=paid_at,
        period_days=cycle_days,
        sedes_totales=tenant.sedes_totales,
        sucursales_facturables=chargeable_additional,
        next_billing_at=next_billing_at,
        actor_email=current_user.email,
        tenant_email=tenant.correo_electronico,
        notes=payload.notes,
    )
    receipt_filename = f"recibo_saas_{comprobante_referencia}.pdf"
    receipt_download_url = f"{settings.BACKEND_PUBLIC_BASE_URL.rstrip('/')}/api/v1/saas/auth/billing/payments/{payment_log.id}/receipt"

    receipt_email_sent = False
    if tenant.correo_electronico:
        email_html = generar_email_recibo_pago_saas(
            nombre_cda=tenant.nombre_comercial,
            referencia=comprobante_referencia,
            monto=round(payload.amount, 2),
            fecha_pago=paid_at.strftime("%Y-%m-%d %H:%M:%S"),
            proximo_cobro=next_billing_at.strftime("%Y-%m-%d"),
        )
        receipt_email_sent = enviar_email_con_adjuntos(
            destinatario=tenant.correo_electronico,
            asunto=f"CDASOFT - Recibo de pago {comprobante_referencia}",
            cuerpo_html=email_html,
            adjuntos=[(receipt_filename, receipt_pdf, "application/pdf")],
        )

    return SaaSPaymentRegisteredResponse(
        tenant_id=str(tenant.id),
        tenant_slug=tenant.slug,
        plan_code=plan_code,
        plan_label=plan["label"],
        amount=round(payload.amount, 2),
        paid_at=paid_at,
        sedes_totales=tenant.sedes_totales,
        sucursales_incluidas=included_branches,
        sucursales_facturables=chargeable_additional,
        period_days=cycle_days,
        comprobante_referencia=comprobante_referencia,
        payment_log_id=str(payment_log.id),
        receipt_download_url=receipt_download_url,
        receipt_email_sent=receipt_email_sent,
        next_billing_at=next_billing_at,
        subscription_status=tenant.subscription_status,
    )


@router.get("/billing/payments/{payment_log_id}/receipt")
def download_payment_receipt_pdf(
    payment_log_id: str,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    try:
        log_uuid = UUID(payment_log_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de pago inválido")

    payment_log = (
        db.query(AuditLog)
        .filter(AuditLog.id == log_uuid)
        .filter(AuditLog.action == "saas_register_payment")
        .first()
    )
    if not payment_log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recibo no encontrado")

    meta = extract_payment_metadata(payment_log)
    tenant_id_raw = str(meta.get("tenant_id") or "").strip()
    if not tenant_id_raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recibo sin tenant asociado")

    try:
        tenant_uuid = UUID(tenant_id_raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recibo con tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant del recibo no encontrado")

    paid_at_raw = meta.get("paid_at")
    try:
        paid_at = datetime.fromisoformat(str(paid_at_raw)) if paid_at_raw else payment_log.created_at
    except ValueError:
        paid_at = payment_log.created_at

    next_billing_raw = meta.get("next_billing_at")
    try:
        next_billing_at = datetime.fromisoformat(str(next_billing_raw)) if next_billing_raw else None
    except ValueError:
        next_billing_at = None

    amount_raw = meta.get("amount")
    try:
        amount = round(float(amount_raw), 2) if amount_raw is not None else 0.0
    except (TypeError, ValueError):
        amount = 0.0

    sedes_raw = meta.get("sedes_totales")
    fact_raw = meta.get("sucursales_facturables")
    try:
        sedes_totales = int(sedes_raw) if sedes_raw is not None else tenant.sedes_totales
    except (TypeError, ValueError):
        sedes_totales = tenant.sedes_totales
    try:
        sucursales_facturables = int(fact_raw) if fact_raw is not None else 0
    except (TypeError, ValueError):
        sucursales_facturables = 0

    plan_label = str(meta.get("plan_label") or PLAN_DEFINITIONS.get((tenant.plan_actual or "demo").lower(), PLAN_DEFINITIONS["demo"])["label"])
    period_days_raw = meta.get("period_days")
    try:
        period_days = int(period_days_raw) if period_days_raw is not None else (tenant.billing_cycle_days or 30)
    except (TypeError, ValueError):
        period_days = tenant.billing_cycle_days or 30
    reference = str(meta.get("comprobante_referencia") or f"PAY-{payment_log.id}")

    receipt_pdf = build_saas_payment_receipt_pdf(
        reference=reference,
        tenant_nombre=tenant.nombre_comercial,
        tenant_slug=tenant.slug,
        tenant_nit=tenant.nit_cda,
        plan_label=plan_label,
        amount=amount,
        paid_at=paid_at,
        period_days=period_days,
        sedes_totales=sedes_totales,
        sucursales_facturables=sucursales_facturables,
        next_billing_at=next_billing_at,
        actor_email=payment_log.usuario_email,
        tenant_email=tenant.correo_electronico,
        notes=meta.get("notes"),
    )

    filename = f"recibo_saas_{reference}.pdf"
    return StreamingResponse(
        iter([receipt_pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/billing/payments/{payment_log_id}/resend-receipt")
def resend_payment_receipt_email(
    payment_log_id: str,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial"])),
):
    try:
        log_uuid = UUID(payment_log_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de pago inválido")

    payment_log = (
        db.query(AuditLog)
        .filter(AuditLog.id == log_uuid)
        .filter(AuditLog.action == "saas_register_payment")
        .first()
    )
    if not payment_log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recibo no encontrado")

    meta = extract_payment_metadata(payment_log)
    tenant_id_raw = str(meta.get("tenant_id") or "").strip()
    if not tenant_id_raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recibo sin tenant asociado")

    try:
        tenant_uuid = UUID(tenant_id_raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recibo con tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant del recibo no encontrado")
    if not tenant.correo_electronico:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El tenant no tiene correo electrónico configurado")

    paid_at_raw = meta.get("paid_at")
    try:
        paid_at = datetime.fromisoformat(str(paid_at_raw)) if paid_at_raw else payment_log.created_at
    except ValueError:
        paid_at = payment_log.created_at

    next_billing_raw = meta.get("next_billing_at")
    try:
        next_billing_at = datetime.fromisoformat(str(next_billing_raw)) if next_billing_raw else None
    except ValueError:
        next_billing_at = None

    amount_raw = meta.get("amount")
    try:
        amount = round(float(amount_raw), 2) if amount_raw is not None else 0.0
    except (TypeError, ValueError):
        amount = 0.0

    sedes_raw = meta.get("sedes_totales")
    fact_raw = meta.get("sucursales_facturables")
    try:
        sedes_totales = int(sedes_raw) if sedes_raw is not None else tenant.sedes_totales
    except (TypeError, ValueError):
        sedes_totales = tenant.sedes_totales
    try:
        sucursales_facturables = int(fact_raw) if fact_raw is not None else 0
    except (TypeError, ValueError):
        sucursales_facturables = 0

    plan_label = str(meta.get("plan_label") or PLAN_DEFINITIONS.get((tenant.plan_actual or "demo").lower(), PLAN_DEFINITIONS["demo"])["label"])
    period_days_raw = meta.get("period_days")
    try:
        period_days = int(period_days_raw) if period_days_raw is not None else (tenant.billing_cycle_days or 30)
    except (TypeError, ValueError):
        period_days = tenant.billing_cycle_days or 30
    reference = str(meta.get("comprobante_referencia") or f"PAY-{payment_log.id}")

    receipt_pdf = build_saas_payment_receipt_pdf(
        reference=reference,
        tenant_nombre=tenant.nombre_comercial,
        tenant_slug=tenant.slug,
        tenant_nit=tenant.nit_cda,
        plan_label=plan_label,
        amount=amount,
        paid_at=paid_at,
        period_days=period_days,
        sedes_totales=sedes_totales,
        sucursales_facturables=sucursales_facturables,
        next_billing_at=next_billing_at,
        actor_email=payment_log.usuario_email,
    )
    receipt_filename = f"recibo_saas_{reference}.pdf"
    email_html = generar_email_recibo_pago_saas(
        nombre_cda=tenant.nombre_comercial,
        referencia=reference,
        monto=amount,
        fecha_pago=paid_at.strftime("%Y-%m-%d %H:%M:%S"),
        proximo_cobro=next_billing_at.strftime("%Y-%m-%d") if next_billing_at else "-",
    )

    sent = enviar_email_con_adjuntos(
        destinatario=tenant.correo_electronico,
        asunto=f"CDASOFT - Reenvío recibo de pago {reference}",
        cuerpo_html=email_html,
        adjuntos=[(receipt_filename, receipt_pdf, "application/pdf")],
    )
    if not sent:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No se pudo reenviar el recibo por correo")
    return {"message": "Recibo reenviado exitosamente", "sent": True}


@router.get("/billing/overview", response_model=list[SaaSBillingOverviewItem])
def list_billing_overview(
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    sync_expired_demo_tenants(db)
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()

    payment_logs = (
        db.query(AuditLog)
        .filter(AuditLog.action == "saas_register_payment")
        .order_by(AuditLog.created_at.desc())
        .all()
    )
    last_payment_by_tenant: dict[str, AuditLog] = {}
    for log in payment_logs:
        meta = extract_payment_metadata(log)
        tenant_id = str(meta.get("tenant_id") or "").strip()
        if tenant_id and tenant_id not in last_payment_by_tenant:
            last_payment_by_tenant[tenant_id] = log

    items: list[SaaSBillingOverviewItem] = []
    for tenant in tenants:
        plan_code = (tenant.plan_actual or "demo").strip().lower()
        plan = PLAN_DEFINITIONS.get(plan_code, PLAN_DEFINITIONS["demo"])
        chargeable, _ = calculate_chargeable_branches_for_tenant(plan_code, tenant.sedes_totales)
        last_log = last_payment_by_tenant.get(str(tenant.id))
        last_meta = extract_payment_metadata(last_log) if last_log else {}

        last_amount_raw = last_meta.get("amount")
        try:
            last_amount = round(float(last_amount_raw), 2) if last_amount_raw is not None else None
        except (TypeError, ValueError):
            last_amount = None

        items.append(
            SaaSBillingOverviewItem(
                tenant_id=str(tenant.id),
                tenant_slug=tenant.slug,
                tenant_nombre=tenant.nombre_comercial,
                plan_code=plan_code,
                plan_label=plan["label"],
                subscription_status=tenant.subscription_status,
                cobro_status=get_cobro_status(tenant.subscription_status, tenant.next_billing_at),
                sedes_totales=tenant.sedes_totales,
                sucursales_facturables=chargeable,
                next_billing_at=tenant.next_billing_at,
                last_payment_at=tenant.last_payment_at,
                last_payment_amount=last_amount,
                last_receipt_reference=last_meta.get("comprobante_referencia"),
                last_payment_log_id=str(last_log.id) if last_log else None,
            )
        )
    return items


@router.get("/billing/tenant/{tenant_id}/payments", response_model=list[SaaSPaymentHistoryItem])
def list_tenant_payment_history(
    tenant_id: str,
    limit: int = 20,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    try:
        tenant_uuid = UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    safe_limit = min(max(limit, 1), 100)
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.action == "saas_register_payment")
        .order_by(AuditLog.created_at.desc())
        .all()
    )

    items: list[SaaSPaymentHistoryItem] = []
    for log in logs:
        meta = extract_payment_metadata(log)
        meta_tenant_id = str(meta.get("tenant_id") or "").strip()
        if meta_tenant_id != str(tenant.id):
            continue

        paid_at_raw = meta.get("paid_at")
        try:
            paid_at = datetime.fromisoformat(str(paid_at_raw)) if paid_at_raw else log.created_at
        except ValueError:
            paid_at = log.created_at

        next_billing_raw = meta.get("next_billing_at")
        try:
            next_billing_at = datetime.fromisoformat(str(next_billing_raw)) if next_billing_raw else None
        except ValueError:
            next_billing_at = None

        amount_raw = meta.get("amount")
        try:
            amount = round(float(amount_raw), 2) if amount_raw is not None else 0.0
        except (TypeError, ValueError):
            amount = 0.0

        sedes_raw = meta.get("sedes_totales")
        fact_raw = meta.get("sucursales_facturables")
        try:
            sedes_totales = int(sedes_raw) if sedes_raw is not None else None
        except (TypeError, ValueError):
            sedes_totales = None
        try:
            sucursales_facturables = int(fact_raw) if fact_raw is not None else None
        except (TypeError, ValueError):
            sucursales_facturables = None

        items.append(
            SaaSPaymentHistoryItem(
                id=str(log.id),
                tenant_id=str(tenant.id),
                tenant_slug=tenant.slug,
                amount=amount,
                paid_at=paid_at,
                next_billing_at=next_billing_at,
                plan_code=meta.get("plan_code"),
                plan_label=meta.get("plan_label"),
                sedes_totales=sedes_totales,
                sucursales_facturables=sucursales_facturables,
                comprobante_referencia=meta.get("comprobante_referencia"),
                payment_log_id=str(log.id),
                receipt_download_url=f"{settings.BACKEND_PUBLIC_BASE_URL.rstrip('/')}/api/v1/saas/auth/billing/payments/{log.id}/receipt",
                actor_email=log.usuario_email,
                notes=meta.get("notes"),
            )
        )

        if len(items) >= safe_limit:
            break

    return items


@router.get("/support/tickets", response_model=list[SaaSSupportTicketItem])
def list_support_tickets(
    tenant_slug: str | None = None,
    status_filter: str | None = None,
    priority: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "soporte", "comercial"])),
):
    safe_limit = min(max(limit, 1), 200)
    assigned_user = aliased(SaaSUser)
    created_user = aliased(SaaSUser)
    query = (
        db.query(
            SaaSSupportTicket,
            Tenant.slug.label("tenant_slug"),
            Tenant.nombre_comercial.label("tenant_nombre"),
            assigned_user.email.label("assigned_email"),
            created_user.email.label("created_email"),
        )
        .join(Tenant, Tenant.id == SaaSSupportTicket.tenant_id)
        .outerjoin(created_user, created_user.id == SaaSSupportTicket.created_by_saas_user_id)
        .outerjoin(assigned_user, assigned_user.id == SaaSSupportTicket.assigned_to_saas_user_id)
    )
    if tenant_slug:
        query = query.filter(Tenant.slug == tenant_slug.strip())
    if status_filter:
        query = query.filter(SaaSSupportTicket.status == validate_support_status(status_filter))
    if priority:
        query = query.filter(SaaSSupportTicket.priority == validate_support_priority(priority))

    rows = query.order_by(SaaSSupportTicket.created_at.desc()).limit(safe_limit).all()
    return [
        map_support_ticket_row(
            ticket=ticket,
            tenant_slug=t_slug,
            tenant_name=t_name,
            assigned_email=assigned_email,
            created_email=created_email,
        )
        for ticket, t_slug, t_name, assigned_email, created_email in rows
    ]


@router.get("/support/summary", response_model=SaaSSupportSummary)
def support_summary(
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "soporte", "comercial"])),
):
    total_tickets = db.query(SaaSSupportTicket).count()
    abiertos = db.query(SaaSSupportTicket).filter(SaaSSupportTicket.status == "abierto").count()
    en_progreso = db.query(SaaSSupportTicket).filter(SaaSSupportTicket.status == "en_progreso").count()
    criticos_abiertos = (
        db.query(SaaSSupportTicket)
        .filter(SaaSSupportTicket.status.in_(["abierto", "en_progreso"]), SaaSSupportTicket.priority == "critica")
        .count()
    )
    return SaaSSupportSummary(
        total_tickets=total_tickets,
        abiertos=abiertos,
        en_progreso=en_progreso,
        sin_resolver=abiertos + en_progreso,
        criticos_abiertos=criticos_abiertos,
        notificaciones_pendientes=abiertos,
    )


@router.post("/support/tickets", response_model=SaaSSupportTicketItem, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    payload: SaaSSupportTicketCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "soporte", "comercial"])),
):
    try:
        tenant_uuid = UUID(payload.tenant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de tenant inválido")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    normalized_priority = validate_support_priority(payload.priority)
    category = (payload.category or "general").strip().lower()[:40] or "general"

    ticket = SaaSSupportTicket(
        tenant_id=tenant.id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=category,
        priority=normalized_priority,
        status="abierto",
        assigned_to_saas_user_id=None,
        created_by_saas_user_id=current_user.id,
        internal_notes=None,
        sla_due_at=payload.sla_due_at,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    create_saas_audit_log(
        db=db,
        action="saas_support_ticket_create",
        description=f"Ticket de soporte creado para tenant {tenant.slug}",
        request=request,
        actor=current_user,
        metadata={
            "ticket_id": str(ticket.id),
            "tenant_id": str(tenant.id),
            "tenant_slug": tenant.slug,
            "priority": ticket.priority,
            "category": ticket.category,
        },
    )

    return map_support_ticket_row(
        ticket=ticket,
        tenant_slug=tenant.slug,
        tenant_name=tenant.nombre_comercial,
        assigned_email=None,
        created_email=current_user.email,
    )


@router.patch("/support/tickets/{ticket_id}", response_model=SaaSSupportTicketItem)
def update_support_ticket(
    ticket_id: str,
    payload: SaaSSupportTicketUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "soporte"])),
):
    try:
        ticket_uuid = UUID(ticket_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de ticket inválido")

    ticket = db.query(SaaSSupportTicket).filter(SaaSSupportTicket.id == ticket_uuid).first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket no encontrado")

    if payload.priority is not None:
        ticket.priority = validate_support_priority(payload.priority)
    if payload.status is not None:
        next_status = validate_support_status(payload.status)
        if next_status in {"resuelto", "cerrado"}:
            response_message = (payload.tenant_response_message or "").strip()
            if not response_message:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Debes registrar un mensaje de respuesta para el CDA al resolver o cerrar el ticket.",
                )
        ticket.status = next_status
        if next_status in {"resuelto", "cerrado"}:
            ticket.resolved_at = datetime.now(timezone.utc)
        elif next_status in {"abierto", "en_progreso"}:
            ticket.resolved_at = None
    if payload.assigned_to_user_id is not None:
        if payload.assigned_to_user_id.strip() == "":
            ticket.assigned_to_saas_user_id = None
        else:
            try:
                assignee_uuid = UUID(payload.assigned_to_user_id)
            except ValueError:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de usuario asignado inválido")
            assignee = db.query(SaaSUser).filter(SaaSUser.id == assignee_uuid, SaaSUser.activo.is_(True)).first()
            if not assignee:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario SaaS asignado no encontrado o inactivo")
            ticket.assigned_to_saas_user_id = assignee.id
    if payload.internal_notes is not None:
        ticket.internal_notes = payload.internal_notes.strip() or None
    if payload.tenant_response_message is not None:
        tenant_response_message = payload.tenant_response_message.strip()
        ticket.tenant_response_message = tenant_response_message or None
        if tenant_response_message:
            ticket.tenant_responded_at = datetime.now(timezone.utc)
            ticket.responded_by_saas_user_id = current_user.id

    db.commit()
    db.refresh(ticket)

    tenant = db.query(Tenant).filter(Tenant.id == ticket.tenant_id).first()
    assigned_email = None
    if ticket.assigned_to_saas_user_id:
        assigned_user = db.query(SaaSUser).filter(SaaSUser.id == ticket.assigned_to_saas_user_id).first()
        assigned_email = assigned_user.email if assigned_user else None
    created_user = db.query(SaaSUser).filter(SaaSUser.id == ticket.created_by_saas_user_id).first()

    create_saas_audit_log(
        db=db,
        action="saas_support_ticket_update",
        description=f"Ticket de soporte actualizado: {ticket.id}",
        request=request,
        actor=current_user,
        metadata={
            "ticket_id": str(ticket.id),
            "status": ticket.status,
            "priority": ticket.priority,
            "assigned_to": str(ticket.assigned_to_saas_user_id) if ticket.assigned_to_saas_user_id else None,
            "tenant_response_message": ticket.tenant_response_message,
        },
    )

    return map_support_ticket_row(
        ticket=ticket,
        tenant_slug=tenant.slug if tenant else "-",
        tenant_name=tenant.nombre_comercial if tenant else "Tenant",
        assigned_email=assigned_email,
        created_email=created_user.email if created_user else None,
    )


@router.get("/users", response_model=list[SaaSUserResponse])
def list_saas_users(
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "soporte"])),
):
    return db.query(SaaSUser).order_by(SaaSUser.created_at.desc()).all()


@router.get("/audit-logs", response_model=list[SaaSAuditLogItem])
def list_saas_audit_logs(
    action: str | None = None,
    actor_email: str | None = None,
    tenant_slug: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "soporte"])),
):
    safe_limit = min(max(limit, 1), 200)
    query = (
        db.query(AuditLog, Tenant.slug.label("tenant_slug"))
        .outerjoin(Usuario, AuditLog.usuario_id == Usuario.id)
        .outerjoin(Tenant, Usuario.tenant_id == Tenant.id)
    )
    if action:
        query = query.filter(AuditLog.action == action)
    if actor_email:
        query = query.filter(AuditLog.usuario_email.ilike(f"%{actor_email.strip()}%"))
    if tenant_slug:
        query = query.filter(Tenant.slug == tenant_slug.strip())
    if date_from:
        try:
            date_from_ts = datetime.fromisoformat(date_from.strip())
            query = query.filter(AuditLog.created_at >= date_from_ts)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from inválido, usa formato ISO")
    if date_to:
        try:
            date_to_ts = datetime.fromisoformat(date_to.strip())
            if len(date_to.strip()) <= 10:
                date_to_ts = date_to_ts + timedelta(days=1) - timedelta(seconds=1)
            query = query.filter(AuditLog.created_at <= date_to_ts)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_to inválido, usa formato ISO")

    rows = query.order_by(AuditLog.created_at.desc()).limit(safe_limit).all()
    return [
        SaaSAuditLogItem(
            id=str(log.id),
            action=log.action,
            description=log.description,
            usuario_email=log.usuario_email,
            usuario_nombre=log.usuario_nombre,
            success=log.success,
            ip_address=log.ip_address,
            tenant_slug=slug,
            created_at=log.created_at,
        )
        for log, slug in rows
    ]


@router.get("/audit-logs/export")
def export_saas_audit_logs_csv(
    action: str | None = None,
    actor_email: str | None = None,
    tenant_slug: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "soporte"])),
):
    rows = list_saas_audit_logs(
        action=action,
        actor_email=actor_email,
        tenant_slug=tenant_slug,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        db=db,
        _=_,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["created_at", "action", "description", "actor_email", "actor_name", "tenant_slug", "success", "ip_address"])
    for row in rows:
        writer.writerow([
            row.created_at.isoformat(),
            row.action,
            row.description,
            row.usuario_email or "",
            row.usuario_nombre or "",
            row.tenant_slug or "",
            row.success,
            row.ip_address or "",
        ])

    output.seek(0)
    filename = f"saas_audit_logs_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/security/summary", response_model=SaaSSecuritySummary)
def saas_security_summary(
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "soporte"])),
):
    now_ts = datetime.now(timezone.utc)
    all_users = db.query(SaaSUser).all()
    total_users = len(all_users)
    active_users = len([u for u in all_users if u.activo])
    mfa_users = len([u for u in all_users if u.mfa_enabled])
    locked_users = len([u for u in all_users if u.bloqueado_hasta and u.bloqueado_hasta > now_ts])

    return SaaSSecuritySummary(
        current_user_email=current_user.email,
        current_user_role=current_user.rol_global,
        current_session_version=current_user.session_version,
        mfa_enabled=current_user.mfa_enabled,
        total_saas_users=total_users,
        active_saas_users=active_users,
        locked_saas_users=locked_users,
        mfa_enabled_users=mfa_users,
    )


@router.get("/security/users", response_model=list[SaaSUserSecurityItem])
def list_saas_security_users(
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "soporte"])),
):
    users = db.query(SaaSUser).order_by(SaaSUser.created_at.desc()).all()
    return [
        SaaSUserSecurityItem(
            id=str(u.id),
            email=u.email,
            nombre_completo=u.nombre_completo,
            rol_global=u.rol_global,
            activo=u.activo,
            mfa_enabled=u.mfa_enabled,
            intentos_fallidos=u.intentos_fallidos,
            bloqueado_hasta=u.bloqueado_hasta,
            session_version=u.session_version,
        )
        for u in users
    ]


@router.post("/security/users/{user_id}/toggle-mfa")
def toggle_saas_user_mfa(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_owner: SaaSUser = Depends(get_saas_owner),
):
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de usuario inválido")

    target = db.query(SaaSUser).filter(SaaSUser.id == user_uuid).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario SaaS no encontrado")

    if target.rol_global in MFA_REQUIRED_ROLES and target.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede desactivar MFA para roles con obligatoriedad",
        )

    target.mfa_enabled = not target.mfa_enabled
    db.commit()
    create_saas_audit_log(
        db=db,
        action="saas_toggle_mfa",
        description=f"MFA {'activado' if target.mfa_enabled else 'desactivado'} para {target.email}",
        request=request,
        actor=current_owner,
        metadata={"target_user_id": str(target.id), "target_email": target.email, "mfa_enabled": target.mfa_enabled},
    )
    return {"message": "MFA actualizado", "mfa_enabled": target.mfa_enabled}


@router.post("/security/users/{user_id}/unlock")
def unlock_saas_user(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "soporte"])),
):
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de usuario inválido")

    target = db.query(SaaSUser).filter(SaaSUser.id == user_uuid).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario SaaS no encontrado")

    target.intentos_fallidos = 0
    target.bloqueado_hasta = None
    db.commit()
    create_saas_audit_log(
        db=db,
        action="saas_unlock_user",
        description=f"Usuario SaaS desbloqueado: {target.email}",
        request=request,
        actor=current_user,
        metadata={"target_user_id": str(target.id), "target_email": target.email},
    )
    return {"message": "Usuario desbloqueado"}


@router.post("/users", response_model=SaaSUserResponse, status_code=status.HTTP_201_CREATED)
def create_saas_user(
    request: Request,
    user_data: SaaSUserCreate,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(get_saas_owner),
):
    if user_data.rol_global not in ALLOWED_GLOBAL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rol global inválido",
        )

    exists = db.query(SaaSUser).filter(SaaSUser.email == user_data.email).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email global ya está registrado",
        )

    validate_saas_password(user_data.password)
    mfa_enabled_default = user_data.rol_global in MFA_REQUIRED_ROLES

    user = SaaSUser(
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        nombre_completo=user_data.nombre_completo,
        rol_global=user_data.rol_global,
        activo=True,
        mfa_enabled=mfa_enabled_default,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    create_saas_audit_log(
        db=db,
        action="saas_create_user",
        description=f"Usuario SaaS creado: {user.email}",
        request=request,
        actor=_,
        metadata={"rol_global": user.rol_global, "mfa_enabled": user.mfa_enabled},
    )
    return user


@router.post("/logout-all")
def saas_logout_all_sessions(
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(get_current_saas_user),
):
    current_user.session_version += 1
    db.commit()
    create_saas_audit_log(
        db=db,
        action="saas_logout_all",
        description="Invalidación global de sesiones SaaS",
        request=request,
        actor=current_user,
    )
    return {"message": "Todas las sesiones globales fueron invalidadas"}
