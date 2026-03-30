"""
Schemas de Usuario
"""
from pydantic import BaseModel, EmailStr, ConfigDict
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


class UsuarioResponse(BaseModel):
    """Respuesta de usuario"""
    id: UUID
    tenant_id: UUID
    email: EmailStr
    nombre_completo: str
    rol: str
    activo: bool
    created_at: datetime
    tenant_branding: Optional[TenantBrandingResponse] = None
    
    model_config = ConfigDict(from_attributes=True)


class UsuarioList(BaseModel):
    """Lista de usuarios"""
    usuarios: list[UsuarioResponse]
    total: int
