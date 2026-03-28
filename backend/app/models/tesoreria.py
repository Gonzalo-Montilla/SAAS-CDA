"""
Modelos de Tesorería (Caja Fuerte)
"""
from sqlalchemy import Column, String, Numeric, Boolean, DateTime, ForeignKey, Enum as SQLEnum, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
import enum

from app.db.database import Base


class TipoMovimientoTesoreria(str, enum.Enum):
    """Tipos de movimiento en tesorería"""
    INGRESO = "ingreso"
    EGRESO = "egreso"


class CategoriaIngresoTesoreria(str, enum.Enum):
    """Categorías de ingresos"""
    TRASLADO_CAJA = "traslado_caja"  # Dinero de cajas diarias
    PRESTAMO = "prestamo"
    APORTE_SOCIO = "aporte_socio"
    INGRESO_EXTERNO = "ingreso_externo"  # Otros negocios
    OTRO_INGRESO = "otro_ingreso"


class CategoriaEgresoTesoreria(str, enum.Enum):
    """Categorías de egresos"""
    NOMINA = "nomina"
    SERVICIOS_PUBLICOS = "servicios_publicos"
    ARRIENDO = "arriendo"
    PROVEEDORES = "proveedores"  # RUNT, INDRA, etc.
    COMPRA_INVENTARIO = "compra_inventario"
    MANTENIMIENTO = "mantenimiento"
    IMPUESTOS = "impuestos"
    OTROS_GASTOS = "otros_gastos"


class MetodoPagoTesoreria(str, enum.Enum):
    """Métodos de pago en tesorería"""
    EFECTIVO = "efectivo"
    TRANSFERENCIA = "transferencia"
    CHEQUE = "cheque"
    CONSIGNACION = "consignacion"


class MovimientoTesoreria(Base):
    """Movimientos de la Caja Fuerte (Tesorería)"""
    __tablename__ = "movimientos_tesoreria"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # Tipo de movimiento
    tipo = Column(SQLEnum(TipoMovimientoTesoreria), nullable=False)
    
    # Categoría (depende del tipo)
    categoria_ingreso = Column(SQLEnum(CategoriaIngresoTesoreria), nullable=True)
    categoria_egreso = Column(SQLEnum(CategoriaEgresoTesoreria), nullable=True)
    
    # Detalles del movimiento
    monto = Column(Numeric(12, 2), nullable=False)  # Positivo para ingreso, negativo para egreso
    concepto = Column(Text, nullable=False)
    metodo_pago = Column(SQLEnum(MetodoPagoTesoreria), nullable=False)
    
    # Referencias
    origen_caja_id = Column(UUID(as_uuid=True), ForeignKey("cajas.id"), nullable=True)  # Si viene de una caja diaria
    comprobante_url = Column(String(500), nullable=True)  # URL a factura/comprobante escaneado
    numero_comprobante = Column(String(50), nullable=True)  # Número de factura, cheque, etc.
    
    # Auditoría
    fecha_movimiento = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    
    # Relaciones
    caja_origen = relationship("Caja", foreign_keys=[origen_caja_id])
    usuario = relationship("Usuario", foreign_keys=[created_by])
    desglose_efectivo = relationship("DesgloseEfectivoTesoreria", back_populates="movimiento", uselist=False)
    
    def __repr__(self):
        signo = "+" if self.monto >= 0 else "-"
        return f"<MovimientoTesoreria {self.tipo} {signo}${abs(self.monto)}>"


class DesgloseEfectivoTesoreria(Base):
    """Desglose de billetes y monedas para movimientos en efectivo"""
    __tablename__ = "desglose_efectivo_tesoreria"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    movimiento_id = Column(UUID(as_uuid=True), ForeignKey("movimientos_tesoreria.id"), nullable=False, unique=True)
    
    # Billetes
    billetes_100000 = Column(Numeric(10, 0), default=0, nullable=False)
    billetes_50000 = Column(Numeric(10, 0), default=0, nullable=False)
    billetes_20000 = Column(Numeric(10, 0), default=0, nullable=False)
    billetes_10000 = Column(Numeric(10, 0), default=0, nullable=False)
    billetes_5000 = Column(Numeric(10, 0), default=0, nullable=False)
    billetes_2000 = Column(Numeric(10, 0), default=0, nullable=False)
    billetes_1000 = Column(Numeric(10, 0), default=0, nullable=False)
    
    # Monedas
    monedas_1000 = Column(Numeric(10, 0), default=0, nullable=False)
    monedas_500 = Column(Numeric(10, 0), default=0, nullable=False)
    monedas_200 = Column(Numeric(10, 0), default=0, nullable=False)
    monedas_100 = Column(Numeric(10, 0), default=0, nullable=False)
    monedas_50 = Column(Numeric(10, 0), default=0, nullable=False)
    
    # Auditoría
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relación
    movimiento = relationship("MovimientoTesoreria", back_populates="desglose_efectivo")
    
    def calcular_total(self) -> float:
        """Calcula el total en pesos según las denominaciones"""
        total = (
            float(self.billetes_100000 or 0) * 100000 +
            float(self.billetes_50000 or 0) * 50000 +
            float(self.billetes_20000 or 0) * 20000 +
            float(self.billetes_10000 or 0) * 10000 +
            float(self.billetes_5000 or 0) * 5000 +
            float(self.billetes_2000 or 0) * 2000 +
            float(self.billetes_1000 or 0) * 1000 +
            float(self.monedas_1000 or 0) * 1000 +
            float(self.monedas_500 or 0) * 500 +
            float(self.monedas_200 or 0) * 200 +
            float(self.monedas_100 or 0) * 100 +
            float(self.monedas_50 or 0) * 50
        )
        return total
    
    def __repr__(self):
        return f"<DesgloseEfectivo total=${self.calcular_total():,.0f}>"


class ConfiguracionTesoreria(Base):
    """Configuración de alertas y parámetros de tesorería"""
    __tablename__ = "configuracion_tesoreria"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # Alertas
    saldo_minimo_alerta = Column(Numeric(12, 2), default=100000)  # Alerta si saldo < $100,000
    notificar_saldo_bajo = Column(Boolean, default=True)
    
    # Email para notificaciones (opcional)
    email_notificacion = Column(String(200), nullable=True)
    
    # Última actualización
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    updated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"))
    
    # Relación
    usuario = relationship("Usuario", foreign_keys=[updated_by])
    
    def __repr__(self):
        return f"<ConfiguracionTesoreria saldo_min=${self.saldo_minimo_alerta}>"
