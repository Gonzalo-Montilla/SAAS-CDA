"""
Facturación self-service del tenant: planes, cotización, checkout Wompi (mock en dev).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_db, require_role
from app.integrations.saas_factus_billing import try_emit_saas_billing_electronic_invoice
from app.integrations.wompi import (
    WompiError,
    build_wompi_checkout_url,
    compute_wompi_integrity_signature,
    extract_wompi_event_transaction,
    fetch_wompi_transaction,
    validate_wompi_event_signature,
    wompi_configured,
    wompi_events_secret_configured,
    wompi_transaction_is_hard_approved,
)
from app.models.tenant import Tenant
from app.models.tenant_billing_checkout import TenantBillingCheckoutSession
from app.models.factus import FacturaElectronica
from app.models.usuario import Usuario
from app.services.saas_billing_plans import (
    IVA_RATE,
    PLAN_DEFINITIONS,
    calculate_plan_quote,
    plan_codes_for_public_checkout,
)
from app.services.saas_fe_diagnostics import (
    categorize_saas_fe_error,
    extract_saas_fe_reference_code,
)
from app.services.tenant_billing_checkout import apply_successful_tenant_checkout, session_for_tenant
from app.services.tenant_billing_state import (
    billing_gate_for_demo_tenant,
    refresh_tenant_billing_state,
    soft_grace_ends_at,
)

router = APIRouter()
_log = logging.getLogger(__name__)


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _public_backend_base_url() -> str:
    """
    Normaliza BACKEND_PUBLIC_BASE_URL y tolera copiado accidental desde ngrok
    con formato "https://xxx.ngrok... -> http://localhost:8000".
    """
    raw = (settings.BACKEND_PUBLIC_BASE_URL or "").strip()
    if "->" in raw:
        raw = raw.split("->", 1)[0].strip()
    return raw.rstrip("/")


def _wompi_public_response_url(session_id: UUID) -> str:
    """
    Wompi redirige a URL pública; si frontend local, usar bridge backend.
    Si FRONTEND_URL es localhost, usar bridge público en backend y redirigir al front local.
    """
    front = settings.FRONTEND_URL.rstrip("/")
    low = front.lower()
    if low.startswith("http://localhost") or low.startswith("https://localhost") or "127.0.0.1" in low:
        base_back = _public_backend_base_url()
        return f"{base_back}/api/v1/tenant/billing/response-bridge?session={session_id}"
    return f"{front}/suscripcion?session={session_id}"


def _wompi_amount_in_cents(total_cop: float) -> int:
    return int(round(float(total_cop) * 100))


class TenantBillingPlanItem(BaseModel):
    code: str
    label: str
    duration_days: int
    base_price: float
    additional_branch_price: float
    included_branches: int
    iva_rate: float
    is_prepay: bool


class TenantBillingQuoteOut(BaseModel):
    plan_code: str
    plan_label: str
    sedes_totales: int
    included_branches: int
    chargeable_additional_branches: int
    subtotal: float
    iva: float
    total: float
    period_days: int


class TenantBillingGateOut(BaseModel):
    gate: str = Field(description="ok | trial | soft | hard")
    subscription_status: str
    plan_actual: str
    demo_ends_at: datetime | None = None
    soft_grace_ends_at: datetime | None = None


class TenantQuoteRequest(BaseModel):
    plan_code: str
    sedes_totales: int = Field(ge=1, le=100)


class TenantInitPaymentOut(BaseModel):
    session_id: str
    total_cop: float
    mode: str = Field(
        description="redirect | unconfigured | mock"
    )
    redirect_url: str | None = Field(default=None, description="URL checkout Wompi.")
    wompi_reference: str | None = None
    wompi_public_key: str | None = None
    message: str | None = None


class TenantConfirmWompiBody(BaseModel):
    session_id: UUID
    transaction_id: str | None = None


class TenantSaasFeLatestOut(BaseModel):
    """Última sesión de pago de suscripción y estado de emisión (Factus emisor SaaS, no el Factus del CDA)."""

    session_id: str | None = None
    plan_code: str | None = None
    total_cop: float | None = None
    saas_fe_status: str | None = None
    saas_fe_error: str | None = None
    saas_fe_error_category: str | None = None
    saas_fe_reference_code: str | None = None
    numero_documento: str | None = None
    cufe: str | None = None
    public_url: str | None = None


@router.get("/gate", response_model=TenantBillingGateOut)
def get_billing_gate(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    refresh_tenant_billing_state(db, tenant)
    db.refresh(tenant)

    gate = billing_gate_for_demo_tenant(tenant)
    soft_end = None
    if tenant.demo_ends_at:
        soft_end = soft_grace_ends_at(tenant.demo_ends_at)

    return TenantBillingGateOut(
        gate=gate,
        subscription_status=tenant.subscription_status or "",
        plan_actual=tenant.plan_actual,
        demo_ends_at=tenant.demo_ends_at,
        soft_grace_ends_at=soft_end,
    )


@router.get("/plans", response_model=list[TenantBillingPlanItem])
def list_tenant_billing_plans(
    _: Usuario = Depends(get_current_user),
):
    codes = plan_codes_for_public_checkout()
    return [
        TenantBillingPlanItem(
            code=c,
            label=PLAN_DEFINITIONS[c]["label"],
            duration_days=PLAN_DEFINITIONS[c]["duration_days"],
            base_price=PLAN_DEFINITIONS[c]["base_price"],
            additional_branch_price=PLAN_DEFINITIONS[c]["additional_branch_price"],
            included_branches=PLAN_DEFINITIONS[c]["included_branches"],
            iva_rate=IVA_RATE,
            is_prepay=PLAN_DEFINITIONS[c]["is_prepay"],
        )
        for c in codes
    ]


@router.post("/quote", response_model=TenantBillingQuoteOut)
def quote_tenant_plan(
    body: TenantQuoteRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if body.plan_code.strip().lower() not in plan_codes_for_public_checkout():
        raise HTTPException(status_code=400, detail="Elige un plan de pago válido (no demo)")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    plan, ch, sub, iva, total = calculate_plan_quote(body.plan_code, body.sedes_totales)
    return TenantBillingQuoteOut(
        plan_code=body.plan_code.strip().lower(),
        plan_label=plan["label"],
        sedes_totales=body.sedes_totales,
        included_branches=plan["included_branches"],
        chargeable_additional_branches=ch,
        subtotal=sub,
        iva=iva,
        total=total,
        period_days=plan["duration_days"],
    )


@router.post("/init-payment", response_model=TenantInitPaymentOut)
def init_tenant_checkout(
    body: TenantQuoteRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_role(["administrador"])),
):
    if body.plan_code.strip().lower() not in plan_codes_for_public_checkout():
        raise HTTPException(status_code=400, detail="Plan de pago inválido")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    _plan, _ch, sub, iva, total = calculate_plan_quote(body.plan_code, body.sedes_totales)
    session_row = TenantBillingCheckoutSession(
        tenant_id=tenant.id,
        plan_code=body.plan_code.strip().lower(),
        sedes_totales=body.sedes_totales,
        subtotal_cop=sub,
        iva_cop=iva,
        total_cop=total,
        status="pending",
        payment_provider="wompi",
        idempotency_key=f"tenantpay-{tenant.id}-{utcnow_naive().timestamp():.0f}",
    )
    db.add(session_row)
    db.commit()
    db.refresh(session_row)

    # Sin PSP real: dev mock o mensaje
    if settings.PAYMENT_DEV_MOCK_ENABLE and settings.ENVIRONMENT != "production":
        return TenantInitPaymentOut(
            session_id=str(session_row.id),
            total_cop=total,
            mode="mock",
            message="PAYMENT_DEV_MOCK_ENABLE: usa POST /tenant/billing/complete-mock con session_id",
        )
    if not wompi_configured():
        return TenantInitPaymentOut(
            session_id=str(session_row.id),
            total_cop=total,
            mode="unconfigured",
            message="Pasarela no configurada (WOMPI_PUBLIC_KEY/WOMPI_INTEGRITY_SECRET en .env).",
        )

    resp_url = _wompi_public_response_url(session_row.id)
    _conf_url = f"{_public_backend_base_url()}/api/v1/tenant/billing/webhooks/wompi"
    nombre = (tenant.nombre_representante or tenant.nombre_comercial or "Cliente")[:200]
    email = (tenant.correo_electronico or current_user.email or "cliente@local")[:200]
    public_key = (settings.WOMPI_PUBLIC_KEY or "").strip()
    integrity_secret = (settings.WOMPI_INTEGRITY_SECRET or "").strip()
    reference = str(session_row.id)
    amount_in_cents = _wompi_amount_in_cents(float(total))
    signature = compute_wompi_integrity_signature(
        reference=reference,
        amount_in_cents=amount_in_cents,
        currency="COP",
        integrity_secret=integrity_secret,
    )
    redirect = build_wompi_checkout_url(
        public_key=public_key,
        currency="COP",
        amount_in_cents=amount_in_cents,
        reference=reference,
        signature_integrity=signature,
        redirect_url=resp_url,
        customer_email=email,
        customer_full_name=nombre,
    )
    return TenantInitPaymentOut(
        session_id=str(session_row.id),
        total_cop=total,
        mode="redirect",
        redirect_url=redirect,
        wompi_reference=reference,
        wompi_public_key=public_key,
    )


@router.get("/response-bridge")
def wompi_response_bridge(request: Request):
    """
    Redirect público para Wompi -> frontend local.
    Preserva query params (session + id).
    """
    base_front = settings.FRONTEND_URL.rstrip("/")
    target = f"{base_front}/suscripcion"
    pairs = list(request.query_params.multi_items())
    if pairs:
        return RedirectResponse(url=f"{target}?{urlencode(pairs, doseq=True)}", status_code=307)
    return RedirectResponse(url=target, status_code=307)


def _apply_wompi_transaction_to_session(
    db: Session, tx: dict, *, source: str = "webhook"
) -> dict:
    """
    source: "webhook" (evento Wompi) | "return" (consulta por id transacción) | "mock".
    """
    reference = str(tx.get("reference") or "").strip()
    tx_id = str(tx.get("id") or "").strip()
    if not reference:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sin referencia de pago")
    try:
        sid = UUID(str(reference))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Referencia de sesión inválida"
        ) from exc
    row = db.query(TenantBillingCheckoutSession).filter(TenantBillingCheckoutSession.id == sid).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sesión no encontrada")
    if row.status == "paid":
        _log.info(
            "tenant_billing wompi duplicate session_id=%s source=%s tx_id=%s",
            row.id,
            source,
            tx_id,
        )
        return {"ok": True, "duplicate": True}

    amount_in_cents = int(tx.get("amount_in_cents") or 0)
    expected_cents = _wompi_amount_in_cents(float(row.total_cop))
    if amount_in_cents and expected_cents and amount_in_cents != expected_cents:
        _log.warning(
            "tenant_billing wompi amount_mismatch session_id=%s expected=%s got=%s",
            row.id,
            expected_cents,
            amount_in_cents,
        )
        row.last_webhook_payload = tx
        db.add(row)
        db.commit()
        return {"ok": False, "reason": "amount_mismatch"}

    if not wompi_transaction_is_hard_approved(tx):
        row.last_webhook_payload = tx
        db.add(row)
        db.commit()
        _log.info(
            "tenant_billing wompi not_approved session_id=%s source=%s tx_id=%s status=%s",
            row.id,
            source,
            tx_id,
            tx.get("status"),
        )
        return {"ok": False, "reason": "not_approved"}
    tenant = db.query(Tenant).filter(Tenant.id == row.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    row.payment_provider = "wompi"
    row.payment_ref = tx_id or reference
    row.epayco_ref = None
    row.last_webhook_payload = tx
    db.add(row)
    db.flush()
    applied = apply_successful_tenant_checkout(db, tenant=tenant, session_row=row)
    if not applied:
        db.commit()
    if applied:
        _log.info(
            "tenant_billing wompi paid session_id=%s tenant_id=%s source=%s tx_id=%s",
            row.id,
            row.tenant_id,
            source,
            tx_id,
        )
    else:
        _log.info(
            "tenant_billing wompi paid ya aplicado (carrera webhook/return) session_id=%s tx_id=%s",
            row.id,
            tx_id,
        )
    return {"ok": True}


@router.post("/webhooks/wompi")
async def wompi_webhook_tenant_billing(request: Request, db: Session = Depends(get_db)):
    """Eventos Wompi (JSON). Valida checksum con WOMPI_EVENTS_SECRET."""
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload inválido")
    if not wompi_events_secret_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Wompi events no configurado")
    try:
        validate_wompi_event_signature(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Firma Wompi inválida") from exc
    event_name = str(payload.get("event") or "").strip()
    if event_name != "transaction.updated":
        return {"ok": True, "ignored": True}
    tx = extract_wompi_event_transaction(payload)
    if not tx:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Evento sin transaction")
    return _apply_wompi_transaction_to_session(db, tx, source="webhook")


@router.post("/confirm-return")
def confirm_checkout_return(
    body: TenantConfirmWompiBody,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Tras redirect del checkout Wompi: consulta transacción por id y aplica resultado."""
    row = session_for_tenant(db, body.session_id, current_user.tenant_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sesión no encontrada")
    tx_id = (body.transaction_id or "").strip()
    if not tx_id:
        return {"ok": False, "reason": "missing_transaction_id"}
    try:
        tx = fetch_wompi_transaction(
            transaction_id=tx_id,
            use_sandbox=bool(settings.WOMPI_USE_SANDBOX),
        )
    except WompiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No fue posible consultar transacción Wompi: {exc}",
        ) from exc
    return _apply_wompi_transaction_to_session(db, tx, source="return")


