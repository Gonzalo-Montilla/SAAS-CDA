"""
Pagos SaaS: periodo tras cobro y “último pago” (manual + checkout).
No emite FE ni cambia el flujo de asignar plan.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


def as_naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def parse_iso_datetime(raw: Any, fallback: datetime | None = None) -> datetime | None:
    if raw is None or raw == "":
        return fallback
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return fallback
    return as_naive_utc(parsed)


def parse_money(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return round(float(raw), 2)
    except (TypeError, ValueError):
        return None


def period_end_after_payment(
    paid_at: datetime,
    existing_next_billing_at: datetime | None,
    cycle_days: int,
) -> datetime:
    """
    Próximo cobro = ciclo desde el pago, o desde el vencimiento vigente si pagan adelantado.
    Así no se pierden días restantes. Si ya venció, el ciclo arranca en paid_at.
    """
    paid = as_naive_utc(paid_at) or paid_at
    existing = as_naive_utc(existing_next_billing_at)
    days = max(int(cycle_days or 0), 1)
    base = existing if existing is not None and existing > paid else paid
    return base + timedelta(days=days)


def checkout_paid_at(completed_at: datetime | None, created_at: datetime | None) -> datetime | None:
    return as_naive_utc(completed_at) or as_naive_utc(created_at)


def checkout_receipt_reference(
    *,
    payment_ref: str | None,
    epayco_ref: str | None,
    session_id: Any,
) -> str:
    for candidate in (payment_ref, epayco_ref):
        text = (str(candidate).strip() if candidate is not None else "")
        if text:
            return text
    sid = str(session_id or "").replace("-", "")
    return f"ONLINE-{sid[:8].upper()}" if sid else "ONLINE"


@dataclass(frozen=True)
class LastPaymentView:
    paid_at: datetime | None
    amount: float | None
    receipt_reference: str | None
    payment_log_id: str | None
    source: str | None


def resolve_last_payment(
    *,
    tenant_last_payment_at: datetime | None,
    manual_log_id: str | None,
    manual_paid_at: datetime | None,
    manual_amount: float | None,
    manual_reference: str | None,
    checkout_paid_at_value: datetime | None,
    checkout_amount: float | None,
    checkout_reference: str | None,
) -> LastPaymentView:
    """
    Elige el evento más reciente. Monto y recibo salen de ese mismo evento
    (no mezcla fecha ePayco con un recibo manual viejo).
    Empate: checkout (cobro real).
    """
    candidates: list[tuple[datetime, int, str, float | None, str | None, str | None]] = []
    manual_ts = as_naive_utc(manual_paid_at)
    if manual_ts is not None:
        candidates.append((manual_ts, 0, "manual", manual_amount, manual_reference, manual_log_id))
    checkout_ts = as_naive_utc(checkout_paid_at_value)
    if checkout_ts is not None:
        candidates.append(
            (checkout_ts, 1, "checkout", checkout_amount, checkout_reference, None)
        )
    if not candidates:
        return LastPaymentView(
            paid_at=as_naive_utc(tenant_last_payment_at),
            amount=None,
            receipt_reference=None,
            payment_log_id=None,
            source=None,
        )
    _ts, _pref, source, amount, reference, log_id = max(candidates, key=lambda row: (row[0], row[1]))
    return LastPaymentView(
        paid_at=_ts,
        amount=amount,
        receipt_reference=reference,
        payment_log_id=log_id,
        source=source,
    )
