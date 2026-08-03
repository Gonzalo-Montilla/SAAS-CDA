"""
Schemas de Vehículos en Proceso
"""
import re

from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator, model_validator
from decimal import Decimal
from datetime import datetime
from typing import Optional, Literal, Any
from uuid import UUID
from app.utils.factus_validators import (
    digito_verificacion_nit_colombia,
    digito_verificacion_nit_colombia_serie_37,
    normalizar_base_nit_persona_natural_colombia,
    parse_nit_colombiano_identificacion_y_dv,
    normalizar_numero_identificacion_proveedor,
)


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


def _normalizar_tipo_documento_cliente(v) -> str:
    s = str(v or "").strip().upper()
    if s not in {"CC", "CE", "PA", "NIT"}:
        raise ValueError("Tipo de documento inválido. Use CC, CE, PA o NIT.")
    return s


def _normalizar_documento_cliente(v, doc_type: str) -> str:
    raw = str(v or "").strip()
    if not raw:
        raise ValueError("El documento del cliente es obligatorio.")
    if doc_type == "NIT":
        normalized = normalizar_numero_identificacion_proveedor(raw)
        if not re.fullmatch(r"\d{5,20}(-\d)?", normalized):
            raise ValueError("Para NIT use solo números, opcionalmente con DV (ejemplo: 900123456 o 900123456-8).")
        ident, dv_parse = parse_nit_colombiano_identificacion_y_dv(normalized)
        if not ident:
            raise ValueError("NIT inválido.")
        if dv_parse is None:
            return ident[:20]
        norm_ident = normalizar_base_nit_persona_natural_colombia(ident)
        expected = {
            int(digito_verificacion_nit_colombia(ident)),
            int(digito_verificacion_nit_colombia_serie_37(ident)),
            int(digito_verificacion_nit_colombia(norm_ident)),
            int(digito_verificacion_nit_colombia_serie_37(norm_ident)),
        }
        if int(dv_parse) not in expected:
            raise ValueError("DV inválido para el NIT indicado. Verifique el RUT.")
        return normalized
    return re.sub(r"[^A-Z0-9]", "", raw.upper())[:20]


def _parece_nit_colombiano(documento: str) -> bool:
    s = str(documento or "").strip().upper()
    if not s:
        return False
    digits = re.sub(r"\D", "", s)
    if not digits:
        return False
    # Regla operativa acordada (sin DV/guion):
    # NIT de 9 dígitos iniciando en 1/2/8/9.
    return len(digits) == 9 and digits[0] in {"1", "2", "8", "9"}


