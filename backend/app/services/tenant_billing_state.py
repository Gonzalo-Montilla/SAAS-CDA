"""
Estados de suscripción en plan demo: trial → soft_grace (5 días) → locked.
Después del pago el tenant deja plan «demo» y aplica facturación por plan contratado.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.models.tenant import Tenant

# Días adicionales tras vencer el demo_ends_at: modal suave, sin bloquear escritura.
SOFT_GRACE_DAYS_AFTER_DEMO = 5


def _now_naive_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def soft_grace_ends_at(demo_ends_at: datetime) -> datetime:
    return demo_ends_at + timedelta(days=SOFT_GRACE_DAYS_AFTER_DEMO)


def refresh_tenant_billing_state(db: Session, tenant: Tenant) -> str:
    """
    Ajusta subscription_status según el tiempo y plan demo.
    Retorna el estado resultante.
    Hace commit solo si hubo cambio.
    """
    if tenant.plan_actual != "demo":
        return (tenant.subscription_status or "").strip() or "active"

    if not tenant.demo_ends_at:
        return tenant.subscription_status or "trial"

    now_ts = _now_naive_utc()
    de = tenant.demo_ends_at
    if de.tzinfo is not None:
        de = de.astimezone(timezone.utc).replace(tzinfo=None)

    if now_ts <= de:
        new_status = "trial"
    elif now_ts <= soft_grace_ends_at(de):
        new_status = "soft_grace"
    else:
        new_status = "locked"

    old = (tenant.subscription_status or "").strip()
    if old != new_status:
        tenant.subscription_status = new_status
        db.add(tenant)
        db.commit()
        db.refresh(tenant)

    return new_status


def billing_gate_for_demo_tenant(tenant: Tenant) -> str:
    """ok | trial | soft | hard — solo con plan demo; si ya paga, ok."""
    if tenant.plan_actual != "demo":
        return "ok"
    st = (tenant.subscription_status or "").strip()
    if st == "trial":
        return "trial"
    if st == "soft_grace":
        return "soft"
    if st in {"locked", "pending_plan"}:
        return "hard"
    return "ok"
