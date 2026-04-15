"""
Genera PDF de vista previa para documentos Office usando LibreOffice (headless).

Requiere el ejecutable `soffice` en PATH o la ruta en DOCUMENTOS_LIBREOFFICE_PATH.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

PREVIEW_OFFICE_EXTENSIONS = frozenset({".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"})


def _is_under_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _normalize_windows_env_path(raw: str) -> str:
    """Quita comillas y normaliza barras; en .env las rutas con espacios suelen ir entre comillas."""
    s = raw.strip().strip('"').strip("'")
    return str(Path(s))


def resolver_libreoffice_executable() -> str | None:
    """Ruta al binario soffice, o None si no hay conversor disponible."""
    explicit = (settings.DOCUMENTOS_LIBREOFFICE_PATH or "").strip()
    if explicit:
        candidate = _normalize_windows_env_path(explicit)
        return candidate if os.path.isfile(candidate) else None
    found = shutil.which("soffice")
    if found:
        return found
    if os.name == "nt":
        win_paths = [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ]
        for p in win_paths:
            if os.path.isfile(p):
                return p
    return None


def try_generate_preview_pdf(upload_root: Path, storage_relpath: str) -> str | None:
    """
    Convierte el archivo en storage_relpath a PDF en el mismo directorio (mismo nombre base).
    Devuelve la ruta relativa al almacén (p. ej. tenant_id/uuid.pdf) o None.
    """
    upload_root = upload_root.resolve()
    rel = storage_relpath.replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        logger.warning("Ruta de almacenamiento inválida para preview: %s", storage_relpath)
        return None

    src = (upload_root / rel).resolve()
    if not _is_under_root(src, upload_root) or not src.is_file():
        return None

    ext = src.suffix.lower()
    if ext not in PREVIEW_OFFICE_EXTENSIONS:
        return None

    soffice = resolver_libreoffice_executable()
    if not soffice:
        logger.info("LibreOffice no encontrado; omitiendo vista previa PDF para %s", rel)
        return None

    out_dir = src.parent
    expected_pdf = out_dir / f"{src.stem}.pdf"
    if expected_pdf.is_file():
        try:
            expected_pdf.unlink()
        except OSError:
            pass

    run_kw: dict = {}
    if sys.platform == "win32":
        # Evita ventanas de consola/GUI que a veces bloquean o fallan al convertir
        run_kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        subprocess.run(
            [
                soffice,
                "--headless",
                "--invisible",
                "--nologo",
                "--nofirststartwizard",
                "--convert-to",
                "pdf",
                "--outdir",
                str(out_dir),
                str(src),
            ],
            check=True,
            timeout=180,
            capture_output=True,
            **run_kw,
        )
    except subprocess.TimeoutExpired:
        logger.warning("Timeout convirtiendo a PDF: %s", rel)
        return None
    except subprocess.CalledProcessError as e:
        logger.warning(
            "LibreOffice falló al convertir %s: %s",
            rel,
            (e.stderr or e.stdout or b"")[:500],
        )
        return None
    except FileNotFoundError:
        logger.warning("Ejecutable LibreOffice no ejecutable: %s", soffice)
        return None

    if not expected_pdf.is_file():
        logger.warning("No se generó PDF esperado para %s", rel)
        return None

    logger.info("Vista previa PDF lista: %s", expected_pdf.name)

    try:
        rel_pdf = str(expected_pdf.resolve().relative_to(upload_root))
    except ValueError:
        return None
    return rel_pdf.replace("\\", "/")


def schedule_preview_build(documento_id) -> None:
    """Ejecutado en BackgroundTasks: abre sesión DB y guarda preview_pdf_relpath."""
    from uuid import UUID

    from app.db.database import SessionLocal
    from app.models.documento_tenant import TenantDocumento

    did = documento_id if isinstance(documento_id, UUID) else UUID(str(documento_id))
    db = SessionLocal()
    try:
        doc = db.query(TenantDocumento).filter(TenantDocumento.id == did).first()
        if not doc or doc.preview_pdf_relpath:
            return
        upload_root = Path(settings.DOCUMENTOS_STORAGE_DIR)
        relpath = try_generate_preview_pdf(upload_root, doc.storage_relpath)
        if relpath:
            doc.preview_pdf_relpath = relpath[:800]
            db.commit()
    except Exception:
        logger.exception("Error generando vista previa PDF para documento %s", documento_id)
        db.rollback()
    finally:
        db.close()
