"""
Cliente HTTP WhatsApp Cloud API / 360dialog.

No envía si el CDA no conectó. Cada llamada es de un tenant; el token no se reutiliza
entre NIT.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

GRAPH_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
DIALOG360_BASE = "https://waba-v2.360dialog.io"


@dataclass
class WhatsAppApiResult:
    ok: bool
    status_code: int
    message_id: str | None = None
    error: str | None = None
    display_phone: str | None = None
    verified_name: str | None = None
    quality_rating: str | None = None


def _truncate_error(text: str, limit: int = 500) -> str:
    raw = (text or "").strip()
    return raw[:limit] if raw else "Error WhatsApp"


def build_template_payload(
    to_e164: str,
    template_name: str,
    lang: str,
    body_params: list[str],
) -> dict:
    components = []
    if body_params:
        components.append(
            {
                "type": "body",
                "parameters": [{"type": "text", "text": str(p)[:1024]} for p in body_params],
            }
        )
    return {
        "messaging_product": "whatsapp",
        "to": to_e164,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": lang or "es"},
            "components": components,
        },
    }


def build_text_payload(to_e164: str, cuerpo: str) -> dict:
    texto = (cuerpo or "").strip()[:4096]
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_e164,
        "type": "text",
        "text": {"body": texto or "Gracias por escribirnos."},
    }


def enviar_plantilla_cloud_api(
    *,
    phone_number_id: str,
    access_token: str,
    payload: dict,
    timeout: float = 20.0,
) -> WhatsAppApiResult:
    url = f"{GRAPH_BASE}/{phone_number_id.strip()}/messages"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except Exception as exc:
        return WhatsAppApiResult(ok=False, status_code=0, error=str(exc)[:500])
    return _parse_send_response(resp)


def enviar_plantilla_dialog360(
    *,
    api_key: str,
    payload: dict,
    timeout: float = 20.0,
) -> WhatsAppApiResult:
    url = f"{DIALOG360_BASE}/messages"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                url,
                headers={
                    "D360-API-KEY": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except Exception as exc:
        return WhatsAppApiResult(ok=False, status_code=0, error=str(exc)[:500])
    return _parse_send_response(resp)


def probar_cloud_api(*, phone_number_id: str, access_token: str, timeout: float = 20.0) -> WhatsAppApiResult:
    url = (
        f"{GRAPH_BASE}/{phone_number_id.strip()}"
        "?fields=display_phone_number,verified_name,quality_rating"
    )
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers={"Authorization": f"Bearer {access_token}"})
    except Exception as exc:
        return WhatsAppApiResult(ok=False, status_code=0, error=str(exc)[:500])
    if resp.status_code >= 400:
        return WhatsAppApiResult(ok=False, status_code=resp.status_code, error=_truncate_error(resp.text))
    data = {}
    try:
        data = resp.json()
    except Exception:
        pass
    if not isinstance(data, dict):
        data = {}
    return WhatsAppApiResult(
        ok=True,
        status_code=resp.status_code,
        display_phone=str(data.get("display_phone_number") or "") or None,
        verified_name=str(data.get("verified_name") or "") or None,
        quality_rating=str(data.get("quality_rating") or "") or None,
    )


def probar_dialog360(*, api_key: str, timeout: float = 20.0) -> WhatsAppApiResult:
    """Cloud API (waba-v2) no usa /v1/configs/phone_number del hosting on-premise."""
    headers = {"D360-API-KEY": api_key}
    urls = (
        f"{DIALOG360_BASE}/configs/phone_number",
        f"{DIALOG360_BASE}/whatsapp_business_profile",
        f"{DIALOG360_BASE}/v1/configs/webhook",
    )
    last_error = "No se pudo contactar 360dialog"
    last_status = 0
    try:
        with httpx.Client(timeout=timeout) as client:
            for url in urls:
                resp = client.get(url, headers=headers)
                if resp.status_code < 400:
                    display = None
                    try:
                        data = resp.json()
                    except Exception:
                        data = None
                    if isinstance(data, dict):
                        display = (
                            str(
                                data.get("display_phone_number")
                                or data.get("phone_number")
                                or ""
                            )
                            or None
                        )
                    return WhatsAppApiResult(
                        ok=True,
                        status_code=resp.status_code,
                        display_phone=display,
                    )
                last_status = resp.status_code
                last_error = _truncate_error(resp.text)
            # Auth probe: cuerpo vacío no envía a nadie; 400 = key válida, 401 = key mala.
            probe = client.post(
                f"{DIALOG360_BASE}/messages",
                headers={**headers, "Content-Type": "application/json"},
                json={"messaging_product": "whatsapp"},
            )
            if probe.status_code in (400, 422) or (
                probe.status_code < 400
            ):
                return WhatsAppApiResult(ok=True, status_code=probe.status_code)
            if probe.status_code != 404:
                last_status = probe.status_code
                last_error = _truncate_error(probe.text)
    except Exception as exc:
        return WhatsAppApiResult(ok=False, status_code=0, error=str(exc)[:500])
    return WhatsAppApiResult(ok=False, status_code=last_status, error=last_error)


def _parse_send_response(resp: httpx.Response) -> WhatsAppApiResult:
    if resp.status_code >= 400:
        return WhatsAppApiResult(ok=False, status_code=resp.status_code, error=_truncate_error(resp.text))
    message_id = None
    try:
        data = resp.json()
        if isinstance(data, dict):
            messages = data.get("messages")
            if isinstance(messages, list) and messages:
                message_id = str(messages[0].get("id") or "") or None
    except Exception:
        pass
    return WhatsAppApiResult(ok=True, status_code=resp.status_code, message_id=message_id)
