"""
Modelos de Caja y Movimientos
"""
from sqlalchemy import Column, String, Numeric, Boolean, DateTime, ForeignKey, Enum as SQLEnum, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from decimal import Decimal
import uuid
import enum

from app.db.database import Base


class TurnoEnum(str, enum.Enum):
    """Turnos de trabajo"""
    MANANA = "mañana"
    TARDE = "tarde"
    NOCHE = "noche"


class EstadoCaja(str, enum.Enum):
    """Estados de la caja"""
    ABIERTA = "abierta"
    CERRADA = "cerrada"


class TipoMovimiento(str, enum.Enum):
    """Tipos de movimiento en caja"""
    RTM = "rtm"
    COMISION_SOAT = "comision_soat"
    GASTO = "gasto"
    DEVOLUCION = "devolucion"
    AJUSTE = "ajuste"


class Caja(Base):
    """Caja diaria de trabajo"""
    __tablename__ = "cajas"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # Usuario responsable
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    
    # Apertura
    fecha_apertura = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    monto_inicial = Column(Numeric(10, 2), nullable=False)
    turno = Column(SQLEnum(TurnoEnum), nullable=False)
    
    # Cierre
    fecha_cierre = Column(DateTime, nullable=True)
    monto_final_sistema = Column(Numeric(10, 2), nullable=True)  # Calculado
    monto_final_fisico = Column(Numeric(10, 2), nullable=True)   # Contado
    diferencia = Column(Numeric(10, 2), nullable=True)
    observaciones_cierre = Column(Text)
    
    # Estado
    estado = Column(SQLEnum(EstadoCaja), default=EstadoCaja.ABIERTA, nullable=False)
    
    # Relaciones
    usuario = relationship("Usuario", backref="cajas")
    vehiculos = relationship("VehiculoProceso", back_populates="caja")
    movimientos = relationship("MovimientoCaja", back_populates="caja", cascade="all, delete-orphan")
    desglose_cierre = relationship("DesgloseEfectivoCierre", back_populates="caja", uselist=False)
    notificaciones_cierre = relationship("NotificacionCierreCaja", back_populates="caja")
    
    def __repr__(self):
        return f"<Caja {self.turno} - {self.usuario.nombre_completo} - {self.estado}>"
    
    @property
    def total_ingresos_efectivo(self) -> Decimal:
        """Total de ingresos en efectivo (excluye CrediSmart)"""
        total = sum(
            m.monto for m in self.movimientos 
            if m.ingresa_efectivo and m.monto > 0
        )
        return Decimal(str(total)) if total else Decimal('0')
    
    @property
    def total_egresos(self) -> Decimal:
        """Total de egresos"""
        total = sum(
            abs(m.monto) for m in self.movimientos 
            if m.monto < 0
        )
        return Decimal(str(total)) if total else Decimal('0')
    
    @property
    def saldo_esperado(self) -> Decimal:
        """Saldo esperado en caja"""
        return Decimal(str(self.monto_inicial)) + self.total_ingresos_efectivo - self.total_egresos


class MovimientoCaja(Base):
    """Movimientos individuales de caja"""
    __tablename__ = "movimientos_caja"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # Relaciones
    caja_id = Column(UUID(as_uuid=True), ForeignKey("cajas.id"), nullable=False)
    vehiculo_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id"), nullable=True)
    
    # Detalles del movimiento
    tipo = Column(SQLEnum(TipoMovimiento), nullable=False)
    monto = Column(Numeric(10, 2), nullable=False)  # Positivo=ingreso, Negativo=egreso
    metodo_pago = Column(String(50))  # efectivo, tarjeta, etc
    concepto = Column(Text, nullable=False)
    
    # Control especial para CrediSmart
    ingresa_efectivo = Column(Boolean, default=True, nullable=False)
    
    # Auditoría
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"))
    
    # Relaciones
    caja = relationship("Caja", back_populates="movimientos")
    vehiculo = relationship("VehiculoProceso")
    usuario = relationship("Usuario")
    
    def __repr__(self):
        signo = "+" if self.monto >= 0 else "-"
        return f"<MovimientoCaja {self.tipo} {signo}${abs(self.monto)}>"


class DesgloseEfectivoCierre(Base):
    """Desglose de billetes y monedas al cerrar caja"""
    __tablename__ = "desglose_efectivo_cierre"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    caja_id = Column(UUID(as_uuid=True), ForeignKey("cajas.id"), nullable=False, unique=True)
    
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
    caja = relationship("Caja", back_populates="desglose_cierre")
    
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
        return f"<DesgloseEfectivoCierre total=${self.calcular_total():,.0f}>"