@router.post("/complete-mock")
def complete_checkout_mock(
    session_id: UUID = Query(..., description="ID de sesión devuelto por init-payment"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_role(["administrador"])),
):
    """Solo desarrollo: marca pago aprobado sin ePayco."""
    if not settings.PAYMENT_DEV_MOCK_ENABLE or str(settings.ENVIRONMENT).lower() == "production":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No habilitado")
    row = session_for_tenant(db, session_id, current_user.tenant_id)
    if not row or row.status != "pending":
        raise HTTPException(status_code=400, detail="Sesión no pendiente")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    tx = {
        "id": f"wompi-mock-{row.id}",
        "reference": str(row.id),
        "status": "APPROVED",
        "amount_in_cents": _wompi_amount_in_cents(float(row.total_cop)),
        "currency": "COP",
    }
    return _apply_wompi_transaction_to_session(db, tx, source="mock")


def _row_to_saas_fe_out(
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


@router.get("/saas-fe/latest", response_model=TenantSaasFeLatestOut)
def get_latest_saas_billing_factus_status(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    row = (
        db.query(TenantBillingCheckoutSession)
        .filter(
            TenantBillingCheckoutSession.tenant_id == current_user.tenant_id,
            TenantBillingCheckoutSession.status == "paid",
            TenantBillingCheckoutSession.completed_at.isnot(None),
        )
        .order_by(TenantBillingCheckoutSession.completed_at.desc())
        .first()
    )
    if not row:
        return TenantSaasFeLatestOut()
    fe = (
        db.query(FacturaElectronica)
        .filter(FacturaElectronica.billing_checkout_session_id == row.id)
        .first()
    )
    if row.saas_fe_status == "ok" and fe is None:
        row.saas_fe_status = "error"
        row.saas_fe_error = (
            "Estado FE inconsistente: sesión marcada como ok sin registro de factura electrónica. "
            "Reintente la emisión desde esta vista."
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return _row_to_saas_fe_out(row, fe)


@router.post("/sessions/{session_id}/retry-saas-factus", response_model=TenantSaasFeLatestOut)
def retry_saas_billing_factus_emission(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_role(["administrador"])),
):
    """
    Reintenta emisión a Factus (PROMETHEUS) para un pago ya confirmado, p. ej. si falló la DIAN
    o aún no estaban `SAAS_BILLING_FACTUS_*` en .env. No re-cobra.
    """
    row = session_for_tenant(db, session_id, current_user.tenant_id)
    if not row or row.status != "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Sesión no encontrada o el pago no está confirmado",
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
        return _row_to_saas_fe_out(row, fe0)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    try_emit_saas_billing_electronic_invoice(db, tenant=tenant, checkout=row)
    db.refresh(row)
    fe = (
        db.query(FacturaElectronica)
        .filter(FacturaElectronica.billing_checkout_session_id == row.id)
        .first()
    )
    return _row_to_saas_fe_out(row, fe)