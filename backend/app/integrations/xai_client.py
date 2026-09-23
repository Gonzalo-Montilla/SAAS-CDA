"""Cliente xAI: Grok redacta. No decide tarifas, sedes ni enlaces."""
from __future__ import annotations

import re

import httpx

from app.core.config import settings

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


def grok_disponible() -> bool:
    return bool((getattr(settings, "XAI_API_KEY", None) or "").strip())


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
