"""
Zonas horarias para lógica de negocio.

En Windows, ``ZoneInfo("America/Bogota")`` falla si no está instalado el paquete ``tzdata``
(PEP 615). Usamos ``tzdata`` en requirements y, por si acaso, offset fijo UTC-5 para Bogotá.
"""
from __future__ import annotations

from datetime import timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from app.core.config import settings


def zoneinfo_from_name(tz_name: str | None):
    """
    Resuelve una zona IANA. Si no hay datos tzdata y el nombre es America/Bogota,
    devuelve timezone fijo UTC-5 (Colombia no usa DST desde 1993).
    """
    name = (tz_name or "UTC").strip()
    try:
        return ZoneInfo(name)
    except Exception:
        if name == "America/Bogota":
            return dt_timezone(timedelta(hours=-5))
        raise


def get_app_timezone():
    """Zona configurada en ``settings.TIMEZONE`` (p. ej. America/Bogota)."""
    return zoneinfo_from_name(settings.TIMEZONE)
