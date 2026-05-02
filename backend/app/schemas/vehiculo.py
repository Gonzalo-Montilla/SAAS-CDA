"""
Schemas de Vehículos en Proceso
"""
import re

from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from decimal import Decimal
from datetime import datetime
from typing import Optional
from uuid import UUID


def _validar_celular_recepcion(v) -> str:
    if v is None or (isinstance(v, str) and not str(v).strip()):
        raise ValueError("El celular es obligatorio")
    digits = re.sub(r"\D", "", str(v))
    if len(digits) < 7:
        raise ValueError("El celular debe tener al menos 7 dígitos")
    return digits


def _validar_email_recepcion(v) -> str:
    if v is None or (isinstance(v, str) and not str(v).strip()):
        raise ValueError("El correo electrónico es obligatorio")
    s = str(v).strip().lower()
    if "@" not in s or "." not in s.split("@")[-1]:
        raise ValueError("Ingrese un correo electrónico válido")
    return s


class VehiculoRegistro(BaseModel):
    """Registro de vehículo por recepción"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(default="moto")
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int = Field(ge=1950, le=2030)
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5)
    cliente_telefono: str = Field(min_length=7, max_length=30)
    cliente_email: EmailStr
    cliente_direccion: Optional[str] = Field(default=None, max_length=300)
    tiene_soat: bool = False
    observaciones: Optional[str] = None

    @field_validator("cliente_telefono", mode="before")
    @classmethod
    def normalize_phone(cls, v):
        return _validar_celular_recepcion(v)

    @field_validator("cliente_email", mode="before")
    @classmethod
    def normalize_email(cls, v):
        return _validar_email_recepcion(v)

    @field_validator("cliente_direccion", mode="before")
    @classmethod
    def strip_direccion(cls, v):
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return None
        return str(v).strip()[:300]


class VehiculoEdicion(BaseModel):
    """Edición de vehículo registrado (antes de cobrar)"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(default="moto")
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int = Field(ge=1950, le=2030)
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5)
    cliente_telefono: str = Field(min_length=7, max_length=30)
    cliente_email: EmailStr
    cliente_direccion: Optional[str] = Field(default=None, max_length=300)
    tiene_soat: bool = False
    observaciones: Optional[str] = None

    @field_validator("cliente_telefono", mode="before")
    @classmethod
    def normalize_phone_edit(cls, v):
        return _validar_celular_recepcion(v)

    @field_validator("cliente_email", mode="before")
    @classmethod
    def normalize_email_edit(cls, v):
        return _validar_email_recepcion(v)

    @field_validator("cliente_direccion", mode="before")
    @classmethod
    def strip_direccion_edit(cls, v):
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return None
        return str(v).strip()[:300]


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
    cliente_direccion: Optional[str] = None
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
    cajero_nombre: Optional[str] = None

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


class VehiculoConsultaRuntResponse(BaseModel):
    """Respuesta normalizada de consulta RUNT por placa (vía proveedor externo)."""

    placa_consultada: str
    encontrado: bool
    marca: Optional[str] = None
    linea: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: Optional[int] = None
    color: Optional[str] = None
    clase_vehiculo: Optional[str] = None
    tipo_servicio: Optional[str] = None
    cilindraje: Optional[str] = None
    tipo_vehiculo_sugerido: Optional[str] = None
    confidence: Optional[str] = None
    fuente: str = "apitude_runt"
    request_id: Optional[str] = None
    cached: bool = False
    observaciones: list[str] = []


class VentaSOAT(BaseModel):
    """Venta solo de comisión SOAT (sin revisión técnica)"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(pattern="^(moto|carro)$")  # Solo moto o carro
    valor_soat_comercial: Decimal = Field(gt=0, description="Valor comercial del SOAT (informativo)")
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5, max_length=10)
    metodo_pago: str
