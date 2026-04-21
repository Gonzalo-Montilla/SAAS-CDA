"""
Aplicar pago aprobado: asigna plan y ventana de facturación (misma lógica base que backoffice).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.tenant import Tenant
from app.models.tenant_billing_checkout import TenantBillingCheckoutSession
from app.integrations.saas_factus_billing import try_emit_saas_billing_electronic_invoice
from app.services.saas_billing_plans import PLAN_DEFINITIONS, calculate_plan_quote


def apply_successful_tenant_checkout(
    db: Session,
    *,
    tenant: Tenant,
    session_row: TenantBillingCheckoutSession,
    paid_at: datetime | None = None,
) -> bool:
    """
    Serializa con FOR UPDATE (webhook + confirm-return): solo una ruta aplica pago
    a una sesión pendiente. Devuelve True si esta llamada aplicó, False si ya estaba en paid
    otra transacción.
    """
    srow = (
        db.query(TenantBillingCheckoutSession)
        .filter(TenantBillingCheckoutSession.id == session_row.id)
        .with_for_update()
        .first()
    )
    if not srow or srow.tenant_id != tenant.id:
        raise ValueError("Sesión de checkout inválida o no corresponde al tenant")
    if srow.status == "paid":
        return False
    trow = (
        db.query(Tenant)
        .filter(Tenant.id == srow.tenant_id)
        .with_for_update()
        .first()
    )
    if not trow:
        raise ValueError("Tenant no encontrado")
    if srow.status != "pending":
        return False
    plan_code = (srow.plan_code or "").strip().lower()
    if plan_code not in PLAN_DEFINITIONS or plan_code == "demo":
        raise ValueError("Plan de checkout inválido")
    plan, _chargeable, _sub, _iva, _total = calculate_plan_quote(
        plan_code, int(srow.sedes_totales or 1)
    )
    now_ts = paid_at or datetime.now(timezone.utc).replace(tzinfo=None)
    if now_ts.tzinfo is not None:
        now_ts = now_ts.astimezone(timezone.utc).replace(tzinfo=None)
    period_end = now_ts + timedelta(days=plan["duration_days"])

    trow.plan_actual = plan_code
    trow.sedes_totales = int(srow.sedes_totales)
    trow.plan_started_at = now_ts
    trow.plan_ends_at = None if plan_code == "demo" else period_end
    trow.billing_cycle_days = plan["duration_days"]
    trow.next_billing_at = period_end
    trow.last_payment_at = now_ts
    trow.subscription_status = "active" if plan_code != "demo" else "trial"
    if trow.demo_ends_at and plan_code != "demo":
        pass

    srow.status = "paid"
    srow.completed_at = now_ts
    db.add(trow)
    db.add(srow)
    db.commit()
    db.refresh(trow)
    db.refresh(srow)
    try_emit_saas_billing_electronic_invoice(db, tenant=trow, checkout=srow)
    return True


def session_for_tenant(
    db: Session, session_id: UUID, tenant_id: UUID
) -> TenantBillingCheckoutSession | None:
    return (
        db.query(TenantBillingCheckoutSession)
        .filter(
            TenantBillingCheckoutSession.id == session_id,
            TenantBillingCheckoutSession.tenant_id == tenant_id,
        )
        .first()
    )


__all__ = ["apply_successful_tenant_checkout", "session_for_tenant"]
