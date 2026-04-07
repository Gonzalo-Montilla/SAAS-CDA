"""
Cliente HTTP para API Factus (OAuth2 + facturas).
Documentación: https://developers.factus.com.co/
"""
from __future__ import annotations

import json
from typing import Any, Optional
from urllib.parse import quote, urlencode

import httpx

from app.core.config import settings


class FactusAPIError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _flatten_factus_errors(errs: Any, prefix: str = "") -> list[str]:
    """Normaliza `errors` como dict, lista anidada o mensajes Laravel."""
    out: list[str] = []
    if isinstance(errs, dict):
        for k, v in errs.items():
            key = f"{prefix}{k}" if prefix else str(k)
            if isinstance(v, list):
                out.append(f"{key}: {', '.join(str(x) for x in v)}")
            elif isinstance(v, dict):
                out.extend(_flatten_factus_errors(v, f"{key}."))
            else:
                out.append(f"{key}: {v}")
    elif isinstance(errs, list):
        for item in errs:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                out.append(json.dumps(item, ensure_ascii=False))
    return out


def format_factus_error_detail(e: FactusAPIError) -> str:
    """
    Mensaje legible para UI/logs cuando Factus responde 4xx/5xx (422 con distintas formas de `errors`).
    Si el mensaje sigue siendo genérico, se adjunta JSON del cuerpo para diagnóstico.
    """
    body = e.body

    if isinstance(body, str) and body.strip():
        return body.strip()[:4500]

    if isinstance(body, dict):
        msg = body.get("message") or body.get("error_description")
        raw_err = body.get("error")
        if msg is None and isinstance(raw_err, str):
            msg = raw_err
        elif isinstance(raw_err, dict):
            msg = msg or raw_err.get("message")

        errs = body.get("errors")
        flat = _flatten_factus_errors(errs) if errs is not None else []

        if not flat and isinstance(body.get("data"), dict):
            nested = body["data"]
            if isinstance(nested, dict):
                msg = msg or nested.get("message")
                ne = nested.get("errors")
                if ne is not None:
                    flat = _flatten_factus_errors(ne)

        if flat:
            base = str(msg).strip() if msg else "Error de validación"
            extra = "; ".join(flat[:24])
            return f"{base} — {extra}"[:4500]

        if msg:
            s = str(msg).strip()
            if s.lower() in ("error de validación", "validation error", "unprocessable entity") or len(s) < 8:
                try:
                    return json.dumps(body, ensure_ascii=False)[:4500]
                except Exception:
                    pass
            return s[:4500]

    if isinstance(body, (dict, list)):
        try:
            return json.dumps(body, ensure_ascii=False)[:4500]
        except Exception:
            pass

    if e.args and str(e.args[0]):
        return str(e.args[0])[:4500]
    return "Error al comunicarse con Factus"


def factus_base_url(*, use_sandbox: bool) -> str:
    if use_sandbox:
        return settings.FACTUS_SANDBOX_BASE_URL.rstrip("/")
    return settings.FACTUS_PRODUCTION_BASE_URL.rstrip("/")


def obtain_token(
    *,
    base_url: str,
    client_id: str,
    client_secret: str,
    username: str,
    password: str,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """
    POST /oauth/token (grant_type=password).
    """
    url = f"{base_url.rstrip('/')}/oauth/token"
    payload = urlencode(
        {
            "grant_type": "password",
            "client_id": client_id,
            "client_secret": client_secret,
            "username": username,
            "password": password,
        }
    )
    with httpx.Client(timeout=timeout) as client:
        r = client.post(
            url,
            content=payload,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
    if r.status_code >= 400:
        raise FactusAPIError(
            "No se pudo obtener token de Factus",
            status_code=r.status_code,
            body=_safe_json(r),
        )
    data = r.json()
    if "access_token" not in data:
        raise FactusAPIError("Respuesta Factus sin access_token", body=data)
    return data


def get_numbering_ranges(
    *,
    base_url: str,
    access_token: str,
    is_active: int | None = 1,
    timeout: float = 60.0,
) -> list[dict[str, Any]]:
    """
    GET /v1/numbering-ranges — rangos de numeración de la cuenta Factus (mismo ambiente que el token).

    Documentación: https://developers.factus.com.co/rangos-de-numeracion/obtener-rangos/
    El campo `id` de cada ítem es el que debe guardarse como default_numbering_range_id.
    La factura electrónica de venta usa document \"01\"; el rango debe corresponder a ese tipo en Factus.
    """
    url = f"{base_url.rstrip('/')}/v1/numbering-ranges"
    params: dict[str, str] = {}
    if is_active is not None:
        params["filter[is_active]"] = str(is_active)
    with httpx.Client(timeout=timeout) as client:
        r = client.get(
            url,
            params=params or None,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )
    data = _safe_json(r)
    if r.status_code >= 400:
        raise FactusAPIError(
            "No se pudieron obtener los rangos de numeración en Factus",
            status_code=r.status_code,
            body=data,
        )
    rows: list[dict[str, Any]] = []
    if isinstance(data, dict):
        inner = data.get("data")
        if isinstance(inner, dict):
            arr = inner.get("data")
            if isinstance(arr, list):
                rows = [x for x in arr if isinstance(x, dict)]
        elif isinstance(inner, list):
            rows = [x for x in inner if isinstance(x, dict)]
    return rows


def validate_invoice(
    *,
    base_url: str,
    access_token: str,
    body: dict[str, Any],
    timeout: float = 90.0,
) -> dict[str, Any]:
    """POST /v1/bills/validate"""
    url = f"{base_url.rstrip('/')}/v1/bills/validate"
    with httpx.Client(timeout=timeout) as client:
        r = client.post(
            url,
            json=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )
    data = _safe_json(r)
    if r.status_code >= 400:
        raise FactusAPIError(
            "Factus rechazó la factura de prueba",
            status_code=r.status_code,
            body=data,
        )
    return data if isinstance(data, dict) else {"raw": data}


def get_bill_show(
    *,
    base_url: str,
    access_token: str,
    number: str,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """
    GET /v1/bills/show/:number — documento validado en Factus (cliente, ítems, totales, CUFE).
    Documentación: https://developers.factus.com.co/facturas/ver/
    """
    n = quote((number or "").strip(), safe="")
    url = f"{base_url.rstrip('/')}/v1/bills/show/{n}"
    with httpx.Client(timeout=timeout) as client:
        r = client.get(
            url,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )
    data = _safe_json(r)
    if r.status_code >= 400:
        raise FactusAPIError(
            "No se pudo consultar la factura en Factus",
            status_code=r.status_code,
            body=data,
        )
    return data if isinstance(data, dict) else {"raw": data}


def _safe_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:
        return r.text


def refresh_token(
    *,
    base_url: str,
    client_id: str,
    client_secret: str,
    refresh_token_value: str,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """POST /oauth/token (grant_type=refresh_token) — cuando Factus lo exponga igual que en doc."""
    url = f"{base_url.rstrip('/')}/oauth/token"
    payload = urlencode(
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token_value,
        }
    )
    with httpx.Client(timeout=timeout) as client:
        r = client.post(
            url,
            content=payload,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
    if r.status_code >= 400:
        raise FactusAPIError(
            "No se pudo refrescar token de Factus",
            status_code=r.status_code,
            body=_safe_json(r),
        )
    return r.json()
