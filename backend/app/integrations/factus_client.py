"""
Cliente HTTP para API Factus (OAuth2 + facturas).
Documentación: https://developers.factus.com.co/
"""
from __future__ import annotations

import base64
import json
import time
from typing import Any, Optional, Union
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


def format_factus_error_for_user(e: FactusAPIError) -> str:
    """
    Mensaje para Caja: detalle Factus + contexto (cuenta Factus vs CDASOFT, sin pedir al cajero Factus).
    """
    detail = format_factus_error_detail(e)
    low = detail.lower()
    if e.status_code == 409 or ("pendiente" in low and "dian" in low):
        hint = (
            " [CDASOFT] Este bloqueo lo aplica Factus sobre la cuenta electrónica configurada para este CDA "
            "(no indica un error de «ciudad» en el software). Suele deberse a un documento previo en cola "
            "ante la DIAN en esa misma cuenta (p. ej. pruebas en sandbox). Reenvíe este mensaje a CDASOFT "
            "para revisar la cuenta Factus; el cajero no debe pasar a facturación manual salvo indicación."
        )
        if len(detail) + len(hint) <= 5000:
            return detail + hint
    if "dsaj24b" in low or "dv del nit" in low:
        hint = (
            " [CDASOFT] El rechazo FAK24/DSAJ24B es por NIT-DV del **proveedor que Factus interpreta en ese documento**. "
            "Cuando el texto menciona `[CDASOFT]`, en la factura de licencia SaaS se refiere al **emisor PROMETHEUS/CDASOFT "
            "configurado en Factus** (no al tenant comprador). Verifique en la cuenta Factus del emisor que el NIT esté "
            "exactamente como en RUT/DIAN, con guion y DV (ej: 902057790-8), y luego reintente."
        )
        if len(detail) + len(hint) <= 5000:
            return detail + hint
    if "dsaj10" in low or "dsaj11" in low:
        hint = (
            " [CDASOFT] La DIAN cruza el nombre con el RUT: use la **razón social o nombre completo** exactamente "
            "como está registrado ante la DIAN (orden de apellidos, tildes, puntos en S.A.S., etc.)."
        )
        if len(detail) + len(hint) <= 5000:
            return detail + hint
    return detail


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


def get_municipalities(
    *,
    base_url: str,
    access_token: str,
    name: Optional[str] = None,
    timeout: float = 60.0,
) -> list[dict[str, Any]]:
    """
    GET /v1/municipalities — catálogo DIAN/Factus (mismo ambiente que el token).

    Documentación: https://developers.factus.com.co/municipios/obtener-municipios/
    Query opcional `name` filtra por nombre. El campo `id` es el municipality_id en facturas;
    `code` es el código DIAN (distinto del id).
    """
    url = f"{base_url.rstrip('/')}/v1/municipalities"
    params: dict[str, str] = {}
    if name and name.strip():
        params["name"] = name.strip()[:200]
    with httpx.Client(timeout=timeout) as client:
        r = client.get(
            url,
            params=params or None,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )
    data = _safe_json(r)
    if r.status_code >= 400:
        raise FactusAPIError(
            "No se pudieron consultar municipios en Factus",
            status_code=r.status_code,
            body=data,
        )
    rows: list[dict[str, Any]] = []
    if isinstance(data, dict):
        inner = data.get("data")
        if isinstance(inner, list):
            rows = [x for x in inner if isinstance(x, dict)]
    return rows


_TRANSIENT_VALIDATE_STATUS = frozenset({502, 503, 504})


def validate_invoice(
    *,
    base_url: str,
    access_token: str,
    body: dict[str, Any],
    timeout: float = 90.0,
    max_attempts: int = 3,
) -> dict[str, Any]:
    """
    POST /v1/bills/validate — reintenta automáticamente fallos temporales (502/503/504 y timeouts de red).
    No reintenta 4xx de negocio (p. ej. 409 cola DIAN): ahí debe actuar Factus/cuenta.
    """
    url = f"{base_url.rstrip('/')}/v1/bills/validate"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    for attempt in range(max(1, max_attempts)):
        try:
            with httpx.Client(timeout=timeout) as client:
                r = client.post(url, json=body, headers=headers)
            data = _safe_json(r)
            if r.status_code < 400:
                return data if isinstance(data, dict) else {"raw": data}
            if r.status_code in _TRANSIENT_VALIDATE_STATUS and attempt < max_attempts - 1:
                time.sleep(min(2.0 * (attempt + 1), 8.0))
                continue
            raise FactusAPIError(
                "Factus rechazó la validación de la factura",
                status_code=r.status_code,
                body=data,
            )
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
            if attempt < max_attempts - 1:
                time.sleep(min(2.0 * (attempt + 1), 8.0))
                continue
            raise FactusAPIError(
                f"Red o tiempo de espera con Factus al validar factura ({exc!s})",
                status_code=504,
                body=None,
            ) from exc

    raise RuntimeError("validate_invoice: no result")  # pragma: no cover


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


