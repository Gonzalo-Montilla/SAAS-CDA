"""
Cifrado de credenciales Factus en reposo (Fernet con clave derivada).
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings


def _fernet_key() -> bytes:
    raw = (settings.FACTUS_ENCRYPTION_KEY or settings.SECRET_KEY).encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plain: str | None) -> str | None:
    if plain is None or plain == "":
        return None
    f = Fernet(_fernet_key())
    return f.encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str | None) -> str | None:
    if token is None or token == "":
        return None
    f = Fernet(_fernet_key())
    return f.decrypt(token.encode("ascii")).decode("utf-8")
