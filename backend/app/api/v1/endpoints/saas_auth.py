
"""
Endpoints de autenticación global SaaS (backoffice).
"""
from datetime import datetime, timedelta, timezone
import csv
import io
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, func, or_
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
    validate_password_strength,
)
from app.models.audit_log import AuditLog
from app.models.saas_user import SaaSUser
from app.models.support_ticket import SaaSSupportTicket
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.tenant_billing_checkout import TenantBillingCheckoutSession
from app.models.factus import FacturaElectronica
from app.models.usuario import Usuario
from app.models.sarlaft_audit_log import SarlaftAuditLog
from app.models.sarlaft_batch_row import SarlaftBatchRow
from app.schemas.auth import Token, RefreshTokenRequest
from app.schemas.factus import (
    FactusMunicipalityItem,
    FactusNumberingRangeItem,
    FactusSettingsOut,
    FactusSettingsUpdate,
    FactusTestConnectionResult,
)
from app.schemas.saas_auth import SaaSUserCreate, SaaSUserResponse
from app.services.factus_tenant_settings import (
    apply_settings_update,
    get_or_create_settings_row,
    list_municipalities_for_tenant,
    list_numbering_ranges_for_tenant,
    row_to_out,
    run_test_connection,
)
from app.utils.email import enviar_email_con_adjuntos, generar_email_recibo_pago_saas
from app.utils.saas_billing_receipts import build_saas_payment_receipt_pdf
from app.utils.tenant_logo import normalize_external_logo_url, save_tenant_logo_upload
from app.services.saas_billing_plans import (
    IVA_RATE,
    PLAN_DEFINITIONS,
    calculate_chargeable_branches_for_tenant,
    calculate_plan_quote,
)
from app.services.tenant_billing_state import refresh_tenant_billing_state
from app.integrations.saas_factus_billing import try_emit_saas_billing_electronic_invoice
from app.integrations.factus_client import (
    FactusAPIError,
    factus_base_url,
    format_factus_error_detail,
    get_numbering_ranges,
    obtain_token,
)
from app.api.v1.endpoints.tenant_billing import TenantSaasFeLatestOut
from app.services.saas_fe_diagnostics import (
    categorize_saas_fe_error,
    extract_saas_fe_reference_code,
)
from app.utils.factus_validators import (
    validar_nit_cda_con_dv,
)

router = APIRouter()


def utcnow_naive() -> datetime:
    """Retorna datetime UTC sin tzinfo para columnas TIMESTAMP sin zona."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_naive_utc(dt: datetime | None) -> datetime | None:
    """Normaliza datetime (aware/naive) a naive UTC para comparaciones seguras."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


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
    nomina_enabled: bool = False
    sarlaft_enabled: bool = False
    sarlaft_mode: str = "manual"
    login_url: str


class SaaSTenantUserSummary(BaseModel):
    id: str
    email: str
    nombre_completo: str
    rol: str
    activo: bool
    created_at: datetime


class SaaSSucursalResumen(BaseModel):
    id: str
    nombre: str
    codigo: str | None = None
    ciudad: str | None = None
    direccion: str | None = None
    factus_municipality_id: int | None = None
    activa: bool
    es_principal: bool


class SaaSTenantFacturacionMatriz(BaseModel):
    """Respaldo DIAN/Factus a nivel matriz. Las sedes sin dato propio lo heredan al facturar."""

    direccion_facturacion: str | None = None
    factus_municipality_id: int | None = None


class SaaSSucursalUbicacionPatch(BaseModel):
    """Ubicación por sede desde backoffice SaaS (vacío en sede = hereda matriz al emitir)."""

    ciudad: str | None = Field(default=None, max_length=200)
    direccion: str | None = Field(default=None, max_length=500)
    factus_municipality_id: int | None = Field(default=None, ge=1)


class SaaSTenantProfile(SaaSTenantSummary):
    total_usuarios: int
    usuarios_recientes: list[SaaSTenantUserSummary]
    facturacion_matriz: SaaSTenantFacturacionMatriz = Field(
        description="Datos de facturación por defecto del CDA (matriz).",
    )
    sucursales_activas: list[SaaSSucursalResumen] = Field(
        default_factory=list,
        description="Sedes activas del tenant (operativas).",
    )


class SaaSTenantLogoUpdateResponse(BaseModel):
    logo_url: str | None = None


class SaaSTenantCoreDataPatch(BaseModel):
    nombre: str | None = Field(default=None, max_length=200)
    nombre_comercial: str | None = Field(default=None, max_length=200)
    nit_cda: str | None = Field(default=None, max_length=30)
    correo_electronico: str | None = Field(default=None, max_length=255)
    nombre_representante: str | None = Field(default=None, max_length=200)
    celular: str | None = Field(default=None, max_length=30)
    nomina_enabled: bool | None = None
    sarlaft_enabled: bool | None = None
    sarlaft_mode: str | None = Field(default=None, pattern="^(manual|api)$")


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


class SaaSAuditLogListOut(BaseModel):
    items: list[SaaSAuditLogItem]
    total: int
    page: int
    page_size: int
    total_pages: int


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


class SaaSSupportTicketListOut(BaseModel):
    items: list[SaaSSupportTicketItem]
    total: int
    page: int
    page_size: int
    total_pages: int


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


class SaaSOpenSanctionsUsageTenantItem(BaseModel):
    tenant_id: str
    tenant_slug: str
    tenant_nombre: str
    recepcion_calls: int
    manual_calls: int
    lote_calls: int
    total_calls: int
    estimated_cost_eur: float
    estimated_cost_cop: float


