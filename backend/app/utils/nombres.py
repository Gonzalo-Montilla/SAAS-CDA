"""Nombres para mensajes al cliente: sin gritar en MAYÚSCULAS, sin tocar placas."""
from __future__ import annotations

_PARTICULAS = {"de", "del", "la", "las", "los", "y", "e", "da", "das", "dos", "di"}
_ACRONIMOS = {
    "CDA": "CDA",
    "CDASOFT": "CDASOFT",
    "RTM": "RTM",
    "SOAT": "SOAT",
    "DIAN": "DIAN",
    "NIT": "NIT",
}


def _letras(texto: str) -> list[str]:
    return [c for c in texto if c.isalpha()]


def _es_uniforme(texto: str) -> bool:
    letras = _letras(texto)
    if not letras:
        return False
    return all(c.isupper() for c in letras) or all(c.islower() for c in letras)


def _title_token(token: str) -> str:
    return "-".join(p.capitalize() if p else p for p in token.split("-"))


def _formatear_palabras(texto: str) -> str:
    out: list[str] = []
    for i, raw in enumerate(texto.split()):
        key = raw.upper()
        if key in _ACRONIMOS:
            out.append(_ACRONIMOS[key])
            continue
        low = raw.lower()
        if i > 0 and low in _PARTICULAS:
            out.append(low)
            continue
        out.append(_title_token(low))
    return " ".join(out)


def formatear_nombre_persona(valor: str | None, fallback: str = "Cliente") -> str:
    raw = (valor or "").strip()
    if not raw:
        return fallback
    if not _es_uniforme(raw):
        return raw
    return _formatear_palabras(raw) or fallback


def formatear_nombre_comercial(valor: str | None, fallback: str = "CDA") -> str:
    raw = (valor or "").strip()
    if not raw:
        return fallback
    if not _es_uniforme(raw):
        return raw
    return _formatear_palabras(raw) or fallback


def etiqueta_cda_con_sede(
    nombre_cda: str | None,
    nombre_sede: str | None,
    *,
    sedes_activas: int,
    fallback: str = "CDA",
) -> str:
    """Citas: marca + sede solo si el CDA tiene más de una sede activa."""
    cda = formatear_nombre_comercial(nombre_cda, fallback)
    sede = (nombre_sede or "").strip()
    if sedes_activas <= 1 or not sede:
        return cda
    sede_fmt = formatear_nombre_comercial(sede, sede)
    if sede_fmt.casefold() == cda.casefold() or sede_fmt.casefold() in cda.casefold():
        return cda
    return f"{cda} · {sede_fmt}"