class VehiculoRegistro(BaseModel):
    """Registro de vehículo por recepción"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(default="moto")
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int = Field(ge=1950, le=2030)
    cliente_nombre: str = Field(min_length=3)
    cliente_tipo_documento: Literal["CC", "CE", "PA", "NIT"] = "CC"
    cliente_documento: str = Field(min_length=5)
    cliente_telefono: str = Field(min_length=7, max_length=30)
    cliente_email: EmailStr
    cliente_direccion: Optional[str] = Field(default=None, max_length=300)
    cliente_factus_municipality_id: Optional[int] = Field(default=None, ge=1)
    tiene_soat: bool = False
    observaciones: Optional[str] = None
    recepcion_formato_extra: Optional[dict[str, Any]] = None
    es_reingreso_rechazo_inicial: bool = False
    reinspeccion_vehiculo_origen_id: Optional[UUID] = None

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

    @field_validator("cliente_tipo_documento", mode="before")
    @classmethod
    def normalize_doc_type(cls, v):
        return _normalizar_tipo_documento_cliente(v)

    @field_validator("cliente_documento", mode="before")
    @classmethod
    def normalize_doc_number(cls, v, info):
        doc_type = _normalizar_tipo_documento_cliente(info.data.get("cliente_tipo_documento", "CC"))
        return _normalizar_documento_cliente(v, doc_type)

    @model_validator(mode="after")
    def validar_consistencia_documento(self):
        doc_type = _normalizar_tipo_documento_cliente(self.cliente_tipo_documento)
        doc_number = str(self.cliente_documento or "").strip()
        if doc_type != "NIT" and _parece_nit_colombiano(doc_number):
            raise ValueError(
                "Tipo de documento no coincide: el número parece un NIT. Cambie el tipo de documento a NIT."
            )
        if doc_type == "NIT" and not _parece_nit_colombiano(doc_number):
            raise ValueError(
                "Tipo de documento no coincide: para NIT use 9 dígitos válidos."
            )
        return self


class VehiculoEdicion(BaseModel):
    """Edición de vehículo registrado (antes de cobrar)"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(default="moto")
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int = Field(ge=1950, le=2030)
    cliente_nombre: str = Field(min_length=3)
    cliente_tipo_documento: Literal["CC", "CE", "PA", "NIT"] = "CC"
    cliente_documento: str = Field(min_length=5)
    cliente_telefono: str = Field(min_length=7, max_length=30)
    cliente_email: EmailStr
    cliente_direccion: Optional[str] = Field(default=None, max_length=300)
    cliente_factus_municipality_id: Optional[int] = Field(default=None, ge=1)
    tiene_soat: bool = False
    observaciones: Optional[str] = None
    recepcion_formato_extra: Optional[dict[str, Any]] = None

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

    @field_validator("cliente_tipo_documento", mode="before")
    @classmethod
    def normalize_doc_type_edit(cls, v):
        return _normalizar_tipo_documento_cliente(v)

    @field_validator("cliente_documento", mode="before")
    @classmethod
    def normalize_doc_number_edit(cls, v, info):
        doc_type = _normalizar_tipo_documento_cliente(info.data.get("cliente_tipo_documento", "CC"))
        return _normalizar_documento_cliente(v, doc_type)

    @model_validator(mode="after")
    def validar_consistencia_documento(self):
        doc_type = _normalizar_tipo_documento_cliente(self.cliente_tipo_documento)
        doc_number = str(self.cliente_documento or "").strip()
        if doc_type != "NIT" and _parece_nit_colombiano(doc_number):
            raise ValueError(
                "Tipo de documento no coincide: el número parece un NIT. Cambie el tipo de documento a NIT."
            )
        if doc_type == "NIT" and not _parece_nit_colombiano(doc_number):
            raise ValueError(
                "Tipo de documento no coincide: para NIT use 9 dígitos válidos."
            )
        return self


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


class CambiarMetodoPagoRequest(BaseModel):
    """Cambio de método de pago en cobro ya registrado (mismo día, caja abierta)."""
    nuevo_metodo: str
    motivo: str = Field(..., min_length=10)
    desglose_mixto: Optional[dict] = Field(
        None,
        description="Obligatorio si nuevo_metodo='mixto'. No altera factura Factus ya emitida.",
    )


