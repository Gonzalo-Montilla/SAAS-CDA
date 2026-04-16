"""
Subida de logo de tenant (registro público y backoffice SaaS).
"""
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

ALLOWED_LOGO_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})


def save_tenant_logo_upload(logo_file: UploadFile) -> str:
    """Guarda archivo en TENANT_LOGO_UPLOAD_DIR y devuelve URL absoluta pública."""
    extension = Path(logo_file.filename or "").suffix.lower()
    if extension not in ALLOWED_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de logo no permitido. Usa PNG, JPG, JPEG o WEBP",
        )

    upload_dir = Path(settings.TENANT_LOGO_UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_name = f"{uuid.uuid4().hex}{extension}"
    destination = upload_dir / file_name
    content = logo_file.file.read()
    max_bytes = settings.TENANT_LOGO_MAX_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El logo supera el límite de {settings.TENANT_LOGO_MAX_SIZE_MB}MB",
        )
    with open(destination, "wb") as f:
        f.write(content)

    relative_url = f"/uploads/tenant-logos/{file_name}"
    return f"{settings.BACKEND_PUBLIC_BASE_URL.rstrip('/')}{relative_url}"


def normalize_external_logo_url(raw: str | None) -> str:
    """Acepta URL absoluta o ruta /uploads/... y devuelve URL lista para guardar en Tenant.logo_url."""
    s = (raw or "").strip()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL de logo vacía",
        )
    if len(s) > 2000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL de logo demasiado larga",
        )
    if s.startswith(("http://", "https://")):
        return s
    if s.startswith("/uploads/"):
        return f"{settings.BACKEND_PUBLIC_BASE_URL.rstrip('/')}{s}"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="La URL del logo debe ser http(s) o una ruta que comience por /uploads/",
    )
