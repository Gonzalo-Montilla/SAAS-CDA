"""
ePayco APIFY: login y creación de sesión Smart Checkout v2.
Documentación: https://docs.epayco.com/docs/checkout-implementacion
"""
from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

from app.core.config import settings

_log = logging.getLogger(__name__)

APIFY_BASE = "https://apify.epayco.co"


class EpaycoApifyError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def apify_bearer_from_keys(public_key: str, private_key: str) -> str:
    """POST /login con Authorization: Basic base64(PUBLIC_KEY:PRIVATE_KEY)."""
    pair = f"{public_key.strip()}:{private_key.strip()}"
    basic = base64.b64encode(pair.encode("utf-8")).decode("ascii")
    url = f"{APIFY_BASE}/login"
    with httpx.Client(timeout=45.0) as client:
        r = client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Basic {basic}",
            },
        )
    if r.status_code >= 400:
        raise EpaycoApifyError(
            f"Apify login falló: {r.status_code}",
            status_code=r.status_code,
            body=_safe_json(r),
        )
    data = r.json() if r.content else {}
    token = data.get("token")
    if not token:
        raise EpaycoApifyError("Apify login sin token en respuesta", body=data)
    return str(token)


def _safe_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:
        return (r.text or "")[:2000]


def create_smart_checkout_session(
    *,
    bearer: str,
    store_display_name: str,
    amount_cop: float,
    invoice: str,
    description: str,
    response_url: str,
    confirmation_url: str,
    customer_email: str,
    customer_name: str,
) -> dict[str, Any]:
    """
    POST /payment/session/create → { data: { sessionId, token } }.
    """
    body: dict[str, Any] = {
        "checkout_version": "2",
        "name": (store_display_name or "CDASOFT")[:200],
        "currency": "COP",
        "amount": float(round(float(amount_cop), 2)),
        "description": (description or "Suscripción licencia")[:500],
        "invoice": (invoice or "")[:80],
        "lang": "ES",
        "country": "CO",
        "response": response_url,
        "confirmation": confirmation_url,
        "method": "POST",
        "billing": {
            "email": (customer_email or "cliente@local")[:200],
            "name": (customer_name or "Cliente")[:200],
        },
    }
    url = f"{APIFY_BASE}/payment/session/create"
    with httpx.Client(timeout=60.0) as client:
        r = client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {bearer}",
            },
            json=body,
        )
    data = _safe_json(r) if r.content else {}
    if r.status_code >= 400:
        _log.warning("ePayco session/create %s: %s", r.status_code, data)
        raise EpaycoApifyError(
            "No se pudo crear la sesión de pago ePayco",
            status_code=r.status_code,
            body=data,
        )
    if not isinstance(data, dict) or not data.get("success"):
        raise EpaycoApifyError("Respuesta inesperada al crear sesión ePayco", body=data)
    inner = data.get("data")
    if not isinstance(inner, dict):
        raise EpaycoApifyError("Respuesta ePayco sin data.sessionId", body=data)
    return inner


def apify_smoke_configured() -> bool:
    return bool(
        (settings.EPAYCO_PUBLIC_KEY or "").strip() and (settings.EPAYCO_PRIVATE_KEY or "").strip()
    )
