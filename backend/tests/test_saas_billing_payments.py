"""Unidad: periodo de cobro y último pago (manual vs checkout). Sin BD."""
from datetime import datetime, timedelta, timezone

from app.services.saas_billing_payments import (
    checkout_receipt_reference,
    period_end_after_payment,
    resolve_last_payment,
)


def test_period_end_starts_from_paid_at_when_overdue():
    paid = datetime(2026, 9, 10, 15, 0, 0)
    existing = datetime(2026, 8, 1, 15, 0, 0)
    end = period_end_after_payment(paid, existing, 90)
    assert end == paid + timedelta(days=90)


def test_period_end_keeps_remaining_days_if_paid_early():
    paid = datetime(2026, 9, 10, 15, 0, 0)
    existing = datetime(2026, 10, 1, 15, 0, 0)
    end = period_end_after_payment(paid, existing, 90)
    assert end == existing + timedelta(days=90)


def test_period_end_without_existing_next():
    paid = datetime(2026, 9, 10, 15, 0, 0)
    end = period_end_after_payment(paid, None, 180)
    assert end == paid + timedelta(days=180)


def test_period_end_normalizes_aware_utc():
    paid = datetime(2026, 9, 10, 20, 0, 0, tzinfo=timezone.utc)
    existing = datetime(2026, 9, 10, 15, 0, 0)
    end = period_end_after_payment(paid, existing, 30)
    assert end.tzinfo is None
    assert end == datetime(2026, 9, 10, 20, 0, 0) + timedelta(days=30)


def test_resolve_prefers_newer_checkout_over_old_manual_receipt():
    view = resolve_last_payment(
        tenant_last_payment_at=datetime(2026, 9, 10, 12, 0, 0),
        manual_log_id="log-old",
        manual_paid_at=datetime(2026, 8, 1, 12, 0, 0),
        manual_amount=100000.0,
        manual_reference="PAY-OLD",
        checkout_paid_at_value=datetime(2026, 9, 10, 12, 0, 0),
        checkout_amount=535500.0,
        checkout_reference="wompi-abc",
    )
    assert view.source == "checkout"
    assert view.amount == 535500.0
    assert view.receipt_reference == "wompi-abc"
    assert view.payment_log_id is None
    assert view.paid_at == datetime(2026, 9, 10, 12, 0, 0)


def test_resolve_prefers_newer_manual_over_old_checkout():
    view = resolve_last_payment(
        tenant_last_payment_at=datetime(2026, 9, 10, 18, 0, 0),
        manual_log_id="log-new",
        manual_paid_at=datetime(2026, 9, 10, 18, 0, 0),
        manual_amount=200000.0,
        manual_reference="PAY-NEW",
        checkout_paid_at_value=datetime(2026, 9, 1, 12, 0, 0),
        checkout_amount=535500.0,
        checkout_reference="wompi-old",
    )
    assert view.source == "manual"
    assert view.amount == 200000.0
    assert view.payment_log_id == "log-new"


def test_resolve_tie_prefers_checkout():
    same = datetime(2026, 9, 10, 12, 0, 0)
    view = resolve_last_payment(
        tenant_last_payment_at=same,
        manual_log_id="log-tie",
        manual_paid_at=same,
        manual_amount=1.0,
        manual_reference="PAY-TIE",
        checkout_paid_at_value=same,
        checkout_amount=2.0,
        checkout_reference="ONLINE",
    )
    assert view.source == "checkout"
    assert view.amount == 2.0


def test_resolve_without_events_keeps_tenant_date_without_amount():
    stamp = datetime(2026, 7, 1, 8, 0, 0)
    view = resolve_last_payment(
        tenant_last_payment_at=stamp,
        manual_log_id=None,
        manual_paid_at=None,
        manual_amount=None,
        manual_reference=None,
        checkout_paid_at_value=None,
        checkout_amount=None,
        checkout_reference=None,
    )
    assert view.paid_at == stamp
    assert view.amount is None
    assert view.source is None


def test_checkout_receipt_reference_prefers_payment_ref():
    assert (
        checkout_receipt_reference(
            payment_ref=" tx-1 ",
            epayco_ref="epayco-old",
            session_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        )
        == "tx-1"
    )


def test_checkout_receipt_reference_fallback_session():
    ref = checkout_receipt_reference(
        payment_ref=None,
        epayco_ref="",
        session_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )
    assert ref == "ONLINE-AAAAAAAA"