class SaaSOpenSanctionsUsageOut(BaseModel):
    from_date: datetime
    to_date: datetime
    trm_cop: float
    cost_per_call_eur: float
    cost_per_call_cop: float
    pricing_model: str = "prepago_por_consulta"
    prepaid_unit_price_cop: float
    prepaid_package_expires_days: int
    recepcion_calls: int
    manual_calls: int
    lote_calls: int
    total_calls: int
    estimated_cost_eur: float
    estimated_cost_cop: float
    tenants: list[SaaSOpenSanctionsUsageTenantItem] = Field(default_factory=list)


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


class SaaSCheckoutSessionItem(BaseModel):
    """Suscripción: sesión PSP / init-payment y estado FE (emisor PROMETHEUS), no el Factus del CDA."""

    session_id: str
    tenant_id: str
    tenant_slug: str
    tenant_nombre: str
    plan_code: str
    sedes_totales: int
    total_cop: float
    status: str
    created_at: datetime
    completed_at: datetime | None
    payment_provider: str | None = None
    payment_ref: str | None = None
    epayco_ref: str | None = None
    saas_fe_status: str | None
    saas_fe_error: str | None
    saas_fe_error_category: str | None = None
    saas_fe_reference_code: str | None = None
    numero_documento: str | None = None
    cufe: str | None = None
    public_url: str | None = None


class SaaSCheckoutSessionCountsOut(BaseModel):
    all: int
    pending: int
    paid: int
    fe_issue: int


class SaaSCheckoutSessionListOut(BaseModel):
    items: list[SaaSCheckoutSessionItem]
    total: int
    page: int
    page_size: int
    total_pages: int
    counts: SaaSCheckoutSessionCountsOut


class SaaSFactusIssuerConfigOut(BaseModel):
    """Estado de configuración Factus para FE de licencia (emisor SaaS PROMETHEUS)."""

    enabled: bool
    use_sandbox: bool
    environment: str
    base_url: str
    configured: bool
    missing_fields: list[str]
    numbering_range_id: int | None = None
    client_id_hint: str | None = None
    api_username_hint: str | None = None
    issuer_name: str
    issuer_email: str


class SaaSFactusIssuerTestOut(BaseModel):
    ok: bool
    environment: str
    message: str
    numbering_ranges_found: int | None = None


def _checkout_row_to_tenant_saas_fe_out(
    row: TenantBillingCheckoutSession, fe: FacturaElectronica | None
) -> TenantSaasFeLatestOut:
    total = float(row.total_cop) if row.total_cop is not None else None
    err_msg = row.saas_fe_error[:2000] if row.saas_fe_error else None
    return TenantSaasFeLatestOut(
        session_id=str(row.id),
        plan_code=row.plan_code,
        total_cop=total,
        saas_fe_status=row.saas_fe_status,
        saas_fe_error=err_msg,
        saas_fe_error_category=categorize_saas_fe_error(status=row.saas_fe_status, error_message=err_msg),
        saas_fe_reference_code=extract_saas_fe_reference_code(err_msg),
        numero_documento=fe.numero_documento if fe else None,
        cufe=fe.cufe if fe else None,
        public_url=fe.public_url if fe else None,
    )


def _masked_hint(value: str, *, keep: int = 4) -> str | None:
    s = (value or "").strip()
    if not s:
        return None
    if len(s) <= keep:
        return "*" * len(s)
    return f"{'*' * (len(s) - keep)}{s[-keep:]}"


def _saas_factus_missing_fields() -> list[str]:
    missing: list[str] = []
    if not settings.SAAS_BILLING_FACTUS_ENABLED:
        missing.append("SAAS_BILLING_FACTUS_ENABLED")
    if (settings.SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID or 0) <= 0:
        missing.append("SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID")
    if not (settings.SAAS_BILLING_FACTUS_CLIENT_ID or "").strip():
        missing.append("SAAS_BILLING_FACTUS_CLIENT_ID")
    if not (settings.SAAS_BILLING_FACTUS_CLIENT_SECRET or "").strip():
        missing.append("SAAS_BILLING_FACTUS_CLIENT_SECRET")
    if not (settings.SAAS_BILLING_FACTUS_API_USERNAME or "").strip():
        missing.append("SAAS_BILLING_FACTUS_API_USERNAME")
    if not (settings.SAAS_BILLING_FACTUS_API_PASSWORD or "").strip():
        missing.append("SAAS_BILLING_FACTUS_API_PASSWORD")
    return missing


def validate_saas_password(password: str):
    try:
        validate_password_strength(password, min_length=10)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def sync_expired_demo_tenants(db: Session) -> None:
    """Alinea estados de tenants en plan demo (trial / soft / locked) y marca past_due en planes de pago."""
    demo_tenants = db.query(Tenant).filter(Tenant.plan_actual == "demo").all()
    for tenant in demo_tenants:
        refresh_tenant_billing_state(db, tenant)

    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)
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
    if subscription_status in {"locked", "pending_plan", "canceled"}:
        return "bloqueado"
    if subscription_status == "soft_grace":
        return "en_gracia"
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
    # Misma UX que tenant: el mensaje es genérico; normalizar email evita fallos por mayúsculas/espacios.
    email_key = (form_data.username or "").strip().lower()
    user = (
        db.query(SaaSUser)
        .filter(func.lower(SaaSUser.email) == email_key)
        .first()
        if email_key
        else None
    )
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

    now_ts = utcnow_naive()
    bloqueado_hasta = as_naive_utc(user.bloqueado_hasta)
    if bloqueado_hasta and bloqueado_hasta > now_ts:
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
            user.bloqueado_hasta = utcnow_naive() + timedelta(minutes=15)
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
            nomina_enabled=bool(getattr(tenant, "nomina_enabled", False)),
            sarlaft_enabled=bool(getattr(tenant, "sarlaft_enabled", False)),
            sarlaft_mode=(getattr(tenant, "sarlaft_mode", None) or "manual"),
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

    sedes_rows = (
        db.query(Sucursal)
        .filter(Sucursal.tenant_id == tenant_uuid, Sucursal.activa.is_(True))
        .order_by(Sucursal.es_principal.desc(), Sucursal.nombre.asc())
        .all()
    )

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
        nomina_enabled=bool(getattr(tenant, "nomina_enabled", False)),
        sarlaft_enabled=bool(getattr(tenant, "sarlaft_enabled", False)),
        sarlaft_mode=(getattr(tenant, "sarlaft_mode", None) or "manual"),
        login_url=f"{base_url}/{tenant.slug}",
        facturacion_matriz=SaaSTenantFacturacionMatriz(
            direccion_facturacion=tenant.direccion_facturacion,
            factus_municipality_id=tenant.factus_municipality_id,
        ),
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
        sucursales_activas=[
            SaaSSucursalResumen(
                id=str(s.id),
                nombre=s.nombre,
                codigo=s.codigo,
                ciudad=s.ciudad,
                direccion=s.direccion,
                factus_municipality_id=s.factus_municipality_id,
                activa=bool(s.activa),
                es_principal=bool(s.es_principal),
            )
            for s in sedes_rows
        ],
    )


