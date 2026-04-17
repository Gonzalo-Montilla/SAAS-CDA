"""
Schemas de Tarifas
"""
from pydantic import BaseModel, Field, ConfigDict
from decimal import Decimal
from datetime import date
from typing import Optional
from uuid import UUID


class TarifaCreate(BaseModel):
    """Crear tarifa"""
    ano_vigencia: int = Field(ge=2020, le=2050)
    vigencia_inicio: date
    vigencia_fin: date
    tipo_vehiculo: str = Field(pattern="^(moto|liviano_particular|liviano_publico|pesado_particular|pesado_publico)$")
    antiguedad_min: int = Field(ge=0)
    antiguedad_max: Optional[int] = None
    valor_rtm: Decimal = Field(gt=0)
    valor_terceros_runt: Decimal = Field(ge=0)
    valor_terceros_sicov: Decimal = Field(ge=0)
    valor_terceros_bancarizacion: Decimal = Field(ge=0)
    valor_terceros_ansv: Decimal = Field(ge=0)


class TarifaUpdate(BaseModel):
    """Actualizar tarifa"""
    valor_rtm: Optional[Decimal] = Field(default=None, gt=0)
    valor_terceros_runt: Optional[Decimal] = Field(default=None, ge=0)
    valor_terceros_sicov: Optional[Decimal] = Field(default=None, ge=0)
    valor_terceros_bancarizacion: Optional[Decimal] = Field(default=None, ge=0)
    valor_terceros_ansv: Optional[Decimal] = Field(default=None, ge=0)
    activa: Optional[bool] = None


class TarifaResponse(BaseModel):
    """Respuesta de tarifa"""
    id: UUID
    ano_vigencia: int
    vigencia_inicio: date
    vigencia_fin: date
    tipo_vehiculo: str
    antiguedad_min: int
    antiguedad_max: Optional[int]
    valor_rtm: Decimal
    valor_terceros: Decimal
    valor_terceros_runt: Decimal
    valor_terceros_sicov: Decimal
    valor_terceros_bancarizacion: Decimal
    valor_terceros_ansv: Decimal
    valor_total: Decimal
    activa: bool
    descripcion_antiguedad: str
    
    model_config = ConfigDict(from_attributes=True)


class TarifasPorAno(BaseModel):
    """Tarifas agrupadas por año"""
    ano: int
    tarifas: list[TarifaResponse]


class ComisionSOATCreate(BaseModel):
    """Crear comisión SOAT"""
    tipo_vehiculo: str = Field(pattern="^(moto|carro)$")
    valor_comision: Decimal = Field(gt=0)
    vigencia_inicio: date
    vigencia_fin: Optional[date] = None


class ComisionSOATUpdate(BaseModel):
    """Actualizar comisión SOAT"""
    tipo_vehiculo: Optional[str] = Field(default=None, pattern="^(moto|carro)$")
    valor_comision: Optional[Decimal] = Field(default=None, gt=0)
    vigencia_inicio: Optional[date] = None
    vigencia_fin: Optional[date] = None
    activa: Optional[bool] = None


class ComisionSOATResponse(BaseModel):
    """Respuesta de comisión SOAT"""
    id: UUID
    tipo_vehiculo: str
    valor_comision: Decimal
    vigencia_inicio: date
    vigencia_fin: Optional[date]
    activa: bool
    
    model_config = ConfigDict(from_attributes=True)


class CalculoTarifa(BaseModel):
    """Resultado de cálculo de tarifa"""
    ano_modelo: int
    antiguedad: int
    tarifa_aplicable: TarifaResponse
    comision_soat: Optional[Decimal] = None
    total: Decimal