def download_bill_pdf(
    *,
    base_url: str,
    access_token: str,
    number: str,
    timeout: float = 120.0,
) -> Union[dict[str, Any], bytes]:
    """
    Descarga PDF de factura. Factus documenta v1/v2; puede responder PDF binario o JSON con base64.
    https://developers.factus.com.co/facturas/descargar-pdf/
    """
    n = quote((number or "").strip(), safe="")
    urls = [
        f"{base_url.rstrip('/')}/v1/bills/download-pdf/{n}",
        f"{base_url.rstrip('/')}/v2/bills/{n}/download-pdf",
    ]
    last_err: Optional[FactusAPIError] = None
    for url in urls:
        try:
            with httpx.Client(timeout=timeout) as client:
                r = client.get(
                    url,
                    headers={
                        "Accept": "application/pdf, application/json, */*",
                        "Authorization": f"Bearer {access_token}",
                    },
                )
            raw = r.content
            if r.status_code >= 400:
                data = _safe_json(r)
                last_err = FactusAPIError(
                    "No se pudo descargar el PDF de la factura en Factus",
                    status_code=r.status_code,
                    body=data,
                )
                continue
            if raw[:4] == b"%PDF":
                return raw
            data = _safe_json(r)
            if isinstance(data, dict):
                return data
        except httpx.HTTPError as exc:
            last_err = FactusAPIError(
                f"Red o error HTTP al descargar PDF de factura ({exc!s})",
                status_code=502,
                body=None,
            )
    if last_err:
        raise last_err
    raise FactusAPIError(
        "No se pudo descargar el PDF de la factura en Factus",
        status_code=502,
        body=None,
    )


def _bill_pdf_bytes_from_json_payload(payload: dict[str, Any]) -> bytes:
    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(inner, dict):
        inner = {}
    b64 = (
        inner.get("pdf_base_64_encoded")
        or inner.get("pdf_base64")
        or inner.get("file")
        or inner.get("base64_document")
    )
    if not b64 and isinstance(payload.get("data"), dict):
        b64 = payload["data"].get("pdf_base_64_encoded") or payload["data"].get("pdf_base64")
    if not b64:
        raise ValueError("La respuesta JSON de Factus no incluye PDF en base64.")
    return base64.b64decode(b64)


def download_bill_pdf_resolved(
    *,
    base_url: str,
    access_token: str,
    numero_documento: Optional[str],
    factus_bill_id: Optional[int],
    timeout: float = 120.0,
) -> bytes:
    """Intenta número de factura y id Factus; opcionalmente consulta show para obtener número canónico."""
    candidates: list[str] = []
    for x in (
        (numero_documento or "").strip() or None,
        str(factus_bill_id) if factus_bill_id is not None else None,
    ):
        if x and x not in candidates:
            candidates.append(x)
    if not candidates:
        raise FactusAPIError(
            "No hay número ni id Factus para descargar el PDF de la factura.",
            status_code=404,
            body=None,
        )
    last_err: Optional[Exception] = None
    for cand in candidates:
        try:
            out = download_bill_pdf(
                base_url=base_url, access_token=access_token, number=cand, timeout=timeout
            )
            if isinstance(out, (bytes, bytearray)):
                return bytes(out)
            if isinstance(out, dict):
                return _bill_pdf_bytes_from_json_payload(out)
        except (FactusAPIError, ValueError) as e:
            last_err = e
    for cand in candidates:
        try:
            show = get_bill_show(base_url=base_url, access_token=access_token, number=cand, timeout=timeout)
            inner = show.get("data") if isinstance(show.get("data"), dict) else show
            block = inner if isinstance(inner, dict) else {}
            num = block.get("number") or block.get("document_number") or block.get("consecutive")
            if num is None:
                continue
            ns = str(num).strip()
            if not ns or ns in candidates:
                continue
            out = download_bill_pdf(
                base_url=base_url, access_token=access_token, number=ns, timeout=timeout
            )
            if isinstance(out, (bytes, bytearray)):
                return bytes(out)
            if isinstance(out, dict):
                return _bill_pdf_bytes_from_json_payload(out)
        except (FactusAPIError, ValueError) as e:
            last_err = e
    raise FactusAPIError(
        "No se pudo obtener el PDF de la factura con los identificadores guardados.",
        status_code=getattr(last_err, "status_code", None) or 502,
        body=getattr(last_err, "body", None) if isinstance(last_err, FactusAPIError) else None,
    ) from last_err