@router.patch("/tenants/{tenant_id}/logo", response_model=SaaSTenantLogoUpdateResponse)
def patch_saas_tenant_logo(
    tenant_id: str,
    logo_url: str | None = Form(default=None),
    logo_file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    """
    Actualiza la marca (logo) del tenant desde el backoffice SaaS.
    Misma lógica que el registro público: `logo_file` tiene prioridad sobre `logo_url`.
    """
    url_stripped = (logo_url or "").strip()
    if not url_stripped and logo_file is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes enviar logo_url o subir logo_file",
        )

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

    if logo_file is not None:
        resolved = save_tenant_logo_upload(logo_file)
    else:
        resolved = normalize_external_logo_url(url_stripped)

    tenant.logo_url = resolved
    db.commit()
    db.refresh(tenant)

    return SaaSTenantLogoUpdateResponse(logo_url=tenant.logo_url)


@router.patch("/tenants/{tenant_id}/core-data", response_model=SaaSTenantProfile)
def patch_saas_tenant_core_data(
    tenant_id: str,
    body: SaaSTenantCoreDataPatch,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
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

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se enviaron cambios para actualizar",
        )

    if "nombre" in data:
        tenant.nombre = ((data["nombre"] or "").strip() or tenant.nombre)[:200]
    if "nombre_comercial" in data:
        tenant.nombre_comercial = ((data["nombre_comercial"] or "").strip() or tenant.nombre_comercial)[:200]
    if "nit_cda" in data:
        raw_nit = (data["nit_cda"] or "").strip()
        if raw_nit:
            try:
                normalized_nit, _, _ = validar_nit_cda_con_dv(raw_nit)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(exc),
                ) from exc
            existing = (
                db.query(Tenant)
                .filter(Tenant.nit_cda == normalized_nit, Tenant.id != tenant.id)
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El NIT del CDA ya está registrado en otro tenant.",
                )
            tenant.nit_cda = normalized_nit
        else:
            tenant.nit_cda = None
    if "correo_electronico" in data:
        mail = (data["correo_electronico"] or "").strip().lower()
        tenant.correo_electronico = mail or None
    if "nombre_representante" in data:
        rep = (data["nombre_representante"] or "").strip()
        tenant.nombre_representante = rep or None
    if "celular" in data:
        phone = (data["celular"] or "").strip()
        tenant.celular = phone or None
    if "nomina_enabled" in data and data["nomina_enabled"] is not None:
        tenant.nomina_enabled = bool(data["nomina_enabled"])
    if "sarlaft_enabled" in data and data["sarlaft_enabled"] is not None:
        tenant.sarlaft_enabled = bool(data["sarlaft_enabled"])
    if "sarlaft_mode" in data and data["sarlaft_mode"] is not None:
        tenant.sarlaft_mode = (str(data["sarlaft_mode"]).strip().lower() or "manual")

    db.commit()
    return get_saas_tenant_profile(tenant_id=tenant_id, db=db)


@router.patch(
    "/tenants/{tenant_id}/sucursales/{sucursal_id}",
    response_model=SaaSSucursalResumen,
)
def patch_saas_sucursal_ubicacion(
    tenant_id: str,
    sucursal_id: str,
    body: SaaSSucursalUbicacionPatch,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    """Ubicación de facturación por sede (CDASOFT backoffice). Vacío hereda matriz al emitir."""
    try:
        tenant_uuid = UUID(tenant_id)
        suc_uuid = UUID(sucursal_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID inválido",
        )
    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado",
        )
    row = (
        db.query(Sucursal)
        .filter(Sucursal.id == suc_uuid, Sucursal.tenant_id == tenant_uuid)
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sede no encontrada",
        )

    data = body.model_dump(exclude_unset=True)
    if "ciudad" in data:
        c = data["ciudad"]
        row.ciudad = (c.strip() if c else None) or None
    if "direccion" in data:
        d = data["direccion"]
        row.direccion = (d.strip() if d else None) or None
    if "factus_municipality_id" in data:
        row.factus_municipality_id = data["factus_municipality_id"]

    db.commit()
    db.refresh(row)

    return SaaSSucursalResumen(
        id=str(row.id),
        nombre=row.nombre,
        codigo=row.codigo,
        ciudad=row.ciudad,
        direccion=row.direccion,
        factus_municipality_id=row.factus_municipality_id,
        activa=bool(row.activa),
        es_principal=bool(row.es_principal),
    )


