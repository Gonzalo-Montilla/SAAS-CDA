"""
Schemas de Vehículos en Proceso
"""
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from decimal import Decimal
from datetime import datetime
from typing import Optional
from uuid import UUID


class VehiculoRegistro(BaseModel):
    """Registro de vehículo por recepción"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(default="moto")
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int = Field(ge=1950, le=2030)
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5)
    cliente_telefono: Optional[str] = None
    cliente_email: Optional[EmailStr] = None
    tiene_soat: bool = False
    observaciones: Optional[str] = None

    @field_validator("cliente_email", mode="before")
    @classmethod
    def empty_email_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


class VehiculoEdicion(BaseModel):
    """Edición de vehículo registrado (antes de cobrar)"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(default="moto")
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int = Field(ge=1950, le=2030)
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5)
    cliente_telefono: Optional[str] = None
    cliente_email: Optional[EmailStr] = None
    tiene_soat: bool = False
    observaciones: Optional[str] = None

    @field_validator("cliente_email", mode="before")
    @classmethod
    def empty_email_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


class VehiculoCobro(BaseModel):
    """Datos para cobrar un vehículo"""
    vehiculo_id: UUID
    metodo_pago: str
    tiene_soat: bool = False
    numero_factura_dian: Optional[str] = None
    registrado_runt: bool = False
    registrado_sicov: bool = False
    registrado_indra: bool = False
    valor_preventiva: Optional[Decimal] = Field(None, ge=0, description="Valor manual para servicio PREVENTIVA")
    desglose_mixto: Optional[dict] = Field(None, description="Desglose de montos por método cuando metodo_pago='mixto'")


class VehiculoResponse(BaseModel):
    """Respuesta de vehículo"""
    id: UUID
    placa: str
    tipo_vehiculo: str
    marca: Optional[str]
    modelo: Optional[str]
    ano_modelo: int
    cliente_nombre: str
    cliente_documento: str
    cliente_telefono: Optional[str]
    cliente_email: Optional[str]
    valor_rtm: Decimal
    tiene_soat: bool
    comision_soat: Decimal
    total_cobrado: Decimal
    metodo_pago: Optional[str]
    numero_factura_dian: Optional[str]
    registrado_runt: bool
    registrado_sicov: bool
    registrado_indra: bool
    fecha_pago: Optional[datetime]
    estado: str
    observaciones: Optional[str]
    fecha_registro: datetime
    
    # Campos calculados
    antiguedad: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)


class VehiculosPendientes(BaseModel):
    """Lista de vehículos pendientes de pago"""
    vehiculos: list[VehiculoResponse]
    total: int


class VehiculoConTarifa(BaseModel):
    """Vehículo con tarifa calculada"""
    placa: str
    ano_modelo: int
    antiguedad: int
    tarifa_aplicable: Decimal
    descripcion_tarifa: str


class TarifaCalculada(BaseModel):
    """Tarifa calculada para un vehículo"""
    valor_rtm: Decimal
    valor_terceros: Decimal
    valor_total: Decimal
    descripcion_antiguedad: str


class VentaSOAT(BaseModel):
    """Venta solo de comisión SOAT (sin revisión técnica)"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(pattern="^(moto|carro)$")  # Solo moto o carro
    valor_soat_comercial: Decimal = Field(gt=0, description="Valor comercial del SOAT (informativo)")
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5, max_length=10)
    metodo_pago: str
