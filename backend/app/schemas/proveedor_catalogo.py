"""Schemas catálogo de proveedores (documento soporte Factus)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.tesoreria import BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA


class ProveedorCatalogoBase(BaseModel):
    alias: Optional[str] = Field(default=None, max_length=120)
    razon_social_rut: str = Field(min_length=2, max_length=300)
    tipo_identificacion: str = Field(max_length=80)
    numero_identificacion: str = Field(min_length=4, max_length=80)
    direccion: str = Field(min_length=8, max_length=500)
    email: str = Field(max_length=255)
    telefono: str = Field(max_length=30)
    factus_municipality_id: int = Field(ge=1)
    activo: bool = True


class ProveedorCatalogoCreate(ProveedorCatalogoBase):
    pass


class ProveedorCatalogoUpdate(BaseModel):
    alias: Optional[str] = Field(default=None, max_length=120)
    razon_social_rut: Optional[str] = Field(default=None, min_length=2, max_length=300)
    tipo_identificacion: Optional[str] = Field(default=None, max_length=80)
    numero_identificacion: Optional[str] = Field(default=None, min_length=4, max_length=80)
    direccion: Optional[str] = Field(default=None, min_length=8, max_length=500)
    email: Optional[str] = Field(default=None, max_length=255)
    telefono: Optional[str] = Field(default=None, max_length=30)
    factus_municipality_id: Optional[int] = Field(default=None, ge=1)
    activo: Optional[bool] = None


class ProveedorCatalogoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    alias: Optional[str]
    razon_social_rut: str
    tipo_identificacion: str
    numero_identificacion: str
    direccion: str
    email: str
    telefono: str
    factus_municipality_id: int
    activo: bool
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


def validar_tipo_identificacion_proveedor(tipo: str) -> str:
    t = (tipo or "").strip()
    if t not in BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA:
        raise ValueError(
            f"Tipo de identificación no válido. Use uno de: {', '.join(sorted(BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA))}."
        )
    return t