@router.get("/tenants/{tenant_id}/factus-settings", response_model=FactusSettingsOut)
def get_saas_tenant_factus_settings(
    tenant_id: str,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    """Configuración Factus del tenant (solo backoffice SaaS)."""
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
    row = get_or_create_settings_row(db, tenant_uuid)
    return row_to_out(row)


@router.put("/tenants/{tenant_id}/factus-settings", response_model=FactusSettingsOut)
def put_saas_tenant_factus_settings(
    tenant_id: str,
    body: FactusSettingsUpdate,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
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
    row = get_or_create_settings_row(db, tenant_uuid)
    apply_settings_update(db, row, body)
    return row_to_out(row)


@router.post("/tenants/{tenant_id}/factus-test-connection", response_model=FactusTestConnectionResult)
def post_saas_tenant_factus_test_connection(
    tenant_id: str,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
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
    row = get_or_create_settings_row(db, tenant_uuid)
    return run_test_connection(row)


@router.get("/tenants/{tenant_id}/factus-numbering-ranges", response_model=list[FactusNumberingRangeItem])
def get_saas_tenant_factus_numbering_ranges(
    tenant_id: str,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    """Lista rangos de numeración en Factus (ids válidos para default_numbering_range_id)."""
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
    row = get_or_create_settings_row(db, tenant_uuid)
    return list_numbering_ranges_for_tenant(row)


@router.get("/tenants/{tenant_id}/factus-municipalities", response_model=list[FactusMunicipalityItem])
def get_saas_tenant_factus_municipalities(
    tenant_id: str,
    name: str = Query(..., min_length=2, max_length=200, description="Texto del nombre del municipio (mín. 2 caracteres)"),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "comercial", "soporte"])),
):
    """Catálogo Factus /v1/municipalities en el ambiente activo del tenant (usar `id` en sedes/municipio)."""
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
    row = get_or_create_settings_row(db, tenant_uuid)
    return list_municipalities_for_tenant(row, name=name)


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
            asunto=f"{tenant.nombre_comercial} - Recibo de pago {comprobante_referencia}",
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
        asunto=f"{tenant.nombre_comercial} - Reenvío recibo de pago {reference}",
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


@router.get("/billing/opensanctions/usage", response_model=SaaSOpenSanctionsUsageOut)
def get_opensanctions_usage_summary(
    from_date: datetime | None = Query(default=None, description="Fecha inicio (inclusive, UTC)."),
    to_date: datetime | None = Query(default=None, description="Fecha fin (inclusive, UTC)."),
    trm_cop: float = Query(default=4379.0, gt=0, description="TRM EUR/COP para estimar costo en COP."),
    tenant_id: UUID | None = Query(default=None, description="Filtrar por tenant específico (opcional)."),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    end_dt = as_naive_utc(to_date) or utcnow_naive()
    start_dt = as_naive_utc(from_date) or (end_dt - timedelta(days=30))
    if start_dt > end_dt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rango de fechas inválido.")

    cost_per_call_eur = float(settings.OPENSANCTIONS_COST_PER_CALL_EUR or 0.10)
    cost_per_call_cop = round(cost_per_call_eur * trm_cop, 2)
    prepaid_unit_price_cop = round(float(settings.OPENSANCTIONS_PREPAID_UNIT_PRICE_COP or 0), 2)
    prepaid_package_expires_days = int(settings.OPENSANCTIONS_PREPAID_PACKAGE_EXPIRES_DAYS or 365)

    tenants = db.query(Tenant).all()
    tenant_meta = {
        str(t.id): {
            "slug": t.slug,
            "name": t.nombre_comercial or t.nombre,
        }
        for t in tenants
    }

    manual_rows = (
        db.query(SarlaftAuditLog.tenant_id, func.count(SarlaftAuditLog.id))
        .filter(
            SarlaftAuditLog.action == "manual_check_created",
            SarlaftAuditLog.created_at >= start_dt,
            SarlaftAuditLog.created_at <= end_dt,
        )
        .group_by(SarlaftAuditLog.tenant_id)
        .all()
    )
    recepcion_rows = (
        db.query(SarlaftAuditLog.tenant_id, func.count(SarlaftAuditLog.id))
        .filter(
            SarlaftAuditLog.action == "auto_screening_from_recepcion",
            SarlaftAuditLog.created_at >= start_dt,
            SarlaftAuditLog.created_at <= end_dt,
        )
        .group_by(SarlaftAuditLog.tenant_id)
        .all()
    )
    lote_rows = (
        db.query(SarlaftBatchRow.tenant_id, func.count(SarlaftBatchRow.id))
        .filter(
            SarlaftBatchRow.status == "ok",
            SarlaftBatchRow.created_manual_check_id.isnot(None),
            SarlaftBatchRow.created_at >= start_dt,
            SarlaftBatchRow.created_at <= end_dt,
        )
        .group_by(SarlaftBatchRow.tenant_id)
        .all()
    )

    manual_by_tenant = {str(tenant_id): int(count or 0) for tenant_id, count in manual_rows}
    recepcion_by_tenant = {str(tenant_id): int(count or 0) for tenant_id, count in recepcion_rows}
    lote_by_tenant = {str(tenant_id): int(count or 0) for tenant_id, count in lote_rows}

    tenant_ids = set(manual_by_tenant.keys()) | set(recepcion_by_tenant.keys()) | set(lote_by_tenant.keys())
    if tenant_id is not None:
        tenant_ids = {tid for tid in tenant_ids if tid == str(tenant_id)}
    tenant_items: list[SaaSOpenSanctionsUsageTenantItem] = []
    for tenant_id in tenant_ids:
        recepcion_calls = recepcion_by_tenant.get(tenant_id, 0)
        manual_calls = manual_by_tenant.get(tenant_id, 0)
        lote_calls = lote_by_tenant.get(tenant_id, 0)
        total_calls = recepcion_calls + manual_calls + lote_calls
        info = tenant_meta.get(tenant_id, {"slug": "n/d", "name": "Tenant no encontrado"})
        estimated_cost_eur = round(total_calls * cost_per_call_eur, 4)
        estimated_cost_cop = round(total_calls * cost_per_call_cop, 2)
        tenant_items.append(
            SaaSOpenSanctionsUsageTenantItem(
                tenant_id=tenant_id,
                tenant_slug=info["slug"],
                tenant_nombre=info["name"],
                recepcion_calls=recepcion_calls,
                manual_calls=manual_calls,
                lote_calls=lote_calls,
                total_calls=total_calls,
                estimated_cost_eur=estimated_cost_eur,
                estimated_cost_cop=estimated_cost_cop,
            )
        )
    tenant_items.sort(key=lambda x: (x.total_calls, x.tenant_nombre.lower()), reverse=True)

    recepcion_total = sum(x.recepcion_calls for x in tenant_items)
    manual_total = sum(x.manual_calls for x in tenant_items)
    lote_total = sum(x.lote_calls for x in tenant_items)
    total_calls = recepcion_total + manual_total + lote_total

    return SaaSOpenSanctionsUsageOut(
        from_date=start_dt,
        to_date=end_dt,
        trm_cop=trm_cop,
        cost_per_call_eur=cost_per_call_eur,
        cost_per_call_cop=cost_per_call_cop,
        pricing_model="prepago_por_consulta",
        prepaid_unit_price_cop=prepaid_unit_price_cop,
        prepaid_package_expires_days=prepaid_package_expires_days,
        recepcion_calls=recepcion_total,
        manual_calls=manual_total,
        lote_calls=lote_total,
        total_calls=total_calls,
        estimated_cost_eur=round(total_calls * cost_per_call_eur, 4),
        estimated_cost_cop=round(total_calls * cost_per_call_cop, 2),
        tenants=tenant_items,
    )


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


@router.get("/billing/saas-factus/config", response_model=SaaSFactusIssuerConfigOut)
def get_saas_factus_issuer_config(
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    use_sandbox = bool(settings.SAAS_BILLING_FACTUS_USE_SANDBOX)
    env_name = "sandbox" if use_sandbox else "production"
    missing = _saas_factus_missing_fields()
    return SaaSFactusIssuerConfigOut(
        enabled=bool(settings.SAAS_BILLING_FACTUS_ENABLED),
        use_sandbox=use_sandbox,
        environment=env_name,
        base_url=factus_base_url(use_sandbox=use_sandbox),
        configured=len(missing) == 0,
        missing_fields=missing,
        numbering_range_id=(
            int(settings.SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID)
            if (settings.SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID or 0) > 0
            else None
        ),
        client_id_hint=_masked_hint(settings.SAAS_BILLING_FACTUS_CLIENT_ID),
        api_username_hint=_masked_hint(settings.SAAS_BILLING_FACTUS_API_USERNAME, keep=3),
        issuer_name=(settings.SAAS_BILLING_ISSUER_NAME or "PROMETHEUS TECH S.A.S"),
        issuer_email=(settings.SAAS_BILLING_ISSUER_EMAIL or "").strip(),
    )


@router.post("/billing/saas-factus/test-connection", response_model=SaaSFactusIssuerTestOut)
def post_saas_factus_issuer_test_connection(
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas"])),
):
    missing = _saas_factus_missing_fields()
    use_sandbox = bool(settings.SAAS_BILLING_FACTUS_USE_SANDBOX)
    env_name = "sandbox" if use_sandbox else "production"
    if missing:
        return SaaSFactusIssuerTestOut(
            ok=False,
            environment=env_name,
            message="Faltan variables requeridas en .env para el emisor SaaS: " + ", ".join(missing),
            numbering_ranges_found=None,
        )
    base = factus_base_url(use_sandbox=use_sandbox)
    try:
        token = obtain_token(
            base_url=base,
            client_id=settings.SAAS_BILLING_FACTUS_CLIENT_ID.strip(),
            client_secret=settings.SAAS_BILLING_FACTUS_CLIENT_SECRET.strip(),
            username=settings.SAAS_BILLING_FACTUS_API_USERNAME.strip(),
            password=settings.SAAS_BILLING_FACTUS_API_PASSWORD.strip(),
        )
        access = token.get("access_token")
        if not access:
            raise HTTPException(status_code=502, detail="Factus respondió sin access_token")
        ranges = get_numbering_ranges(base_url=base, access_token=str(access), is_active=1)
        return SaaSFactusIssuerTestOut(
            ok=True,
            environment=env_name,
            message="Conexión Factus SaaS OK. Token obtenido y rangos consultados.",
            numbering_ranges_found=len(ranges),
        )
    except FactusAPIError as exc:
        return SaaSFactusIssuerTestOut(
            ok=False,
            environment=env_name,
            message=format_factus_error_detail(exc)[:500],
            numbering_ranges_found=None,
        )


@router.get("/billing/checkout-sessions", response_model=SaaSCheckoutSessionListOut)
def list_billing_checkout_sessions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    tenant_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, description="Búsqueda por tenant, sesión, referencia PSP o documento FE"),
    view_tab: str = Query(default="all", description="Vista: all | pending | paid | fe_issue"),
    sort_by: str = Query(default="created_at", description="Orden: created_at | total_cop | status | tenant"),
    sort_dir: str = Query(default="desc", description="Dirección: asc | desc"),
    fe_status: str | None = Query(
        default=None,
        description="Filtrar por saas_fe_status: ok | error | skipped | pending (aún sin estado o vacío)",
    ),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    """Sesiones de pago de suscripción (Wompi) y estado de factura electrónica de licencia (Factus SaaS / PROMETHEUS)."""
    base_q = (
        db.query(
            TenantBillingCheckoutSession,
            Tenant.slug,
            Tenant.nombre_comercial,
            FacturaElectronica,
        )
        .join(Tenant, Tenant.id == TenantBillingCheckoutSession.tenant_id)
        .outerjoin(
            FacturaElectronica,
            FacturaElectronica.billing_checkout_session_id == TenantBillingCheckoutSession.id,
        )
    )
    if tenant_id:
        try:
            t_uuid = UUID(tenant_id.strip())
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tenant_id inválido")
        base_q = base_q.filter(TenantBillingCheckoutSession.tenant_id == t_uuid)
    st = (status_filter or "").strip()
    if st:
        base_q = base_q.filter(TenantBillingCheckoutSession.status == st)

    fe_f = (fe_status or "").strip().lower()
    if fe_f == "pending":
        base_q = base_q.filter(
            or_(
                TenantBillingCheckoutSession.saas_fe_status.is_(None),
                TenantBillingCheckoutSession.saas_fe_status == "",
            )
        )
    elif fe_f in ("ok", "error", "skipped"):
        base_q = base_q.filter(TenantBillingCheckoutSession.saas_fe_status == fe_f)
    elif fe_f:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fe_status inválido: use ok, error, skipped o pending",
        )

    search = (q or "").strip()
    if search:
        pattern = f"%{search}%"
        base_q = base_q.filter(
            or_(
                Tenant.nombre_comercial.ilike(pattern),
                Tenant.slug.ilike(pattern),
                func.cast(TenantBillingCheckoutSession.id, String).ilike(pattern),
                TenantBillingCheckoutSession.payment_ref.ilike(pattern),
                TenantBillingCheckoutSession.epayco_ref.ilike(pattern),
                FacturaElectronica.numero_documento.ilike(pattern),
            )
        )

    tab = (view_tab or "all").strip().lower()
    if tab not in {"all", "pending", "paid", "fe_issue"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="view_tab inválido: use all, pending, paid o fe_issue")

    def _count_distinct(query):
        return int(
            query.with_entities(func.count(func.distinct(TenantBillingCheckoutSession.id)))
            .order_by(None)
            .scalar()
            or 0
        )

    count_all = _count_distinct(base_q)
    count_pending = _count_distinct(base_q.filter(TenantBillingCheckoutSession.status != "paid"))
    count_paid = _count_distinct(base_q.filter(TenantBillingCheckoutSession.status == "paid"))
    count_fe_issue = _count_distinct(
        base_q.filter(
            TenantBillingCheckoutSession.status == "paid",
            or_(
                TenantBillingCheckoutSession.saas_fe_status.is_(None),
                TenantBillingCheckoutSession.saas_fe_status != "ok",
            ),
        )
    )

    q_rows = base_q
    if tab == "pending":
        q_rows = q_rows.filter(TenantBillingCheckoutSession.status != "paid")
    elif tab == "paid":
        q_rows = q_rows.filter(TenantBillingCheckoutSession.status == "paid")
    elif tab == "fe_issue":
        q_rows = q_rows.filter(
            TenantBillingCheckoutSession.status == "paid",
            or_(
                TenantBillingCheckoutSession.saas_fe_status.is_(None),
                TenantBillingCheckoutSession.saas_fe_status != "ok",
            ),
        )

    dir_desc = (sort_dir or "desc").strip().lower() != "asc"
    sort_key = (sort_by or "created_at").strip().lower()
    if sort_key == "total_cop":
        sort_col = TenantBillingCheckoutSession.total_cop
    elif sort_key == "status":
        sort_col = TenantBillingCheckoutSession.status
    elif sort_key == "tenant":
        sort_col = Tenant.nombre_comercial
    else:
        sort_col = TenantBillingCheckoutSession.created_at

    order_primary = sort_col.desc() if dir_desc else sort_col.asc()
    total = _count_distinct(q_rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    safe_page = min(page, total_pages)
    offset = (safe_page - 1) * page_size

    rows = (
        q_rows.order_by(order_primary, TenantBillingCheckoutSession.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    out: list[SaaSCheckoutSessionItem] = []
    for s, slug, nombre, fe in rows:
        err_msg = s.saas_fe_error[:2000] if s.saas_fe_error else None
        out.append(
            SaaSCheckoutSessionItem(
                session_id=str(s.id),
                tenant_id=str(s.tenant_id),
                tenant_slug=slug,
                tenant_nombre=nombre,
                plan_code=s.plan_code,
                sedes_totales=s.sedes_totales,
                total_cop=float(s.total_cop) if s.total_cop is not None else 0.0,
                status=s.status,
                created_at=s.created_at,
                completed_at=s.completed_at,
                payment_provider=s.payment_provider,
                payment_ref=s.payment_ref,
                epayco_ref=s.epayco_ref,
                saas_fe_status=s.saas_fe_status,
                saas_fe_error=err_msg,
                saas_fe_error_category=categorize_saas_fe_error(status=s.saas_fe_status, error_message=err_msg),
                saas_fe_reference_code=extract_saas_fe_reference_code(err_msg),
                numero_documento=fe.numero_documento if fe else None,
                cufe=fe.cufe if fe else None,
                public_url=fe.public_url if fe else None,
            )
        )
    return SaaSCheckoutSessionListOut(
        items=out,
        total=total,
        page=safe_page,
        page_size=page_size,
        total_pages=total_pages,
        counts=SaaSCheckoutSessionCountsOut(
            all=count_all,
            pending=count_pending,
            paid=count_paid,
            fe_issue=count_fe_issue,
        ),
    )


@router.get("/billing/checkout-sessions/export")
def export_billing_checkout_sessions_csv(
    tenant_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, description="Búsqueda por tenant, sesión, referencia PSP o documento FE"),
    view_tab: str = Query(default="all", description="Vista: all | pending | paid | fe_issue"),
    sort_by: str = Query(default="created_at", description="Orden: created_at | total_cop | status | tenant"),
    sort_dir: str = Query(default="desc", description="Dirección: asc | desc"),
    fe_status: str | None = Query(
        default=None,
        description="Filtrar por saas_fe_status: ok | error | skipped | pending (aún sin estado o vacío)",
    ),
    max_rows: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    base_q = (
        db.query(
            TenantBillingCheckoutSession,
            Tenant.slug,
            Tenant.nombre_comercial,
            FacturaElectronica,
        )
        .join(Tenant, Tenant.id == TenantBillingCheckoutSession.tenant_id)
        .outerjoin(
            FacturaElectronica,
            FacturaElectronica.billing_checkout_session_id == TenantBillingCheckoutSession.id,
        )
    )
    if tenant_id:
        try:
            t_uuid = UUID(tenant_id.strip())
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tenant_id inválido")
        base_q = base_q.filter(TenantBillingCheckoutSession.tenant_id == t_uuid)

    st = (status_filter or "").strip()
    if st:
        base_q = base_q.filter(TenantBillingCheckoutSession.status == st)

    fe_f = (fe_status or "").strip().lower()
    if fe_f == "pending":
        base_q = base_q.filter(
            or_(
                TenantBillingCheckoutSession.saas_fe_status.is_(None),
                TenantBillingCheckoutSession.saas_fe_status == "",
            )
        )
    elif fe_f in ("ok", "error", "skipped"):
        base_q = base_q.filter(TenantBillingCheckoutSession.saas_fe_status == fe_f)
    elif fe_f:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fe_status inválido: use ok, error, skipped o pending",
        )

    search = (q or "").strip()
    if search:
        pattern = f"%{search}%"
        base_q = base_q.filter(
            or_(
                Tenant.nombre_comercial.ilike(pattern),
                Tenant.slug.ilike(pattern),
                func.cast(TenantBillingCheckoutSession.id, String).ilike(pattern),
                TenantBillingCheckoutSession.payment_ref.ilike(pattern),
                TenantBillingCheckoutSession.epayco_ref.ilike(pattern),
                FacturaElectronica.numero_documento.ilike(pattern),
            )
        )

    tab = (view_tab or "all").strip().lower()
    if tab not in {"all", "pending", "paid", "fe_issue"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="view_tab inválido: use all, pending, paid o fe_issue")

    q_rows = base_q
    if tab == "pending":
        q_rows = q_rows.filter(TenantBillingCheckoutSession.status != "paid")
    elif tab == "paid":
        q_rows = q_rows.filter(TenantBillingCheckoutSession.status == "paid")
    elif tab == "fe_issue":
        q_rows = q_rows.filter(
            TenantBillingCheckoutSession.status == "paid",
            or_(
                TenantBillingCheckoutSession.saas_fe_status.is_(None),
                TenantBillingCheckoutSession.saas_fe_status != "ok",
            ),
        )

    dir_desc = (sort_dir or "desc").strip().lower() != "asc"
    sort_key = (sort_by or "created_at").strip().lower()
    if sort_key == "total_cop":
        sort_col = TenantBillingCheckoutSession.total_cop
    elif sort_key == "status":
        sort_col = TenantBillingCheckoutSession.status
    elif sort_key == "tenant":
        sort_col = Tenant.nombre_comercial
    else:
        sort_col = TenantBillingCheckoutSession.created_at
    order_primary = sort_col.desc() if dir_desc else sort_col.asc()

    rows = (
        q_rows.order_by(order_primary, TenantBillingCheckoutSession.created_at.desc())
        .limit(max_rows)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "created_at",
            "tenant_slug",
            "tenant_nombre",
            "plan_code",
            "total_cop",
            "session_id",
            "status_pago",
            "saas_fe_status",
            "saas_fe_error_category",
            "saas_fe_reference_code",
            "saas_fe_error",
            "numero_documento",
            "cufe",
            "public_url",
            "payment_provider",
            "payment_ref",
            "epayco_ref",
        ]
    )
    for s, slug, nombre, fe in rows:
        err_msg = (s.saas_fe_error or "")[:2000]
        writer.writerow(
            [
                s.created_at.isoformat() if s.created_at else "",
                slug or "",
                nombre or "",
                s.plan_code or "",
                float(s.total_cop) if s.total_cop is not None else 0.0,
                str(s.id),
                s.status or "",
                s.saas_fe_status or "",
                categorize_saas_fe_error(status=s.saas_fe_status, error_message=err_msg),
                extract_saas_fe_reference_code(err_msg) or "",
                err_msg,
                fe.numero_documento if fe else "",
                fe.cufe if fe else "",
                fe.public_url if fe else "",
                s.payment_provider or "",
                s.payment_ref or "",
                s.epayco_ref or "",
            ]
        )

    output.seek(0)
    filename = f"checkout_sesiones_filtradas_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/billing/checkout-sessions/{session_id}/retry-saas-factus",
    response_model=TenantSaasFeLatestOut,
)
def saas_retry_checkout_session_saas_factus(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "finanzas"])),
):
    """
    Reintenta emisión FE (licencia) para un checkout ya pagado. No re-cobra.
    Misma lógica que el tenant, pero con alcance backoffice.
    """
    try:
        sid = UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de sesión inválido")

    row = db.query(TenantBillingCheckoutSession).filter(TenantBillingCheckoutSession.id == sid).first()
    if not row or row.status != "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sesión no encontrada o el pago no está confirmado",
        )
    fe0 = (
        db.query(FacturaElectronica)
        .filter(FacturaElectronica.billing_checkout_session_id == row.id)
        .first()
    )
    if row.saas_fe_status == "ok" and fe0 is None:
        row.saas_fe_status = "error"
        row.saas_fe_error = (
            "Estado FE inconsistente: sesión marcada como ok sin registro de factura electrónica. "
            "Se recomienda reintentar la emisión."
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    if row.saas_fe_status == "ok" and fe0 is not None:
        return _checkout_row_to_tenant_saas_fe_out(row, fe0)
    tenant = db.query(Tenant).filter(Tenant.id == row.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    try_emit_saas_billing_electronic_invoice(db, tenant=tenant, checkout=row)
    db.refresh(row)
    fe = (
        db.query(FacturaElectronica)
        .filter(FacturaElectronica.billing_checkout_session_id == row.id)
        .first()
    )
    create_saas_audit_log(
        db=db,
        action="saas_retry_checkout_factus",
        description=f"Reintento emisión FE licencia, sesión {row.id} tenant {tenant.slug}",
        actor=current_user,
        request=request,
        metadata={
            "session_id": str(row.id),
            "tenant_id": str(tenant.id),
            "saas_fe_status": row.saas_fe_status,
        },
    )
    return _checkout_row_to_tenant_saas_fe_out(row, fe)


@router.get("/support/tickets", response_model=SaaSSupportTicketListOut)
def list_support_tickets(
    tenant_slug: str | None = None,
    status_filter: str | None = None,
    priority: str | None = None,
    q: str | None = Query(default=None, description="Búsqueda por tenant, asunto, descripción o usuario"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=200),
    sort_by: str = Query(default="created_at", description="Orden: created_at | priority | status | tenant"),
    sort_dir: str = Query(default="desc", description="Dirección: asc | desc"),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "soporte", "comercial"])),
):
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
    search = (q or "").strip()
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Tenant.nombre_comercial.ilike(pattern),
                Tenant.slug.ilike(pattern),
                SaaSSupportTicket.title.ilike(pattern),
                SaaSSupportTicket.description.ilike(pattern),
                SaaSSupportTicket.status.ilike(pattern),
                SaaSSupportTicket.priority.ilike(pattern),
                assigned_user.email.ilike(pattern),
                created_user.email.ilike(pattern),
            )
        )

    dir_desc = (sort_dir or "desc").strip().lower() != "asc"
    sort_key = (sort_by or "created_at").strip().lower()
    if sort_key == "priority":
        sort_col = SaaSSupportTicket.priority
    elif sort_key == "status":
        sort_col = SaaSSupportTicket.status
    elif sort_key == "tenant":
        sort_col = Tenant.nombre_comercial
    else:
        sort_col = SaaSSupportTicket.created_at

    order_primary = sort_col.desc() if dir_desc else sort_col.asc()
    total = int(
        query.with_entities(func.count(func.distinct(SaaSSupportTicket.id)))
        .order_by(None)
        .scalar()
        or 0
    )
    total_pages = max(1, (total + page_size - 1) // page_size)
    safe_page = min(page, total_pages)
    offset = (safe_page - 1) * page_size
    rows = (
        query.order_by(order_primary, SaaSSupportTicket.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    items = [
        map_support_ticket_row(
            ticket=ticket,
            tenant_slug=t_slug,
            tenant_name=t_name,
            assigned_email=assigned_email,
            created_email=created_email,
        )
        for ticket, t_slug, t_name, assigned_email, created_email in rows
    ]
    return SaaSSupportTicketListOut(
        items=items,
        total=total,
        page=safe_page,
        page_size=page_size,
        total_pages=total_pages,
    )


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
        notificaciones_pendientes=abiertos + en_progreso,
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
            ticket.resolved_at = utcnow_naive()
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
            ticket.tenant_responded_at = utcnow_naive()
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


@router.get("/audit-logs", response_model=SaaSAuditLogListOut)
def list_saas_audit_logs(
    action: str | None = None,
    actor_email: str | None = None,
    tenant_slug: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = Query(default=None, description="Búsqueda por acción, descripción, actor, tenant o IP"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort_by: str = Query(default="created_at", description="Orden: created_at | action | success | tenant | actor"),
    sort_dir: str = Query(default="desc", description="Dirección: asc | desc"),
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "soporte"])),
):
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

    search = (q or "").strip()
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                AuditLog.action.ilike(pattern),
                AuditLog.description.ilike(pattern),
                AuditLog.usuario_email.ilike(pattern),
                AuditLog.usuario_nombre.ilike(pattern),
                AuditLog.ip_address.ilike(pattern),
                AuditLog.success.ilike(pattern),
                Tenant.slug.ilike(pattern),
            )
        )

    dir_desc = (sort_dir or "desc").strip().lower() != "asc"
    sort_key = (sort_by or "created_at").strip().lower()
    if sort_key == "action":
        sort_col = AuditLog.action
    elif sort_key == "success":
        sort_col = AuditLog.success
    elif sort_key == "tenant":
        sort_col = Tenant.slug
    elif sort_key == "actor":
        sort_col = AuditLog.usuario_email
    else:
        sort_col = AuditLog.created_at

    order_primary = sort_col.desc() if dir_desc else sort_col.asc()
    total = int(
        query.with_entities(func.count(func.distinct(AuditLog.id)))
        .order_by(None)
        .scalar()
        or 0
    )
    total_pages = max(1, (total + page_size - 1) // page_size)
    safe_page = min(page, total_pages)
    offset = (safe_page - 1) * page_size

    rows = (
        query.order_by(order_primary, AuditLog.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    items = [
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
    return SaaSAuditLogListOut(
        items=items,
        total=total,
        page=safe_page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/audit-logs/export")
def export_saas_audit_logs_csv(
    action: str | None = None,
    actor_email: str | None = None,
    tenant_slug: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    max_rows: int = 5000,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "soporte"])),
):
    result = list_saas_audit_logs(
        action=action,
        actor_email=actor_email,
        tenant_slug=tenant_slug,
        date_from=date_from,
        date_to=date_to,
        q=q,
        page=1,
        page_size=max_rows,
        sort_by=sort_by,
        sort_dir=sort_dir,
        db=db,
        _=_,
    )
    rows = result.items

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
    now_ts = utcnow_naive()
    all_users = db.query(SaaSUser).all()
    total_users = len(all_users)
    active_users = len([u for u in all_users if u.activo])
    mfa_users = len([u for u in all_users if u.mfa_enabled])
    locked_users = len([
        u for u in all_users
        if as_naive_utc(u.bloqueado_hasta) and as_naive_utc(u.bloqueado_hasta) > now_ts
    ])

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