def validate_support_document(
    *,
    base_url: str,
    access_token: str,
    body: dict[str, Any],
    timeout: float = 90.0,
    max_attempts: int = 3,
) -> dict[str, Any]:
    """
    POST /v1/support-documents/validate — documento soporte en adquisiciones (DIAN).
    Documentación: https://developers.factus.com.co/documentos-soporte/crear-validar/
    """
    url = f"{base_url.rstrip('/')}/v1/support-documents/validate"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    for attempt in range(max(1, max_attempts)):
        try:
            with httpx.Client(timeout=timeout) as client:
                r = client.post(url, json=body, headers=headers)
            data = _safe_json(r)
            if r.status_code < 400:
                return data if isinstance(data, dict) else {"raw": data}
            if r.status_code in _TRANSIENT_VALIDATE_STATUS and attempt < max_attempts - 1:
                time.sleep(min(2.0 * (attempt + 1), 8.0))
                continue
            raise FactusAPIError(
                "Factus rechazó la validación del documento soporte",
                status_code=r.status_code,
                body=data,
            )
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
            if attempt < max_attempts - 1:
                time.sleep(min(2.0 * (attempt + 1), 8.0))
                continue
            raise FactusAPIError(
                f"Red o tiempo de espera con Factus al validar documento soporte ({exc!s})",
                status_code=504,
                body=None,
            ) from exc
    raise RuntimeError("validate_support_document: no result")  # pragma: no cover


def get_support_document_show(
    *,
    base_url: str,
    access_token: str,
    number: str,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """GET /v1/support-documents/show/:number"""
    n = quote((number or "").strip(), safe="")
    url = f"{base_url.rstrip('/')}/v1/support-documents/show/{n}"
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
            "No se pudo consultar el documento soporte en Factus",
            status_code=r.status_code,
            body=data,
        )
    return data if isinstance(data, dict) else {"raw": data}


def download_support_document_pdf(
    *,
    base_url: str,
    access_token: str,
    number: str,
    timeout: float = 120.0,
) -> Union[dict[str, Any], bytes]:
    """
    GET /v1/support-documents/download-pdf/:number.
    Factus puede responder JSON con base64 o el PDF binario (application/pdf / cuerpo %PDF).
    """
    n = quote((number or "").strip(), safe="")
    url = f"{base_url.rstrip('/')}/v1/support-documents/download-pdf/{n}"
    with httpx.Client(timeout=timeout) as client:
        r = client.get(
            url,
            headers={
                "Accept": "application/pdf, application/json, */*",
                "Authorization": f"Bearer {access_token}",
            },
        )
    if r.status_code >= 400:
        data = _safe_json(r)
        raise FactusAPIError(
            "No se pudo descargar el PDF del documento soporte en Factus",
            status_code=r.status_code,
            body=data,
        )
    raw = r.content
    ct = (r.headers.get("content-type") or "").lower()
    if raw[:4] == b"%PDF" or "application/pdf" in ct:
        return raw
    if "octet-stream" in ct and raw[:4] == b"%PDF":
        return raw
    data = _safe_json(r)
    return data if isinstance(data, dict) else {"raw": data}


def download_support_document_pdf_resolved(
    *,
    base_url: str,
    access_token: str,
    numero_documento: Optional[str],
    factus_document_id: Optional[int],
    cuds: Optional[str],
    timeout: float = 120.0,
) -> Union[dict[str, Any], bytes]:
    """
    Intenta GET download-pdf con varios identificadores (número DIAN/prefijo, id Factus, CUDS).
    Si falla, consulta show con cada candidato y reintenta con el número devuelto.
    """
    candidates: list[str] = []
    for x in (
        (numero_documento or "").strip() or None,
        str(factus_document_id) if factus_document_id is not None else None,
        (cuds or "").strip() or None,
    ):
        if x and x not in candidates:
            candidates.append(x)
    if not candidates:
        raise FactusAPIError(
            "No hay número ni id Factus guardados para descargar el PDF del documento soporte.",
            status_code=404,
            body=None,
        )
    last_err: Optional[FactusAPIError] = None
    for cand in candidates:
        try:
            out = download_support_document_pdf(
                base_url=base_url, access_token=access_token, number=cand, timeout=timeout
            )
            return out
        except FactusAPIError as e:
            last_err = e
    # Fallback: show → número canónico
    for cand in candidates:
        try:
            show = get_support_document_show(
                base_url=base_url, access_token=access_token, number=cand, timeout=timeout
            )
            inner = show.get("data") if isinstance(show.get("data"), dict) else show
            if not isinstance(inner, dict):
                continue
            doc = inner.get("support_document") or inner.get("supportDocument") or inner.get("document")
            block = doc if isinstance(doc, dict) else inner
            if not isinstance(block, dict):
                continue
            num = (
                block.get("number")
                or block.get("document_number")
                or block.get("consecutive")
                or inner.get("number")
            )
            if num is None:
                continue
            ns = str(num).strip()
            if not ns or ns in candidates:
                continue
            try:
                out = download_support_document_pdf(
                    base_url=base_url, access_token=access_token, number=ns, timeout=timeout
                )
                return out
            except FactusAPIError as e:
                last_err = e
        except FactusAPIError as e:
            last_err = e
    if last_err:
        raise last_err
    raise FactusAPIError(
        "No se pudo descargar el PDF del documento soporte con los identificadores guardados.",
        status_code=502,
        body=None,
    )


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
