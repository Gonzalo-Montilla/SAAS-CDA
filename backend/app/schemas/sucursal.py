"""Schemas sucursal."""
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SucursalCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    codigo: str | None = Field(default=None, max_length=40)
    activa: bool = True
    es_principal: bool = False


class SucursalUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=200)
    codigo: str | None = None
    activa: bool | None = None
    es_principal: bool | None = None


class SucursalOut(BaseModel):
    id: UUID
    tenant_id: UUID
    nombre: str
    codigo: str | None
    activa: bool
    es_principal: bool

    model_config = ConfigDict(from_attributes=True)
