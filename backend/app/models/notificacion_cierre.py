"""
Modelo de Notificaciones de Cierre de Caja
"""
from sqlalchemy import Column, String, DateTime, Boolean, Numeric, Text, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
import enum

from app.db.database import Base


class EstadoNotificacion(str, enum.Enum):
    PENDIENTE = "pendiente"
    LEIDA = "leida"
    ARCHIVADA = "archivada"


class NotificacionCierreCaja(Base):
    """
    Notificaciones de cierre de caja para administradores en Tesorería
    """
    __tablename__ = "notificaciones_cierre_caja"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    caja_id = Column(UUID(as_uuid=True), ForeignKey("cajas.id"), nullable=False)
    
    # Información del cierre
    turno = Column(String(20), nullable=False)
    cajera_nombre = Column(String(255), nullable=False)
    fecha_cierre = Column(DateTime(timezone=True), nullable=False)
    
    # Resumen financiero
    efectivo_entregar = Column(Numeric(10, 2), nullable=False)
    monto_sistema = Column(Numeric(10, 2), nullable=False)
    monto_fisico = Column(Numeric(10, 2), nullable=False)
    diferencia = Column(Numeric(10, 2), nullable=False, default=0)
    
    # Observaciones del cierre
    observaciones = Column(Text, nullable=True)
    
    # Estado de la notificación
    estado = Column(SQLEnum(EstadoNotificacion), default=EstadoNotificacion.PENDIENTE, nullable=False)
    leida_por_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    fecha_lectura = Column(DateTime(timezone=True), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relaciones
    caja = relationship("Caja", back_populates="notificaciones_cierre")
    leida_por = relationship("Usuario", foreign_keys=[leida_por_id])
