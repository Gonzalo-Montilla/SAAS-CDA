"""Almacenamiento de factura/soporte de compra ligado a un egreso (caja o tesorería)."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
_ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}


def storage_root() -> Path:
    raw = Path(settings.EGRESOS_FACTURA_SOPORTE_STORAGE_DIR)
    if raw.is_absolute():
        return raw
    cwd = (Path.cwd() / raw).resolve()
    if cwd.exists() or cwd.parent.exists():
        return cwd
    return (_BACKEND_ROOT.parent / raw).resolve()


def max_bytes() -> int:
    return int(settings.EGRESOS_FACTURA_SOPORTE_MAX_MB) * 1024 * 1024


def _safe_filename(name: str) -> str:
    base = Path(name or "soporte").name
    base = re.sub(r"[^\w.\-]+", "_", base).strip("._") or "soporte"
    return base[:180]


def abs_path(relpath: str | None) -> Path | None:
    if not relpath or not str(relpath).strip():
        return None
    root = storage_root().resolve()
    candidate = (root / str(relpath).replace("\\", "/").lstrip("/")).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def eliminar_si_existe(relpath: str | None) -> None:
    path = abs_path(relpath)
    if path and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


async def guardar_upload(
    *,
    tenant_id: uuid.UUID,
    origen: str,
    movimiento_id: uuid.UUID,
    upload: UploadFile,
) -> tuple[str, str, str]:
    """
    Guarda el archivo y retorna (relpath, nombre_original, mime).
    """
    original = _safe_filename(upload.filename or "factura.pdf")
    ext = Path(original).suffix.lower()
    mime = (upload.content_type or "").split(";")[0].strip().lower()
    if ext not in _ALLOWED_EXT and mime not in _ALLOWED_MIME:
        raise ValueError("Formato no permitido. Use PDF o imagen (JPG/PNG/WEBP).")
    if ext not in _ALLOWED_EXT:
        # Inferir extensión desde mime
        ext = {
            "application/pdf": ".pdf",
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(mime, ".pdf")
        original = f"{Path(original).stem}{ext}"

    origen_safe = "tesoreria" if origen == "tesoreria" else "caja"
    rel_dir = f"{tenant_id}/{origen_safe}"
    dest_dir = storage_root() / rel_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{movimiento_id}_{uuid.uuid4().hex[:10]}{ext}"
    dest = dest_dir / stored_name

    limit = max_bytes()
    written = 0
    with dest.open("wb") as out:
        while True:
            chunk = await upload.read(1024 * 64)
            if not chunk:
                break
            written += len(chunk)
            if written > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise ValueError(
                    f"El archivo supera el máximo de {settings.EGRESOS_FACTURA_SOPORTE_MAX_MB} MB."
                )
            out.write(chunk)

    if written <= 0:
        dest.unlink(missing_ok=True)
        raise ValueError("El archivo llegó vacío.")

    relpath = f"{rel_dir}/{stored_name}".replace("\\", "/")
    mime_out = mime if mime in _ALLOWED_MIME else (
        "application/pdf" if ext == ".pdf" else f"image/{ext.lstrip('.')}"
    )
    return relpath, original, mime_out
