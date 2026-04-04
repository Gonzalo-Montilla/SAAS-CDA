"""
Schemas de Usuario
"""
from pydantic import BaseModel, EmailStr, ConfigDict, Field
from datetime import datetime
from typing import Optional
from uuid import UUID


class TenantBrandingResponse(BaseModel):
    nombre_comercial: str
    logo_url: Optional[str] = None
    color_primario: str
    color_secundario: str


class UsuarioBase(BaseModel):
    """Base de usuario"""
    email: EmailStr
    nombre_completo: str
    rol: str


class UsuarioCreate(BaseModel):
    """Crear usuario"""
    email: EmailStr
    password: str
    nombre_completo: str
    rol: str = "cajero"


class UsuarioUpdate(BaseModel):
    """Actualizar usuario"""
    email: Optional[EmailStr] = None
    nombre_completo: Optional[str] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None


class SucursalBasica(BaseModel):
    id: UUID
    nombre: str
    codigo: Optional[str] = None
    activa: bool
    es_principal: bool

    model_config = ConfigDict(from_attributes=True)


class UsuarioResponse(BaseModel):
    """Respuesta de usuario"""
    id: UUID
    tenant_id: UUID
    email: EmailStr
    nombre_completo: str
    rol: str
    activo: bool
    created_at: datetime
    tenant_slug: Optional[str] = None
    tenant_branding: Optional[TenantBrandingResponse] = None
    sucursal_id: Optional[UUID] = None
    sucursales: Optional[list[SucursalBasica]] = None
    active_sucursal_id: Optional[UUID] = None
    tenant_sedes_totales: Optional[int] = Field(
        default=None,
        description="Límite de sedes contratado en el plan del tenant (p. ej. registro inicial).",
    )

    model_config = ConfigDict(from_attributes=True)


class UsuarioList(BaseModel):
    """Lista de usuarios"""
    usuarios: list[UsuarioResponse]
    total: int
