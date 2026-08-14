"""Schemas obligaciones proveedor (CxP formal gerencial)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


EstadoObligacion = Literal["abierta", "parcial", "pagada", "anulada"]


class ObligacionProveedorCreate(BaseModel):
    proveedor_catalogo_id: Optional[UUID] = None
    proveedor_nombre: str = Field(..., min_length=2, max_length=300)
    proveedor_documento: str = Field(..., min_length=3, max_length=80)
    proveedor_tipo_documento: Optional[str] = Field(None, max_length=80)
    numero_documento: str = Field(..., min_length=1, max_length=80)
    fecha_emision: date
    fecha_vencimiento: Optional[date] = None
    concepto: str = Field(..., min_length=2)
    notas: Optional[str] = None
    valor_total: Decimal = Field(..., gt=0)
    sucursal_id: Optional[UUID] = None

    @field_validator("proveedor_nombre", "proveedor_documento", "numero_documento", "concepto")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return (v or "").strip()


class ObligacionProveedorUpdate(BaseModel):
    proveedor_nombre: Optional[str] = Field(None, min_length=2, max_length=300)
    proveedor_documento: Optional[str] = Field(None, min_length=3, max_length=80)
    proveedor_tipo_documento: Optional[str] = Field(None, max_length=80)
    numero_documento: Optional[str] = Field(None, min_length=1, max_length=80)
    fecha_emision: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    concepto: Optional[str] = Field(None, min_length=2)
    notas: Optional[str] = None
    valor_total: Optional[Decimal] = Field(None, gt=0)
    sucursal_id: Optional[UUID] = None
    estado: Optional[EstadoObligacion] = None


class ObligacionPagoCreate(BaseModel):
    monto: Decimal = Field(..., gt=0)
    fecha_pago: Optional[date] = None
    notas: Optional[str] = None
    movimiento_tesoreria_id: Optional[UUID] = None


class ObligacionPagoResponse(BaseModel):
    id: UUID
    monto: Decimal
    fecha_pago: date
    notas: Optional[str] = None
    movimiento_tesoreria_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ObligacionProveedorResponse(BaseModel):
    id: UUID
    sucursal_id: Optional[UUID] = None
    proveedor_catalogo_id: Optional[UUID] = None
    proveedor_nombre: str
    proveedor_documento: str
    proveedor_tipo_documento: Optional[str] = None
    numero_documento: str
    fecha_emision: date
    fecha_vencimiento: Optional[date] = None
    concepto: str
    notas: Optional[str] = None
    valor_total: Decimal
    saldo_pendiente: Decimal
    estado: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    dias_vencida: int = 0
    tramo_vencimiento: str = "al_dia"

    class Config:
        from_attributes = True


class ObligacionesListResponse(BaseModel):
    resumen: dict
    items: list[ObligacionProveedorResponse]
