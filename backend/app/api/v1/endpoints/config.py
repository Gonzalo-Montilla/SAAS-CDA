"""
Endpoints de Configuración
"""
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_admin, get_db
from app.core.config import settings
from app.models.usuario import Usuario
from app.models.tenant import Tenant

router = APIRouter()


def _resolve_tenant_logo_bytes(logo_url: str | None) -> tuple[bytes, str] | None:
    if not logo_url:
        return None

    raw = str(logo_url).strip()
    if not raw:
        return None

    uploads_root = Path(settings.TENANT_LOGO_UPLOAD_DIR).resolve().parent
    normalized = raw.replace("\\", "/")
    local_candidates: list[Path] = []

    # Ruta absoluta local.
    direct_path = Path(raw)
    if direct_path.is_file():
        local_candidates.append(direct_path)

    # URL/ruta pública de uploads.
    if normalized.startswith("/uploads/"):
        rel = normalized[len("/uploads/"):]
        local_candidates.append(uploads_root / rel)
    elif normalized.startswith("uploads/"):
        rel = normalized[len("uploads/"):]
        local_candidates.append(uploads_root / rel)

    # URL absoluta hacia /uploads.
    if normalized.startswith("http://") or normalized.startswith("https://"):
        parsed = urlparse(normalized)
        parsed_path = (parsed.path or "").replace("\\", "/")
        if parsed_path.startswith("/uploads/"):
            rel = parsed_path[len("/uploads/"):]
            local_candidates.append(uploads_root / rel)

    # Fragmento tenant-logos en rutas locales heredadas.
    idx = normalized.lower().find("tenant-logos/")
    if idx >= 0:
        rel = normalized[idx + len("tenant-logos/") :]
        local_candidates.append(uploads_root / "tenant-logos" / rel)

    seen: set[str] = set()
    for candidate in local_candidates:
        candidate_key = str(candidate.resolve()) if candidate.exists() else str(candidate)
        if candidate_key in seen:
            continue
        seen.add(candidate_key)
        if candidate.is_file():
            content = candidate.read_bytes()
            if content:
                ext = candidate.suffix.lower()
                media_type = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                }.get(ext, "application/octet-stream")
                return content, media_type

    # Último intento: descargar URL remota.
    if normalized.startswith("http://") or normalized.startswith("https://"):
        try:
            with urlopen(normalized, timeout=4) as remote:
                content = remote.read()
                if not content:
                    return None
                content_type = remote.headers.get("Content-Type", "application/octet-stream")
                return content, content_type
        except Exception:
            return None

    return None


@router.get("/urls-externas")
def obtener_urls_externas(
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener URLs de sistemas externos (RUNT, SICOV, INDRA)
    """
    return {
        "runt_url": settings.RUNT_URL,
        "sicov_url": settings.SICOV_URL,
        "indra_url": settings.INDRA_URL
    }


@router.get("/tenant-logo")
def obtener_logo_tenant(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado",
        )

    resolved = _resolve_tenant_logo_bytes(tenant.logo_url)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logo del tenant no disponible",
        )

    content, media_type = resolved
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


class TenantBrandingUpdate(BaseModel):
    nombre_comercial: str = Field(min_length=3, max_length=200)
    logo_url: str | None = Field(default=None, max_length=500)
    color_primario: str = Field(default="#2563eb", max_length=20)
    color_secundario: str = Field(default="#0f172a", max_length=20)


@router.get("/tenant-branding")
def obtener_tenant_branding(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado"
        )

    return {
        "nombre_comercial": tenant.nombre_comercial,
        "logo_url": tenant.logo_url,
        "color_primario": tenant.color_primario,
        "color_secundario": tenant.color_secundario,
    }


@router.get("/public-tenant-branding/{tenant_slug}")
def obtener_tenant_branding_publico(
    tenant_slug: str,
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug, Tenant.activo == True).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado o inactivo",
        )

    login_url = f"{settings.FRONTEND_URL.rstrip('/')}/{tenant.slug}"
    return {
        "tenant_slug": tenant.slug,
        "nombre_comercial": tenant.nombre_comercial,
        "logo_url": tenant.logo_url,
        "color_primario": tenant.color_primario,
        "color_secundario": tenant.color_secundario,
        "login_url": login_url,
    }


@router.put("/tenant-branding")
def actualizar_tenant_branding(
    payload: TenantBrandingUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado"
        )

    tenant.nombre_comercial = payload.nombre_comercial
    tenant.logo_url = payload.logo_url
    tenant.color_primario = payload.color_primario
    tenant.color_secundario = payload.color_secundario
    db.commit()

    return {
        "message": "Branding del tenant actualizado exitosamente"
    }
