"""
Schemas de Tesorería
"""
from pydantic import BaseModel, Field, ConfigDict, field_validator
from decimal import Decimal
from datetime import datetime, date
from typing import Optional
from uuid import UUID


# Tipos de identificación del beneficiario en egresos de tesorería (deben coincidir con el front)
BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA = frozenset(
    {
        "C.C",
        "NIT",
        "TARJETA DE IDENTIDAD",
        "C.E",
        "PASAPORTE",
        "P.E.P",
    }
)


class DesgloseEfectivoCreate(BaseModel):
    """Desglose de billetes y monedas para efectivo"""
    billetes_100000: int = Field(default=0, ge=0)
    billetes_50000: int = Field(default=0, ge=0)
    billetes_20000: int = Field(default=0, ge=0)
    billetes_10000: int = Field(default=0, ge=0)
    billetes_5000: int = Field(default=0, ge=0)
    billetes_2000: int = Field(default=0, ge=0)
    billetes_1000: int = Field(default=0, ge=0)
    monedas_1000: int = Field(default=0, ge=0)
    monedas_500: int = Field(default=0, ge=0)
    monedas_200: int = Field(default=0, ge=0)
    monedas_100: int = Field(default=0, ge=0)
    monedas_50: int = Field(default=0, ge=0)
    
    def calcular_total(self) -> int:
        """Calcula el total en pesos"""
        return (
            self.billetes_100000 * 100000 +
            self.billetes_50000 * 50000 +
            self.billetes_20000 * 20000 +
            self.billetes_10000 * 10000 +
            self.billetes_5000 * 5000 +
            self.billetes_2000 * 2000 +
            self.billetes_1000 * 1000 +
            self.monedas_1000 * 1000 +
            self.monedas_500 * 500 +
            self.monedas_200 * 200 +
            self.monedas_100 * 100 +
            self.monedas_50 * 50
        )


class DesgloseEfectivoResponse(DesgloseEfectivoCreate):
    """Respuesta con desglose de efectivo"""
    id: UUID
    movimiento_id: UUID
    created_at: datetime
    total_calculado: Decimal = Field(default=Decimal(0))
    
    model_config = ConfigDict(from_attributes=True)


class MovimientoTesoreriaCreate(BaseModel):
    """Crear movimiento en tesorería"""
    tipo: str = Field(pattern="^(ingreso|egreso)$")
    categoria_ingreso: Optional[str] = None
    categoria_egreso: Optional[str] = None
    monto: Decimal = Field(gt=0)  # Siempre positivo, el tipo define si es ingreso o egreso
    concepto: str = Field(min_length=5)
    metodo_pago: str
    origen_caja_id: Optional[UUID] = None
    numero_comprobante: Optional[str] = None
    fecha_movimiento: Optional[datetime] = None  # Si no se envía, usa la fecha actual
    desglose_efectivo: Optional[DesgloseEfectivoCreate] = None  # Solo si metodo_pago es efectivo
    # Solo egreso (obligatorios vía validación en endpoint)
    beneficiario: Optional[str] = Field(default=None, max_length=300)
    beneficiario_tipo_identificacion: Optional[str] = Field(default=None, max_length=80)
    
    @field_validator('categoria_ingreso', 'categoria_egreso', mode='before')
    @classmethod
    def validar_categoria(cls, v, info):
        # Convertir cadenas vacías a None
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

class MovimientoTesoreriaResponse(BaseModel):
    """Respuesta de movimiento de tesorería"""
    id: UUID
    tipo: str
    categoria_ingreso: Optional[str]
    categoria_egreso: Optional[str]
    monto: Decimal
    concepto: str
    metodo_pago: str
    origen_caja_id: Optional[UUID]
    numero_comprobante: Optional[str]
    fecha_movimiento: datetime
    created_at: datetime
    created_by: UUID
    beneficiario: Optional[str] = None
    beneficiario_tipo_identificacion: Optional[str] = None

    anulado: bool = False
    motivo_anulacion: Optional[str] = None
    fecha_anulacion: Optional[datetime] = None
    
    # Información adicional
    categoria_display: Optional[str] = None  # Categoría formateada para mostrar
    
    model_config = ConfigDict(from_attributes=True)


class MovimientoTesoreriaAnular(BaseModel):
    """Anular movimiento (revierte efecto en saldo y desglose)."""
    motivo: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Opcional; si no se envía se usa un texto por defecto.",
    )


class ResumenTesoreria(BaseModel):
    """Resumen de tesorería en un período"""
    saldo_actual: Decimal
    total_ingresos: Decimal
    total_egresos: Decimal
    cantidad_movimientos: int
    
    # Desglose por categorías
    ingresos_por_categoria: dict[str, Decimal]
    egresos_por_categoria: dict[str, Decimal]
    
    # Alertas
    saldo_bajo_umbral: bool
    umbral_minimo: Decimal


class ProyeccionFlujo(BaseModel):
    """Proyección de flujo de caja"""
    promedio_ingresos_diarios: Decimal
    promedio_egresos_diarios: Decimal
    saldo_actual: Decimal
    dias_autonomia: int  # Días que puede operar con el saldo actual
    proyeccion_30_dias: Decimal  # Saldo proyectado en 30 días


class ConfiguracionTesoreriaResponse(BaseModel):
    """Configuración de tesorería"""
    id: UUID
    saldo_minimo_alerta: Decimal
    notificar_saldo_bajo: bool
    email_notificacion: Optional[str]
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class ConfiguracionTesoreriaUpdate(BaseModel):
    """Actualizar configuración de tesorería"""
    saldo_minimo_alerta: Optional[Decimal] = Field(ge=0, default=None)
    notificar_saldo_bajo: Optional[bool] = None
    email_notificacion: Optional[str] = None


class EstadisticasTesoreria(BaseModel):
    """Estadísticas generales de tesorería"""
    periodo_inicio: date
    periodo_fin: date
    total_ingresos: Decimal
    total_egresos: Decimal
    saldo_inicial: Decimal
    saldo_final: Decimal
    movimientos_count: int
    categoria_mas_egreso: Optional[str]
    monto_categoria_mas_egreso: Optional[Decimal]
