"""
Facturación self-service del tenant: planes, cotización, checkout ePayco (mock en dev).
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
from app.integrations.epayco import (
    build_epayco_checkout_get_url,
    epayco_amount_matches_total,
    epayco_configured,
    epayco_return_signature_bundle_status,
    epayco_webhook_signature_configured,
    parse_epayco_approval,
    validate_epayco_webhook_signature,
)
from app.integrations.epayco_apify import (
    EpaycoApifyError,
    apify_bearer_from_keys,
    apify_smoke_configured,
    create_smart_checkout_session,
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


def _epayco_public_response_url(session_id: UUID) -> str:
    """
    ePayco Apify exige response URL pública/valida.
    Si FRONTEND_URL es localhost, usar bridge público en backend y redirigir al front local.
    """
    front = settings.FRONTEND_URL.rstrip("/")
    low = front.lower()
    if low.startswith("http://localhost") or low.startswith("https://localhost") or "127.0.0.1" in low:
        base_back = settings.BACKEND_PUBLIC_BASE_URL.rstrip("/")
        return f"{base_back}/api/v1/tenant/billing/response-bridge?session={session_id}"
    return f"{front}/suscripcion?session={session_id}"


def _epayco_body_has_amount_range_error(body: object) -> bool:
    if not isinstance(body, dict):
        return False
    data = body.get("data")
    if not isinstance(data, dict):
        return False
    errors = data.get("errors")
    if not isinstance(errors, list):
        return False
    for e in errors:
        if not isinstance(e, dict):
            continue
        msg = str(e.get("errorMessage") or "").lower()
        if "amount must be between 5000 and 200000" in msg:
            return True
    return False


def _epayco_is_hard_approved(form: dict) -> bool:
    """
    Evita falsos positivos por estados intermedios (p. ej. pre-procesada en PSE).
    Aprobado real: x_cod_response/cod_respuesta == 1.
    """
    cod = form.get("x_cod_response") or form.get("cod_respuesta")
    if parse_epayco_approval(str(cod) if cod is not None else None, None):
        x_state = str(form.get("x_cod_transaction_state") or "").strip()
        # Si ePayco envía estado de transacción explícito y no es "1", aún no está aprobada.
        if x_state and x_state != "1":
            return False
        return True
    return False


def _effective_epayco_test_amount_cop() -> float | None:
    """
    En no-producción, permite forzar monto de pago ePayco para cuentas test con límites.
    Devuelve None si no aplica.
    """
    if str(settings.ENVIRONMENT).lower() == "production":
        return None
    if not bool(settings.EPAYCO_TEST_MODE):
        return None
    raw = float(settings.EPAYCO_TEST_OVERRIDE_AMOUNT_COP or 0)
    if raw <= 0:
        return None
    # ePayco test observado en esta cuenta: 5.000 - 200.000 COP
    return float(max(5000.0, min(200000.0, raw)))


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
        description="smart_checkout (Apify v2) | redirect (GET legacy) | unconfigured | mock"
    )
    redirect_url: str | None = Field(
        default=None, description="URL checkout.php; solo modo redirect legacy."
    )
    epayco_session_id: str | None = None
    epayco_public_key: str | None = None
    epayco_checkout_test: bool = True
    message: str | None = None


class TenantConfirmEpaycoBody(BaseModel):
    """Reenviar desde el redirect de ePayco: con EPAYCO_CLIENT_ID+P_KEY en el servidor, hace falta el paquete completo de firma."""

    session_id: UUID
    ref_payco: str | None = None
    cod_response: str | None = None
    x_response: str | None = None
    x_signature: str | None = None
    x_transaction_id: str | None = None
    x_amount: str | None = None
    x_currency_code: str | None = None


class TenantSaasFeLatestOut(BaseModel):
    """Última sesión de pago de suscripción y estado de emisión (Factus emisor SaaS, no el Factus del CDA)."""

    session_id: str | None = None
    plan_code: str | None = None
    total_cop: float | None = None
    saas_fe_status: str | None = None
    saas_fe_error: str | None = None
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
    forced_amount = _effective_epayco_test_amount_cop()
    if forced_amount is not None:
        # Pruebas: conservar coherencia de la sesión de cobro con el valor realmente enviado a ePayco.
        sub = float(forced_amount)
        iva = 0.0
        total = float(forced_amount)
        _log.warning(
            "tenant_billing epayco test override amount session_preview plan=%s forced_total=%s",
            body.plan_code,
            total,
        )
    session_row = TenantBillingCheckoutSession(
        tenant_id=tenant.id,
        plan_code=body.plan_code.strip().lower(),
        sedes_totales=body.sedes_totales,
        subtotal_cop=sub,
        iva_cop=iva,
        total_cop=total,
        status="pending",
        idempotency_key=f"tenantpay-{tenant.id}-{utcnow_naive().timestamp():.0f}",
    )
    db.add(session_row)
    db.commit()
    db.refresh(session_row)

    # Sin ePayco: dev mock o mensaje
    if settings.EPAYCO_DEV_MOCK_ENABLE and settings.ENVIRONMENT != "production":
        return TenantInitPaymentOut(
            session_id=str(session_row.id),
            total_cop=total,
            mode="mock",
            message="EPAYCO_DEV_MOCK_ENABLE: usa POST /tenant/billing/complete-mock con session_id",
        )
    if not epayco_configured():
        return TenantInitPaymentOut(
            session_id=str(session_row.id),
            total_cop=total,
            mode="unconfigured",
            message="Pasarela no configurada (EPAYCO_PUBLIC_KEY en .env). El administrador puede registrar el pago desde backoffice.",
        )

    resp_url = _epayco_public_response_url(session_row.id)
    conf_url = f"{settings.BACKEND_PUBLIC_BASE_URL.rstrip('/')}/api/v1/tenant/billing/webhooks/epayco"
    nombre = (tenant.nombre_representante or tenant.nombre_comercial or "Cliente")[:200]
    email = (tenant.correo_electronico or current_user.email or "cliente@local")[:200]
    pk = (settings.EPAYCO_PUBLIC_KEY or "").strip()
    test_flag = bool(settings.EPAYCO_TEST_MODE)

    if apify_smoke_configured():
        try:
            bearer = apify_bearer_from_keys(
                settings.EPAYCO_PUBLIC_KEY,
                (settings.EPAYCO_PRIVATE_KEY or "").strip(),
            )
            apify_data = create_smart_checkout_session(
                bearer=bearer,
                store_display_name="CDASOFT — licencia SaaS",
                amount_cop=float(total),
                invoice=str(session_row.id),
                description=f"Plan {body.plan_code} — suscripción CDASOFT",
                response_url=resp_url,
                confirmation_url=conf_url,
                customer_email=email,
                customer_name=nombre,
            )
            sid = apify_data.get("sessionId") or apify_data.get("session_id")
            if not sid:
                raise EpaycoApifyError("Respuesta Apify sin sessionId", body=apify_data)
            return TenantInitPaymentOut(
                session_id=str(session_row.id),
                total_cop=total,
                mode="smart_checkout",
                epayco_session_id=str(sid),
                epayco_public_key=pk,
                epayco_checkout_test=test_flag,
                message=(
                    f"Pruebas ePayco: monto forzado a COP {int(total):,}".replace(",", ".")
                    if forced_amount is not None
                    else None
                ),
            )
        except EpaycoApifyError as exc:
            # Límite típico de cuentas test ePayco: evitar fallback legacy (404) y mostrar error accionable.
            if _epayco_body_has_amount_range_error(getattr(exc, "body", None)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "ePayco pruebas rechazó el monto: el comercio está limitado a pagos entre "
                        "COP 5.000 y COP 200.000. Para continuar, reduzca temporalmente el valor de la "
                        "prueba o solicite en ePayco ampliar el límite de monto de la cuenta de pruebas."
                    ),
                ) from exc
            # Fallback a redirección GET (checkout.php) con la misma factura/URLs
            _log.warning(
                "tenant_billing epayco apify session fallback session_id=%s reason=%s body=%s",
                session_row.id,
                exc,
                getattr(exc, "body", None),
            )

    redirect = build_epayco_checkout_get_url(
        amount_cop=total,
        invoice=str(session_row.id),
        title=f"Plan {body.plan_code} CDASOFT",
        email=email,
        name=nombre,
        url_response=resp_url,
        url_confirmation=conf_url,
    )
    return TenantInitPaymentOut(
        session_id=str(session_row.id),
        total_cop=total,
        mode="redirect",
        redirect_url=redirect,
        epayco_public_key=pk,
        epayco_checkout_test=test_flag,
        message=(
            f"Pruebas ePayco: monto forzado a COP {int(total):,}".replace(",", ".")
            if forced_amount is not None
            else None
        ),
    )


@router.get("/response-bridge")
def epayco_response_bridge(request: Request):
    """
    Redirect público para ePayco -> frontend local.
    Preserva query params (session + x_*), que luego Suscripcion reenvía a confirm-return.
    """
    base_front = settings.FRONTEND_URL.rstrip("/")
    target = f"{base_front}/suscripcion"
    pairs = list(request.query_params.multi_items())
    if pairs:
        return RedirectResponse(url=f"{target}?{urlencode(pairs, doseq=True)}", status_code=307)
    return RedirectResponse(url=target, status_code=307)


def _epayco_amount_in_form(form: dict) -> bool:
    raw = str(
        form.get("x_amount") or form.get("x_amount_approved") or form.get("amount") or ""
    ).strip()
    return bool(raw)


def _apply_epayco_form_to_session(
    db: Session, form: dict, *, source: str = "webhook"
) -> dict:
    """
    source: "webhook" (confirma server-to-server ePayco) | "return" (JSON del front) | "mock"
    En webhook se valida x_signature si EPAYCO_CLIENT_ID + EPAYCO_P_KEY están definidos.
    """
    invoice = form.get("x_id_invoice") or form.get("invoice") or form.get("p_order_id")
    cod = form.get("x_cod_response") or form.get("cod_respuesta")
    ref = form.get("x_ref_payco") or form.get("ref_payco")
    if not invoice:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sin referencia de pago")
    try:
        sid = UUID(str(invoice))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Referencia de sesión inválida"
        ) from exc
    row = db.query(TenantBillingCheckoutSession).filter(TenantBillingCheckoutSession.id == sid).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sesión no encontrada")
    if row.status == "paid":
        _log.info(
            "tenant_billing epayco duplicate session_id=%s source=%s ref=%s",
            row.id,
            source,
            ref,
        )
        return {"ok": True, "duplicate": True}

    if source == "webhook":
        try:
            validate_epayco_webhook_signature(form)
        except ValueError as exc:
            _log.warning("tenant_billing epayco signature: %s session_id=%s", exc, sid)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Firma ePayco inválida"
            ) from exc
        if _epayco_amount_in_form(form) and not epayco_amount_matches_total(
            form, float(row.total_cop)
        ):
            _log.warning(
                "tenant_billing epayco amount_mismatch session_id=%s total_row=%s",
                row.id,
                row.total_cop,
            )
            row.last_webhook_payload = form
            db.add(row)
            db.commit()
            return {"ok": False, "reason": "amount_mismatch"}
    elif source == "return" and epayco_webhook_signature_configured():
        if not str(form.get("x_currency_code") or "").strip():
            form["x_currency_code"] = "COP"
        bundle = epayco_return_signature_bundle_status(form)
        if bundle == "full":
            try:
                validate_epayco_webhook_signature(form)
            except ValueError as exc:
                _log.warning("tenant_billing epayco confirm signature: %s session_id=%s", exc, sid)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="Firma ePayco inválida"
                ) from exc
            if _epayco_amount_in_form(form) and not epayco_amount_matches_total(
                form, float(row.total_cop)
            ):
                _log.warning(
                    "tenant_billing epayco confirm amount_mismatch session_id=%s total_row=%s",
                    row.id,
                    row.total_cop,
                )
                row.last_webhook_payload = form
                db.add(row)
                db.commit()
                return {"ok": False, "reason": "amount_mismatch"}
        elif bundle == "partial":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Faltan parámetros ePayco para la firma (x_signature, x_transaction_id, x_amount, x_ref_payco).",
            )
        else:
            if str(settings.ENVIRONMENT).lower() == "production":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Reenvíe en el cuerpo de la petición x_signature, x_transaction_id, x_amount, x_ref_payco (y x_currency_code) tal como responde ePayco, o confíe en la notificación al webhook.",
                )
            _log.warning(
                "tenant_billing epayco confirm sin paquete de firma (modo no producción) session_id=%s",
                row.id,
            )

    if not _epayco_is_hard_approved(form):
        x_state = form.get("x_cod_transaction_state")
        x_resp = form.get("x_response") or form.get("Response")
        row.last_webhook_payload = form
        db.add(row)
        db.commit()
        _log.info(
            "tenant_billing epayco not_approved session_id=%s source=%s cod=%s x_state=%s x_response=%s",
            row.id,
            source,
            cod,
            x_state,
            x_resp,
        )
        return {"ok": False, "reason": "not_approved"}
    tenant = db.query(Tenant).filter(Tenant.id == row.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    row.epayco_ref = str(ref) if ref else None
    row.last_webhook_payload = form
    db.add(row)
    db.flush()
    applied = apply_successful_tenant_checkout(db, tenant=tenant, session_row=row)
    if not applied:
        db.commit()
    if applied:
        _log.info(
            "tenant_billing epayco paid session_id=%s tenant_id=%s source=%s ref=%s",
            row.id,
            row.tenant_id,
            source,
            ref,
        )
    else:
        _log.info(
            "tenant_billing epayco paid ya aplicado (carrera webhook/return) session_id=%s ref=%s",
            row.id,
            ref,
        )
    return {"ok": True}


@router.post("/webhooks/epayco")
async def epayco_webhook_tenant_billing(request: Request, db: Session = Depends(get_db)):
    """Confirmación server-to-server ePayco (form-urlencoded). Valida x_signature si hay EPAYCO_CLIENT_ID y EPAYCO_P_KEY."""
    fd = await request.form()
    form_flat: dict = {}
    for key, value in fd.multi_items():
        if hasattr(value, "read"):
            continue
        form_flat[key] = str(value)
    return _apply_epayco_form_to_session(db, form_flat, source="webhook")


@router.post("/confirm-return")
def confirm_checkout_return(
    body: TenantConfirmEpaycoBody,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Tras redirect del checkout: el front reenvía los parámetros de la URL de ePayco (o el webhook aplica pago en paralelo)."""
    row = session_for_tenant(db, body.session_id, current_user.tenant_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sesión no encontrada")
    ccy = (body.x_currency_code or "").strip() or "COP"
    form = {
        "x_id_invoice": str(row.id),
        "x_cod_response": (body.cod_response or "").strip(),
        "x_ref_payco": (body.ref_payco or "").strip(),
        "x_response": (body.x_response or "").strip(),
        "x_signature": (body.x_signature or "").strip(),
        "x_transaction_id": (body.x_transaction_id or "").strip(),
        "x_amount": (body.x_amount or "").strip(),
        "x_currency_code": ccy,
    }
    return _apply_epayco_form_to_session(db, form, source="return")


@router.post("/complete-mock")
def complete_checkout_mock(
    session_id: UUID = Query(..., description="ID de sesión devuelto por init-payment"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_role(["administrador"])),
):
    """Solo desarrollo: marca pago aprobado sin ePayco."""
    if not settings.EPAYCO_DEV_MOCK_ENABLE or str(settings.ENVIRONMENT).lower() == "production":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No habilitado")
    row = session_for_tenant(db, session_id, current_user.tenant_id)
    if not row or row.status != "pending":
        raise HTTPException(status_code=400, detail="Sesión no pendiente")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    form = {
        "x_id_invoice": str(row.id),
        "x_cod_response": "1",
        "x_ref_payco": f"MOCK-{row.id}",
    }
    return _apply_epayco_form_to_session(db, form, source="mock")


def _row_to_saas_fe_out(
    row: TenantBillingCheckoutSession, fe: FacturaElectronica | None
) -> TenantSaasFeLatestOut:
    total = float(row.total_cop) if row.total_cop is not None else None
    return TenantSaasFeLatestOut(
        session_id=str(row.id),
        plan_code=row.plan_code,
        total_cop=total,
        saas_fe_status=row.saas_fe_status,
        saas_fe_error=(row.saas_fe_error[:2000] if row.saas_fe_error else None),
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