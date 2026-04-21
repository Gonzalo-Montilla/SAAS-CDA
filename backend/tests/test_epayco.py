"""
Regresión: firma de confirmación ePayco, bundle de return y aprobación.
Sin BD. settings solo en tests que validan la firma vía claves fijas.
"""
import hashlib

import pytest

import app.integrations.epayco as epayco


def test_compute_epayco_confirmation_signature_vector_fijo():
    # Cadena documentada: a^b^c^d^e^f
    c = "a^b^c^d^e^f"
    expected = hashlib.sha256(c.encode("utf-8")).hexdigest()
    assert epayco.compute_epayco_confirmation_signature("a", "b", "c", "d", "e", "f") == expected


def test_epayco_return_signature_bundle_status():
    assert epayco.epayco_return_signature_bundle_status({}) == "empty"
    assert epayco.epayco_return_signature_bundle_status({"x_ref_payco": "1"}) == "empty"
    assert (
        epayco.epayco_return_signature_bundle_status(
            {
                "x_signature": "s",
                "x_transaction_id": "t",
                "x_amount": "100",
                "x_ref_payco": "r",
            }
        )
        == "full"
    )
    assert (
        epayco.epayco_return_signature_bundle_status(
            {"x_signature": "s", "x_amount": "100", "x_ref_payco": "r"}  # falta x_transaction_id
        )
        == "partial"
    )
    assert epayco.epayco_return_signature_bundle_status({"x_amount": "100"}) == "partial"


def test_epayco_transaction_approved():
    assert epayco.epayco_transaction_approved({"x_cod_response": "1"}) is True
    assert epayco.epayco_transaction_approved({"x_response": "Aceptada"}) is True
    assert epayco.epayco_transaction_approved({"x_response": "Rechazada"}) is False
    assert epayco.epayco_transaction_approved({}) is False


def test_epayco_amount_matches_total():
    assert epayco.epayco_amount_matches_total({"x_amount": "100000.0"}, 100000, max_diff=1.0) is True
    assert epayco.epayco_amount_matches_total({"x_amount": "100,000.50"}, 100000.0, max_diff=1.1) is True
    assert epayco.epayco_amount_matches_total({"x_amount": "1"}, 100000) is False
    assert epayco.epayco_amount_matches_total({}, 100) is False


def test_validate_epayco_webhook_signature_ok(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(epayco.settings, "EPAYCO_CLIENT_ID", "cust-1", raising=False)
    monkeypatch.setattr(epayco.settings, "EPAYCO_P_KEY", "pkey-1", raising=False)
    form = {
        "x_ref_payco": "r1",
        "x_transaction_id": "t1",
        "x_amount": "50000",
        "x_currency_code": "COP",
    }
    form["x_signature"] = epayco.compute_epayco_confirmation_signature(
        "cust-1", "pkey-1", form["x_ref_payco"], form["x_transaction_id"], form["x_amount"], "COP"
    )
    epayco.validate_epayco_webhook_signature(form)


def test_validate_epayco_webhook_signature_firma_mala(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(epayco.settings, "EPAYCO_CLIENT_ID", "cust-1", raising=False)
    monkeypatch.setattr(epayco.settings, "EPAYCO_P_KEY", "pkey-1", raising=False)
    form = {
        "x_ref_payco": "r1",
        "x_transaction_id": "t1",
        "x_amount": "50000",
        "x_currency_code": "COP",
        "x_signature": "0" * 64,
    }
    with pytest.raises(ValueError, match="no coincide"):
        epayco.validate_epayco_webhook_signature(form)
