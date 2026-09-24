"""Cliente xAI: Grok redacta WhatsApp y lee licencias de tránsito.

El redactor de WhatsApp y la lectura de tarjeta son funciones distintas: no se mezclan prompts.
"""
from __future__ import annotations

import base64
import re

import httpx

from app.core.config import settings
from app.services.tarjeta_propiedad import extraer_json, normalizar_lectura

XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"

_SYSTEM = (
    "Eres una persona de recepción de un CDA en Colombia, por WhatsApp. "
    "Cálida, cercana y clara. De usted (usted, su, le), nunca tú/te/necesitas. "
    "Solo reescribes los HECHOS. No inventes precios, horarios, documentos, sedes ni enlaces. "
    "Si un dato no está en los hechos, no lo agregues. "
    "Máximo 4 frases. Sin menús numerados. Sin decir que eres IA, bot o Grok. "
    "Si hay un enlace en los hechos, déjalo tal cual. "
    "Si los hechos ya tienen la respuesta (documentos, precio, sede), dila; "
    "no pases a un asesor ni digas que no tienes el dato."
)


_SYSTEM_TARJETA = (
    "Eres un lector de documentos de un CDA en Colombia. "
    "Solo extraes datos visibles de una licencia de tránsito (tarjeta de propiedad) colombiana. "
    "Respondes UN JSON, sin markdown y sin prosa. "
    "Si la imagen no es esa licencia, encontrado=false y es_licencia_transito=false, campos vacíos. "
    "Nunca inventes placa, cédula, VIN ni motor. Si un campo no se lee, null. "
    "No escribas preventiva ni mezcles RTM con preventiva. "
    "No eres un bot de WhatsApp."
)

_USER_TARJETA = (
    "Lee la imagen. Devuelve JSON con estas claves: "
    "encontrado (bool), es_licencia_transito (bool), placa, marca, linea, modelo, ano_modelo, "
    "color, clase_vehiculo, tipo_servicio, tipo_combustible, cilindraje, capacidad_pasajeros, "
    "numero_motor, vin, numero_chasis, titular_nombre, document_type (CC/CE/PA/NIT), "
    "document_number, confidence (high/medium/low)."
)


def grok_disponible() -> bool:
    return bool((getattr(settings, "XAI_API_KEY", None) or "").strip())


def leer_licencia_transito(image_bytes: bytes, mime: str = "image/jpeg") -> dict | None:
    """Llama a Grok con la imagen. No guarda el archivo. None si no hay key o falla la API."""
    api_key = (getattr(settings, "XAI_API_KEY", None) or "").strip()
    if not api_key or not image_bytes:
        return None
    modelo = (getattr(settings, "XAI_VISION_MODEL", None) or getattr(settings, "XAI_MODEL", None) or "grok-4.3")
    modelo = str(modelo).strip() or "grok-4.3"
    timeout = float(getattr(settings, "XAI_TIMEOUT_SECONDS", 20.0) or 20.0)
    timeout = max(timeout, 40.0)
    mime_ok = mime if mime in {"image/jpeg", "image/png", "image/webp"} else "image/jpeg"
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": modelo,
        "temperature": 0,
        "max_tokens": 700,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_TARJETA},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_ok};base64,{b64}"}},
                    {"type": "text", "text": _USER_TARJETA},
                ],
            },
        ],
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                XAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except Exception as exc:
        print(f"[WARN] Grok tarjeta: {exc}")
        return None
    if resp.status_code >= 400:
        print(f"[WARN] Grok tarjeta HTTP {resp.status_code}: {(resp.text or '')[:400]}")
        return None
    try:
        data = resp.json()
        content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
        if isinstance(content, list):
            content = "".join(
                str(part.get("text") or "") if isinstance(part, dict) else str(part) for part in content
            )
        parsed = extraer_json(str(content))
    except Exception:
        return None
    return normalizar_lectura(parsed)


def redactar_whatsapp(
    *,
    nombre_cda: str,
    mensaje_cliente: str,
    hechos: str,
    texto_base: str,
) -> str | None:
    """Devuelve la frase de Grok o None si no hay key / falla / se sale de los hechos."""
    api_key = (getattr(settings, "XAI_API_KEY", None) or "").strip()
    if not api_key:
        return None
    modelo = (getattr(settings, "XAI_MODEL", None) or "grok-4.3").strip() or "grok-4.3"
    timeout = float(getattr(settings, "XAI_TIMEOUT_SECONDS", 20.0) or 20.0)
    user = (
        f"CDA: {nombre_cda}\n"
        f"El cliente escribió: {mensaje_cliente.strip()[:500]}\n\n"
        f"HECHOS (obligatorios, no cambies cifras ni URLs):\n{hechos.strip()}\n\n"
        f"Texto de respaldo si no puedes mejorar:\n{texto_base.strip()}\n\n"
        "Escribe solo el mensaje para WhatsApp."
    )
    payload = {
        "model": modelo,
        "temperature": 0.3,
        "max_tokens": 280,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ],
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                XAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except Exception:
        return None
    if resp.status_code >= 400:
        print(f"[WARN] Grok HTTP {resp.status_code}: {(resp.text or '')[:300]}")
        return None
    try:
        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            return None
        content = ((choices[0].get("message") or {}).get("content") or "").strip()
    except Exception:
        return None
    if not content:
        return None
    if not _respeta_hechos(content, texto_base):
        return None
    return content[:4096]


def _respeta_hechos(texto_grok: str, texto_base: str) -> bool:
    grok = (texto_grok or "").strip()
    base = (texto_base or "").strip()
    if len(grok) < 12:
        return False
    grok_l = grok.lower()
    base_l = base.lower()
    if "asesor" not in base_l:
        if any(
            p in grok_l
            for p in ("asesor", "escalar", "dato seguro", "contactará", "le contactar", "no cuento con")
        ):
            return False
    if "propiedad" in base_l or "tarjeta" in base_l:
        if "propiedad" not in grok_l and "tarjeta" not in grok_l:
            return False
        if "limpio" in base_l and "limpio" not in grok_l:
            return False
    for url in _urls(base):
        if url not in grok:
            return False
    montos_base = _montos(base)
    if montos_base:
        grok_norm = grok.replace(" ", "")
        if not any(m.replace(" ", "") in grok_norm or m in grok for m in montos_base):
            return False
    else:
        if _montos(grok):
            return False
    return True


def _urls(texto: str) -> list[str]:
    return re.findall(r"https?://[^\s]+", texto or "")


def _montos(texto: str) -> list[str]:
    return re.findall(r"\$\s*[\d.]+", texto or "")
