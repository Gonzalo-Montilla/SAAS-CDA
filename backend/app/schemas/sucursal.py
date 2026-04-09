"""Schemas sucursal."""
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SucursalCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    codigo: str | None = Field(default=None, max_length=40)
    activa: bool = True
    es_principal: bool = False
    factus_municipality_id: int | None = Field(default=None, ge=1)
    factus_numbering_range_id: int | None = Field(
        default=None,
        ge=1,
        description="Id numérico del rango Factus para esta sede (distinto por ciudad/resolución). Opcional si hay rango por defecto en tenant.",
    )
    direccion: str | None = Field(default=None, max_length=500)
    ciudad: str | None = Field(default=None, max_length=200)


class SucursalUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=200)
    codigo: str | None = None
    activa: bool | None = None
    es_principal: bool | None = None
    factus_municipality_id: int | None = Field(default=None, ge=1)
    factus_numbering_range_id: int | None = Field(
        default=None,
        description="NULL quita el rango propio de la sede y aplica el predeterminado del tenant.",
    )
    direccion: str | None = Field(default=None, max_length=500)
    ciudad: str | None = Field(default=None, max_length=200)


class SucursalOut(BaseModel):
    id: UUID
    tenant_id: UUID
    nombre: str
    codigo: str | None
    activa: bool
    es_principal: bool
    factus_municipality_id: int | None = None
    factus_numbering_range_id: int | None = None
    direccion: str | None = None
    ciudad: str | None = None

    model_config = ConfigDict(from_attributes=True)
