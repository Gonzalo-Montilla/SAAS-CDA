"""
Modelo de Vehículos en Proceso
"""
from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, ForeignKey, Enum as SQLEnum, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
import enum

from app.db.database import Base


class EstadoVehiculo(str, enum.Enum):
    """Estados del vehículo en el proceso"""
    REGISTRADO = "registrado"       # Recepción lo registró
    PAGADO = "pagado"               # Caja cobró
    EN_PISTA = "en_pista"           # Está siendo inspeccionado
    APROBADO = "aprobado"           # Pasó la RTM
    RECHAZADO = "rechazado"         # No pasó (necesita re-inspección)
    COMPLETADO = "completado"       # Proceso terminado


class MetodoPago(str, enum.Enum):
    """Métodos de pago disponibles"""
    EFECTIVO = "efectivo"
    TARJETA_DEBITO = "tarjeta_debito"
    TARJETA_CREDITO = "tarjeta_credito"
    TRANSFERENCIA = "transferencia"
    MIXTO = "mixto"
    CREDISMART = "credismart"
    SISTECREDITO = "sistecredito"


class VehiculoProceso(Base):
    """Vehículo en proceso de revisión técnico-mecánica"""
    __tablename__ = "vehiculos_proceso"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    
    # Datos del vehículo
    placa = Column(String(10), nullable=False, index=True)
    tipo_vehiculo = Column(String(50), nullable=False, default="moto")
    marca = Column(String(100))
    modelo = Column(String(100))
    ano_modelo = Column(Integer, nullable=False)  # Para calcular tarifa
    
    # Datos del cliente
    cliente_nombre = Column(String(200), nullable=False)
    cliente_documento = Column(String(50), nullable=False)
    cliente_telefono = Column(String(20))
    cliente_email = Column(String(255))
    
    # Servicio RTM
    valor_rtm = Column(Numeric(10, 2), nullable=False)
    
    # SOAT
    tiene_soat = Column(Boolean, default=False, nullable=False)
    comision_soat = Column(Numeric(10, 2), default=0)
    
    # Total y pago
    total_cobrado = Column(Numeric(10, 2), nullable=False)
    metodo_pago = Column(String(50), nullable=True)  # Cambiado a String para soportar 'mixto' y otros valores
    
    # Facturación y registros externos
    numero_factura_dian = Column(String(100))
    registrado_runt = Column(Boolean, default=False, nullable=False)
    registrado_sicov = Column(Boolean, default=False, nullable=False)
    registrado_indra = Column(Boolean, default=False, nullable=False)
    fecha_pago = Column(DateTime, nullable=True)
    
    # Estado del proceso
    estado = Column(SQLEnum(EstadoVehiculo), default=EstadoVehiculo.REGISTRADO, nullable=False)
    
    # Observaciones
    observaciones = Column(Text)
    
    # Auditoría
    caja_id = Column(UUID(as_uuid=True), ForeignKey("cajas.id"), nullable=True)
    registrado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    cobrado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    fecha_registro = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Relaciones
    caja = relationship("Caja", back_populates="vehiculos")
    registrador = relationship("Usuario", foreign_keys=[registrado_por])
    cajero = relationship("Usuario", foreign_keys=[cobrado_por])
    
    def __repr__(self):
        return f"<VehiculoProceso {self.placa} - {self.estado}>"
    
    @property
    def antiguedad(self) -> int:
        """Calcular antigüedad del vehículo"""
        ano_actual = datetime.now().year
        return ano_actual - self.ano_modelo