class VehiculoResponse(BaseModel):
    """Respuesta de vehículo"""
    id: UUID
    placa: str
    tipo_vehiculo: str
    marca: Optional[str]
    modelo: Optional[str]
    ano_modelo: int
    cliente_nombre: str
    cliente_tipo_documento: str
    cliente_documento: str
    cliente_telefono: Optional[str]
    cliente_email: Optional[str]
    cliente_direccion: Optional[str] = None
    cliente_factus_municipality_id: Optional[int] = None
    iva_base_gravable_servicio: Optional[Decimal] = None
    iva_valor_servicio: Optional[Decimal] = None
    valor_excluido_servicio: Optional[Decimal] = None
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
    revision_cierre_resultado: Optional[str] = None
    revision_cierre_observacion: Optional[str] = None
    revision_cierre_at: Optional[datetime] = None
    reinspeccion_origen_id: Optional[UUID] = None
    reinspeccion_intento: Optional[int] = None
    reinspeccion_vence_at: Optional[datetime] = None
    reinspeccion_exenta: Optional[bool] = None
    observaciones: Optional[str]
    recepcion_formato_extra_json: Optional[dict[str, Any]] = None
    tiene_recepcion_formato_extra: Optional[bool] = None
    fecha_registro: datetime
    
    # Campos calculados
    antiguedad: Optional[int] = None
    cajero_nombre: Optional[str] = None
    sarlaft_alert_generated: Optional[bool] = None
    sarlaft_alert_count: Optional[int] = None
    sarlaft_alert_message: Optional[str] = None
    factura_corregida: Optional[bool] = False
    factura_correccion_estado: Optional[str] = None
    factura_correccion_motivo: Optional[str] = None
    factura_correccion_at: Optional[datetime] = None
    factura_correccion_factura_original: Optional[str] = None
    factura_correccion_nota_credito: Optional[str] = None
    factura_correccion_factura_nueva: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class VehiculoCobradoHoyResponse(BaseModel):
    """Respuesta liviana para listado 'Cobros hoy' en Caja."""

    id: UUID
    placa: str
    tipo_vehiculo: str
    cliente_nombre: str
    cliente_documento: str
    cliente_telefono: Optional[str] = None
    cliente_email: Optional[str] = None
    cliente_direccion: Optional[str] = None
    metodo_pago: Optional[str] = None
    total_cobrado: Decimal
    numero_factura_dian: Optional[str] = None
    factura_corregida: Optional[bool] = False
    factura_correccion_estado: Optional[str] = None
    factura_correccion_motivo: Optional[str] = None
    factura_correccion_at: Optional[datetime] = None
    factura_correccion_factura_original: Optional[str] = None
    factura_correccion_nota_credito: Optional[str] = None
    factura_correccion_factura_nueva: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class VehiculoPendienteCajaResponse(BaseModel):
    """
    Respuesta liviana para cola de Caja.
    Omite recepcion_formato_extra_json completo (firmas base64) para no
    saturar red/CPU; solo incluye kilometraje si existe.
    """

    id: UUID
    placa: str
    tipo_vehiculo: str
    marca: Optional[str] = None
    modelo: Optional[str] = None
    ano_modelo: int
    cliente_nombre: str
    cliente_tipo_documento: str = "CC"
    cliente_documento: str
    cliente_telefono: Optional[str] = None
    cliente_email: Optional[str] = None
    cliente_direccion: Optional[str] = None
    cliente_factus_municipality_id: Optional[int] = None
    valor_rtm: Decimal
    tiene_soat: bool = False
    comision_soat: Decimal = Decimal("0")
    total_cobrado: Decimal
    metodo_pago: Optional[str] = None
    numero_factura_dian: Optional[str] = None
    registrado_runt: bool = False
    registrado_sicov: bool = False
    registrado_indra: bool = False
    fecha_pago: Optional[datetime] = None
    estado: str
    reinspeccion_intento: Optional[int] = None
    reinspeccion_exenta: Optional[bool] = None
    observaciones: Optional[str] = None
    kilometraje: Optional[str] = None
    fecha_registro: datetime
    antiguedad: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class VehiculosPendientes(BaseModel):
    """Lista de vehículos pendientes de pago"""
    vehiculos: list[VehiculoPendienteCajaResponse]
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
    document_type: Optional[str] = None
    document_number: Optional[str] = None
    titular_nombre: Optional[str] = None
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
    fuente: str = "verifik_runt"
    request_id: Optional[str] = None
    cached: bool = False
    observaciones: list[str] = []
    proveedor: Optional[str] = None


class ReinspeccionElegibilidadResponse(BaseModel):
    placa: str
    tiene_historial: bool
    elegible_reingreso: bool
    motivo: Optional[str] = None
    vehiculo_origen_id: Optional[UUID] = None
    primer_intento_at: Optional[datetime] = None
    ultimo_intento_at: Optional[datetime] = None
    intentos_usados: int = 0
    intentos_totales_permitidos: int = 3
    intentos_restantes: int = 0
    vence_at: Optional[datetime] = None


class VentaSOAT(BaseModel):
    """Venta solo de comisión SOAT (sin revisión técnica)"""
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(pattern="^(moto|carro)$")  # Solo moto o carro
    valor_soat_comercial: Decimal = Field(gt=0, description="Valor comercial del SOAT (informativo)")
    cliente_nombre: str = Field(min_length=3)
    cliente_documento: str = Field(min_length=5, max_length=10)
    metodo_pago: str
