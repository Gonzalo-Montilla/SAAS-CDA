"""
Integración mínima ePayco: armado de URL de checkout y detección de aprobación.
Confirmación (firma): https://docs.epayco.com/docs/en/tabla-de-parametros-de-respuesta
Cadena: p_cust_id_cliente^p_key^x_ref_payco^x_transaction_id^x_amount^x_currency_code
→ SHA-256, comparar con x_signature (hex, sin importar mayúsculas/minúsculas).
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any
from urllib.parse import urlencode

from app.core.config import settings

_log = logging.getLogger(__name__)


def epayco_configured() -> bool:
    return bool((settings.EPAYCO_PUBLIC_KEY or "").strip())


def build_epayco_checkout_get_url(
    *,
    amount_cop: float,
    invoice: str,
    title: str,
    email: str,
    name: str,
    url_response: str,
    url_confirmation: str,
) -> str:
    """
    Redirección GET al checkout clásico (p_public_key, p_amount, etc.).
    Nombres de parámetros alineados con integración web estándar ePayco.
    """
    pk = (settings.EPAYCO_PUBLIC_KEY or "").strip()
    params = {
        "p_public_key": pk,
        "p_amount": f"{int(round(float(amount_cop))):d}",
        "p_currency": "COP",
        "p_order_id": invoice,
        "p_description": (title or "Suscripción CDASOFT")[:200],
        "p_email": email,
        "p_name": (name or "Cliente")[:80],
        "p_url_response": url_response,
        "p_url_confirmation": url_confirmation,
    }
    if settings.EPAYCO_TEST_MODE:
        params["p_test_request"] = "true"
    return f"https://secure.epayco.co/checkout/payment?{urlencode(params)}"


def parse_epayco_approval(cod_response: str | None, response_code: str | None) -> bool:
    """x_cod_response / cod_respuesta: 1 = aprobada en la integración común ePayco."""
    for val in (cod_response, response_code):
        if val is not None and str(val).strip() == "1":
            return True
    return False


def _norm_response_text(x_response: str | None) -> str:
    s = (x_response or "").strip().lower()
    s = s.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
    return s


def epayco_transaction_approved(form: dict[str, Any]) -> bool:
    """
    Aprobado si x_cod_response es 1 y/o (según integración) x_response indica aceptada.
    """
    cod = form.get("x_cod_response") or form.get("cod_respuesta")
    if parse_epayco_approval(str(cod) if cod is not None else None, None):
        return True
    xr = _norm_response_text(str(form.get("x_response") or form.get("Response") or ""))
    if xr == "aceptada" or xr == "aprobada":
        return True
    return False


def compute_epayco_confirmation_signature(
    p_cust_id: str, p_key: str, x_ref: str, x_txn: str, x_amount: str, x_cur: str
) -> str:
    """Misma cadena y SHA-256 que envía ePayco en x_signature (minúsculas, hex)."""
    chain = f"{p_cust_id}^{p_key}^{x_ref}^{x_txn}^{x_amount}^{x_cur}"
    return hashlib.sha256(chain.encode("utf-8")).hexdigest()


def epayco_webhook_signature_configured() -> bool:
    return bool((settings.EPAYCO_CLIENT_ID or "").strip() and (settings.EPAYCO_P_KEY or "").strip())


def _strip(form: dict[str, Any], key: str) -> str:
    return str(form.get(key) or "").strip()


def epayco_return_signature_bundle_status(form: dict[str, Any]) -> str:
    """
    Devuelve 'full' (listo para validar x_signature), 'partial' (datos contradictorios),
    o 'empty' (sin trío firma+transacción+monto, p. ej. solo ref/cod o sin campos ePayco).
    """
    sig = _strip(form, "x_signature") or _strip(form, "X_SIGNATURE")
    tid = _strip(form, "x_transaction_id")
    amt = _strip(form, "x_amount") or _strip(form, "x_amount_approved")
    ref = _strip(form, "x_ref_payco") or _strip(form, "ref_payco")
    if sig and tid and amt and ref:
        return "full"
    if sig or tid or amt:
        return "partial"
    return "empty"


def validate_epayco_webhook_signature(form: dict[str, Any]) -> None:
    """
    Valida x_signature con EPAYCO_CLIENT_ID (p_cust_id_cliente) y EPAYCO_P_KEY (p_key).
    Si faltan claves de firma, solo registra advertencia (desarrollo / hasta onboarding comercio).
    """
    cust = (settings.EPAYCO_CLIENT_ID or "").strip()
    pkey = (settings.EPAYCO_P_KEY or "").strip()
    if not cust or not pkey:
        _log.warning("ePayco webhook: EPAYCO_CLIENT_ID/EPAYCO_P_KEY no configurados; no se verifica x_signature")
        return
    got = (str(form.get("x_signature") or form.get("X_SIGNATURE") or "")).strip().lower()
    if not got:
        raise ValueError("ePayco webhook: falta x_signature con claves de firma configuradas")
    x_ref = str(form.get("x_ref_payco") or form.get("ref_payco") or "")
    x_tid = str(form.get("x_transaction_id") or form.get("transaction_id") or "")
    x_amt = str(form.get("x_amount") or form.get("x_amount_approved") or form.get("amount") or "")
    x_cur = (str(form.get("x_currency_code") or "COP")).strip() or "COP"
    expected = compute_epayco_confirmation_signature(cust, pkey, x_ref, x_tid, x_amt, x_cur).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", got):
        raise ValueError("ePayco webhook: x_signature con formato inválido")
    if not (got == expected):
        raise ValueError("ePayco webhook: x_signature no coincide")


def epayco_amount_matches_total(form: dict[str, Any], total_cop: float, *, max_diff: float = 1.0) -> bool:
    """Compara monto de confirmación (string, posible con decimales) con total almacenado en COP."""
    raw = str(form.get("x_amount") or form.get("x_amount_approved") or form.get("amount") or "").strip()
    if not raw:
        return False
    s = raw.replace(" ", "")
    # 100,000.50: miles y punto decimal; 12,5 sin punto: separador decimal
    if "." in s and "," in s and s.rfind(".") > s.rfind(","):
        s = s.replace(",", "")
    elif re.fullmatch(r"\d{1,3}(?:,\d{3})+", s or ""):
        s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        x_val = float(s)
    except ValueError:
        return False
    t = float(total_cop)
    return abs(x_val - t) <= max_diff
