"""
Modelo de Tarifas con vigencias anuales
"""
from sqlalchemy import Column, String, Integer, Numeric, Date, Boolean, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from app.db.database import Base


class Tarifa(Base):
    """Tarifas de servicios RTM con vigencias"""
    __tablename__ = "tarifas"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # Vigencia
    ano_vigencia = Column(Integer, nullable=False, index=True)  # 2025, 2026, etc
    vigencia_inicio = Column(Date, nullable=False)
    vigencia_fin = Column(Date, nullable=False)
    
    # Tipo de vehículo
    tipo_vehiculo = Column(String(50), nullable=False, index=True)  # 'moto', 'liviano_particular', 'liviano_publico', 'pesado_particular', 'pesado_publico'
    
    # Categoría (por antigüedad)
    antiguedad_min = Column(Integer, nullable=False)  # 0, 3, 8, 17
    antiguedad_max = Column(Integer, nullable=True)   # 2, 7, 16, None (para 17+)
    
    # Valores
    valor_rtm = Column(Numeric(10, 2), nullable=False)
    valor_terceros = Column(Numeric(10, 2), nullable=False)
    valor_total = Column(Numeric(10, 2), nullable=False)
    
    # Estado
    activa = Column(Boolean, default=True, nullable=False)
    
    # Auditoría
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"))
    
    # Relación con usuario creador
    creador = relationship("Usuario", foreign_keys=[created_by])
    
    # Constraints
    __table_args__ = (
        CheckConstraint('vigencia_fin > vigencia_inicio', name='check_vigencia'),
        CheckConstraint('antiguedad_min >= 0', name='check_antiguedad_min'),
    )
    
    def __repr__(self):
        antiguedad_str = f"{self.antiguedad_min}-{self.antiguedad_max}" if self.antiguedad_max else f"{self.antiguedad_min}+"
        return f"<Tarifa {self.ano_vigencia} ({antiguedad_str} años): ${self.valor_total}>"
    
    @property
    def descripcion_antiguedad(self) -> str:
        """Descripción legible de la antigüedad"""
        if self.antiguedad_max is None:
            return f"{self.antiguedad_min}+ años"
        elif self.antiguedad_min == self.antiguedad_max:
            return f"{self.antiguedad_min} año"
        else:
            return f"{self.antiguedad_min}-{self.antiguedad_max} años"


class ComisionSOAT(Base):
    """Comisiones por venta de SOAT"""
    __tablename__ = "comisiones_soat"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    tipo_vehiculo = Column(String(50), nullable=False)  # 'moto', 'carro'
    valor_comision = Column(Numeric(10, 2), nullable=False)
    vigencia_inicio = Column(Date, nullable=False)
    vigencia_fin = Column(Date, nullable=True)
    activa = Column(Boolean, default=True, nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"))
    
    creador = relationship("Usuario", foreign_keys=[created_by])
    
    def __repr__(self):
        return f"<ComisionSOAT {self.tipo_vehiculo}: ${self.valor_comision}>"
