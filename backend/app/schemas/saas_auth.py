"""
Schemas de autenticación global SaaS.
"""
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from datetime import datetime
from uuid import UUID


class SaaSUserResponse(BaseModel):
    id: UUID
    email: EmailStr
    nombre_completo: str
    rol_global: str
    activo: bool
    mfa_enabled: bool
    session_version: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SaaSUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    nombre_completo: str = Field(min_length=3, max_length=200)
    rol_global: str = Field(default="soporte")
