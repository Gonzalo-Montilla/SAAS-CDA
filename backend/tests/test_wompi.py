"""
Regresión Wompi: firma de integridad checkout y firma de eventos webhook.
Sin BD.
"""
import hashlib

import pytest

import app.integrations.wompi as wompi


def test_compute_wompi_integrity_signature_vector_fijo():
    expected = hashlib.sha256("ref12390000COPsecretXYZ".encode("utf-8")).hexdigest()
    got = wompi.compute_wompi_integrity_signature(
        reference="ref123",
        amount_in_cents=90000,
        currency="COP",
        integrity_secret="secretXYZ",
    )
    assert got == expected


def test_compute_wompi_integrity_signature_with_expiration():
    expected = hashlib.sha256(
        "ref12390000COP2026-04-30T12:00:00.000ZsecretXYZ".encode("utf-8")
    ).hexdigest()
    got = wompi.compute_wompi_integrity_signature(
        reference="ref123",
        amount_in_cents=90000,
        currency="COP",
        expiration_time="2026-04-30T12:00:00.000Z",
        integrity_secret="secretXYZ",
    )
    assert got == expected


def _sample_event_payload() -> dict:
    return {
        "event": "transaction.updated",
        "data": {
            "transaction": {
                "id": "1234-1610641025-49201",
                "status": "APPROVED",
                "amount_in_cents": 4490000,
            }
        },
        "signature": {
            "properties": [
                "transaction.id",
                "transaction.status",
                "transaction.amount_in_cents",
            ],
            "checksum": "",
        },
        "timestamp": 1530291411,
    }


def test_compute_wompi_event_checksum():
    payload = _sample_event_payload()
    secret = "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z"
    checksum = wompi.compute_wompi_event_checksum(payload, secret)
    assert checksum == hashlib.sha256(
        "1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z".encode(
            "utf-8"
        )
    ).hexdigest().upper()


def test_validate_wompi_event_signature_ok(monkeypatch: pytest.MonkeyPatch):
    payload = _sample_event_payload()
    secret = "test_events_secret"
    checksum = wompi.compute_wompi_event_checksum(payload, secret)
    payload["signature"]["checksum"] = checksum
    monkeypatch.setattr(wompi.settings, "WOMPI_EVENTS_SECRET", secret, raising=False)
    wompi.validate_wompi_event_signature(payload)


def test_validate_wompi_event_signature_bad(monkeypatch: pytest.MonkeyPatch):
    payload = _sample_event_payload()
    payload["signature"]["checksum"] = "BAD"
    monkeypatch.setattr(wompi.settings, "WOMPI_EVENTS_SECRET", "test_events_secret", raising=False)
    with pytest.raises(ValueError, match="inválida"):
        wompi.validate_wompi_event_signature(payload)


def test_wompi_transaction_is_hard_approved():
    assert wompi.wompi_transaction_is_hard_approved({"status": "APPROVED"}) is True
    assert wompi.wompi_transaction_is_hard_approved({"status": "DECLINED"}) is False
