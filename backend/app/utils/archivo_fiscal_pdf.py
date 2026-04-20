"""
Almacenamiento local de PDF de documentos fiscales (Factus) con hash SHA-256.
Ruta relativa guardada en BD respecto a ARCHIVOS_FISCALES_DIR.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import UUID

from app.core.config import settings


def archivo_fiscal_root() -> Path:
    return Path(settings.ARCHIVOS_FISCALES_DIR).resolve()


def guardar_pdf_archivo_fiscal(
    *,
    tenant_id: UUID,
    prefijo: str,
    entity_id: UUID,
    pdf_bytes: bytes,
) -> tuple[str, str]:
    """
    Escribe PDF en disco. Devuelve (ruta relativa al directorio de archivos fiscales, sha256 hex).
    """
    root = archivo_fiscal_root()
    sub = root / str(tenant_id)
    sub.mkdir(parents=True, exist_ok=True)
    safe_pref = "".join(c for c in prefijo if c.isalnum() or c == "_")[:16] or "doc"
    name = f"{safe_pref}_{entity_id.hex}.pdf"
    full = sub / name
    full.write_bytes(pdf_bytes)
    rel = f"{tenant_id}/{name}"
    digest = hashlib.sha256(pdf_bytes).hexdigest()
    return rel, digest


def leer_pdf_archivo_fiscal(relpath: str) -> bytes | None:
    """Lee PDF si existe. None si la ruta es inválida o el archivo no está."""
    raw = (relpath or "").strip().replace("\\", "/")
    if not raw or ".." in raw:
        return None
    full = archivo_fiscal_root() / raw
    try:
        full = full.resolve()
    except OSError:
        return None
    root = archivo_fiscal_root().resolve()
    if not str(full).startswith(str(root)) or not full.is_file():
        return None
    return full.read_bytes()
