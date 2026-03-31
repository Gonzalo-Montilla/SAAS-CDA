"""
Endpoints de Configuración
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_admin, get_db
from app.core.config import settings
from app.models.usuario import Usuario
from app.models.tenant import Tenant

router = APIRouter()


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
