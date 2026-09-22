"""Normalización de celular Colombia para WhatsApp Cloud API (E.164 sin +)."""
from __future__ import annotations


def normalizar_celular_co(phone_raw: str | None) -> str | None:
    digits = "".join(ch for ch in (phone_raw or "") if ch.isdigit())
    if not digits:
        return None
    if digits.startswith("57") and len(digits) >= 12:
        return digits
    if len(digits) == 10 and digits.startswith("3"):
        return f"57{digits}"
    return None


def hint_secret(value: str | None) -> str | None:
    if not value or len(value) < 4:
        return None
    return f"…{value[-4:]}"
