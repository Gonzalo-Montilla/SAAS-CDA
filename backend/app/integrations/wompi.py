"""
Integración mínima Wompi (Checkout Web + Eventos + consulta de transacción).

Docs:
- Widget & Checkout Web: https://docs.wompi.co/docs/colombia/widget-checkout-web/
- Eventos: https://docs.wompi.co/docs/colombia/eventos/
"""
from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import settings


class WompiError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def wompi_configured() -> bool:
    return bool(
        (settings.WOMPI_PUBLIC_KEY or "").strip()
        and (settings.WOMPI_INTEGRITY_SECRET or "").strip()
    )


def wompi_events_secret_configured() -> bool:
    return bool((settings.WOMPI_EVENTS_SECRET or "").strip())


def wompi_checkout_base_url() -> str:
    return "https://checkout.wompi.co/p/"


def wompi_api_base_url(*, use_sandbox: bool) -> str:
    if use_sandbox:
        raw = (settings.WOMPI_SANDBOX_BASE_URL or "").strip()
    else:
        raw = (settings.WOMPI_PRODUCTION_BASE_URL or "").strip()
    base = raw.rstrip("/")
    # Tolerar configuración con o sin /v1 en .env
    if base.endswith("/v1"):
        return base
    return f"{base}/v1"


def compute_wompi_integrity_signature(
    *,
    reference: str,
    amount_in_cents: int,
    currency: str,
    integrity_secret: str,
    expiration_time: str | None = None,
) -> str:
    # Según docs Wompi: <reference><amount_in_cents><currency>[<expiration_time>]<secret>
    payload = f"{reference}{int(amount_in_cents)}{currency}"
    if expiration_time:
        payload += str(expiration_time)
    payload += integrity_secret
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_wompi_checkout_url(
    *,
    public_key: str,
    currency: str,
    amount_in_cents: int,
    reference: str,
    signature_integrity: str,
    redirect_url: str | None = None,
    customer_email: str | None = None,
    customer_full_name: str | None = None,
    customer_phone: str | None = None,
    customer_legal_id: str | None = None,
    customer_legal_id_type: str | None = None,
) -> str:
    params: dict[str, str] = {
        "public-key": public_key,
        "currency": currency,
        "amount-in-cents": str(int(amount_in_cents)),
        "reference": reference,
        "signature:integrity": signature_integrity,
    }
    if redirect_url:
        params["redirect-url"] = redirect_url
    if customer_email:
        params["customer-data:email"] = customer_email
    if customer_full_name:
        params["customer-data:full-name"] = customer_full_name
    if customer_phone:
        params["customer-data:phone-number"] = customer_phone
    if customer_legal_id:
        params["customer-data:legal-id"] = customer_legal_id
    if customer_legal_id_type:
        params["customer-data:legal-id-type"] = customer_legal_id_type
    return f"{wompi_checkout_base_url()}?{urlencode(params)}"


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return (resp.text or "")[:2000]


def fetch_wompi_transaction(
    *,
    transaction_id: str,
    use_sandbox: bool,
    timeout: float = 30.0,
) -> dict[str, Any]:
    tid = (transaction_id or "").strip()
    if not tid:
        raise WompiError("transaction_id requerido")
    base = wompi_api_base_url(use_sandbox=use_sandbox)
    url = f"{base}/transactions/{tid}"
    with httpx.Client(timeout=timeout) as client:
        resp = client.get(
            url,
            headers={"Accept": "application/json"},
        )
    data = _safe_json(resp)
    if resp.status_code >= 400:
        raise WompiError(
            "No fue posible consultar la transacción en Wompi",
            status_code=resp.status_code,
            body=data,
        )
    if not isinstance(data, dict):
        raise WompiError("Respuesta Wompi inválida", body=data)
    inner = data.get("data")
    if not isinstance(inner, dict):
        raise WompiError("Respuesta Wompi sin data", body=data)
    return inner


def wompi_transaction_is_hard_approved(tx: dict[str, Any]) -> bool:
    status = str(tx.get("status") or "").strip().upper()
    return status == "APPROVED"


def extract_wompi_event_transaction(payload: dict[str, Any]) -> dict[str, Any] | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    tx = data.get("transaction")
    if not isinstance(tx, dict):
        return None
    return tx


def _extract_dotted_path(data: dict[str, Any], dotted: str) -> str:
    cur: Any = data
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return ""
    if cur is None:
        return ""
    return str(cur)


def compute_wompi_event_checksum(payload: dict[str, Any], events_secret: str) -> str:
    sig = payload.get("signature")
    if not isinstance(sig, dict):
        raise ValueError("Evento Wompi sin signature")
    props = sig.get("properties")
    if not isinstance(props, list):
        raise ValueError("Evento Wompi sin signature.properties")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Evento Wompi sin data")
    ts = payload.get("timestamp")
    if ts is None:
        raise ValueError("Evento Wompi sin timestamp")
    concat = "".join(_extract_dotted_path(data, str(p)) for p in props)
    concat += str(ts)
    concat += str(events_secret)
    return hashlib.sha256(concat.encode("utf-8")).hexdigest().upper()


def validate_wompi_event_signature(payload: dict[str, Any]) -> None:
    secret = (settings.WOMPI_EVENTS_SECRET or "").strip()
    if not secret:
        raise ValueError("WOMPI_EVENTS_SECRET no configurado")
    sig = payload.get("signature")
    if not isinstance(sig, dict):
        raise ValueError("Evento Wompi sin signature")
    got = str(sig.get("checksum") or "").strip().upper()
    if not got:
        raise ValueError("Evento Wompi sin checksum")
    expected = compute_wompi_event_checksum(payload, secret)
    if got != expected:
        raise ValueError("Firma de evento Wompi inválida")
