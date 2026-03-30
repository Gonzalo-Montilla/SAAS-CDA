"""
Onboarding público para registro de nuevos CDA (tenant).
"""
import re
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import get_password_hash
from app.models.tenant import Tenant
from app.models.usuario import Usuario, RolEnum
from app.schemas.onboarding import TenantSelfRegisterRequest, TenantSelfRegisterResponse

router = APIRouter()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    lowered = normalized.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug


def resolve_available_slug(db: Session, requested_name: str) -> str:
    base_slug = slugify(requested_name)
    if not base_slug:
        base_slug = "cda"

    slug = base_slug
    suffix = 2
    while db.query(Tenant).filter(Tenant.slug == slug).first():
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    return slug


@router.post("/register-tenant", response_model=TenantSelfRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_tenant_self_service(
    payload: TenantSelfRegisterRequest,
    db: Session = Depends(get_db),
):
    email_exists = db.query(Usuario).filter(Usuario.email == payload.admin_email).first()
    if email_exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email del administrador ya está registrado",
        )

    tenant_slug = resolve_available_slug(db, payload.nombre_cda)
    tenant = Tenant(
        nombre=payload.nombre_cda,
        nombre_comercial=payload.nombre_cda,
        slug=tenant_slug,
        activo=True,
        logo_url=payload.logo_url,
    )
    db.add(tenant)
    db.flush()

    admin = Usuario(
        tenant_id=tenant.id,
        email=payload.admin_email,
        hashed_password=get_password_hash(payload.admin_password),
        nombre_completo=payload.admin_nombre_completo,
        rol=RolEnum.ADMINISTRADOR,
        activo=True,
    )
    db.add(admin)
    db.commit()

    return TenantSelfRegisterResponse(
        tenant_id=str(tenant.id),
        tenant_slug=tenant.slug,
        admin_email=admin.email,
    )
