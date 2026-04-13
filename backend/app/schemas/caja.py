"""
Schemas de Caja y Movimientos
"""
from pydantic import BaseModel, Field, ConfigDict
from decimal import Decimal
from datetime import datetime
from typing import Optional
from uuid import UUID


class CajaApertura(BaseModel):
    """Apertura de caja"""
    monto_inicial: Decimal = Field(ge=0)
    turno: str = Field(pattern="^(mañana|tarde|noche)$")


class DesgloseEfectivoCreate(BaseModel):
    """Desglose de efectivo al cerrar caja"""
    billetes_100000: int = Field(ge=0, default=0)
    billetes_50000: int = Field(ge=0, default=0)
    billetes_20000: int = Field(ge=0, default=0)
    billetes_10000: int = Field(ge=0, default=0)
    billetes_5000: int = Field(ge=0, default=0)
    billetes_2000: int = Field(ge=0, default=0)
    billetes_1000: int = Field(ge=0, default=0)
    monedas_1000: int = Field(ge=0, default=0)
    monedas_500: int = Field(ge=0, default=0)
    monedas_200: int = Field(ge=0, default=0)
    monedas_100: int = Field(ge=0, default=0)
    monedas_50: int = Field(ge=0, default=0)
    
    def calcular_total(self) -> Decimal:
        """Calcula el total del desglose"""
        total = (
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
        return Decimal(total)


class CajaCierre(BaseModel):
    """Cierre de caja"""
    monto_final_fisico: Decimal = Field(ge=0)
    desglose_efectivo: DesgloseEfectivoCreate
    observaciones_cierre: Optional[str] = None


class MovimientoCreate(BaseModel):
    """Crear movimiento manual (gasto, ajuste, etc)"""
    tipo: str
    monto: Decimal
    metodo_pago: Optional[str] = None
    concepto: str = Field(min_length=5)
    ingresa_efectivo: bool = True
    beneficiario: Optional[str] = Field(default=None, max_length=300)
    beneficiario_tipo_identificacion: Optional[str] = Field(default=None, max_length=80)
    beneficiario_numero_identificacion: Optional[str] = Field(default=None, max_length=80)


class MovimientoResponse(BaseModel):
    """Respuesta de movimiento"""
    id: UUID
    tipo: str
    monto: Decimal
    metodo_pago: Optional[str]
    concepto: str
    ingresa_efectivo: bool
    created_at: datetime
    beneficiario: Optional[str] = None
    beneficiario_tipo_identificacion: Optional[str] = None
    beneficiario_numero_identificacion: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CajaResponse(BaseModel):
    """Respuesta de caja"""
    id: UUID
    usuario_id: UUID
    fecha_apertura: datetime
    monto_inicial: Decimal
    turno: str
    fecha_cierre: Optional[datetime]
    monto_final_sistema: Optional[Decimal]
    monto_final_fisico: Optional[Decimal]
    diferencia: Optional[Decimal]
    observaciones_cierre: Optional[str]
    estado: str
    
    # Propiedades calculadas
    total_ingresos_efectivo: Optional[Decimal] = None
    total_egresos: Optional[Decimal] = None
    saldo_esperado: Optional[Decimal] = None
    
    model_config = ConfigDict(from_attributes=True)


class CajaDetalle(BaseModel):
    """Detalle completo de caja con movimientos"""
    caja: CajaResponse
    movimientos: list[MovimientoResponse]
    vehiculos_cobrados: int
    
    # Resumen por método de pago
    total_efectivo: Decimal
    total_tarjeta: Decimal
    total_transferencia: Decimal
    total_credismart: Decimal
    total_sistecredito: Decimal


class CajaResumen(BaseModel):
    """Resumen para pre-cierre"""
    caja_id: UUID
    monto_inicial: Decimal
    total_ingresos: Decimal
    total_ingresos_efectivo: Decimal
    total_egresos: Decimal
    saldo_esperado: Decimal
    
    # Desglose por método
    efectivo: Decimal
    tarjeta_debito: Decimal
    tarjeta_credito: Decimal
    transferencia: Decimal
    credismart: Decimal
    sistecredito: Decimal
    
    # Desglose por concepto
    total_rtm: Decimal
    total_comision_soat: Decimal
    
    # Estadísticas
    vehiculos_cobrados: int
    diferencia_actual: Optional[Decimal] = None
