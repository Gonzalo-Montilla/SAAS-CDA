"""
Utilidades para validación de captcha (Cloudflare Turnstile).
"""
import json
import urllib.parse
import urllib.request

from app.core.config import settings


def verify_turnstile_token(token: str, remote_ip: str | None = None) -> tuple[bool, str]:
    """
    Verifica token de Turnstile contra Cloudflare.
    """
    if not settings.TURNSTILE_SECRET_KEY:
        return False, "TURNSTILE_SECRET_KEY no configurado"

    payload = {
        "secret": settings.TURNSTILE_SECRET_KEY,
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    encoded = urllib.parse.urlencode(payload).encode("utf-8")
    request = urllib.request.Request(
        settings.TURNSTILE_VERIFY_URL,
        data=encoded,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8")
    except Exception:
        return False, "No se pudo validar captcha en este momento"

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return False, "Respuesta inválida del servicio captcha"

    if data.get("success") is True:
        return True, ""

    error_codes = data.get("error-codes") or []
    if isinstance(error_codes, list) and error_codes:
        return False, f"Captcha inválido ({','.join(error_codes)})"

    return False, "Captcha inválido"
