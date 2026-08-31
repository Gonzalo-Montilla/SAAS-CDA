"""
Modelo de Vehículos en Proceso
"""
from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, ForeignKey, Enum as SQLEnum, Text, event
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from decimal import Decimal
import uuid
import enum

from app.db.database import Base

TIPO_VEHICULO_PRUEBAS_AUDITORIA = "pruebas_auditoria"
_ZERO_COBRO = Decimal("0.00")


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
    cliente_tipo_documento = Column(String(10), nullable=False, default="CC")
    cliente_documento = Column(String(50), nullable=False)
    cliente_telefono = Column(String(20))
    cliente_email = Column(String(255))
    cliente_direccion = Column(String(300), nullable=True)
    cliente_factus_municipality_id = Column(Integer, nullable=True)
    
    # Servicio RTM
    valor_rtm = Column(Numeric(10, 2), nullable=False)
    
    # SOAT
    tiene_soat = Column(Boolean, default=False, nullable=False)
    comision_soat = Column(Numeric(10, 2), default=0)
    
    # Total y pago
    total_cobrado = Column(Numeric(10, 2), nullable=False)
    metodo_pago = Column(String(50), nullable=True)  # Cambiado a String para soportar 'mixto' y otros valores
    iva_base_gravable_servicio = Column(Numeric(12, 2), nullable=True)
    iva_valor_servicio = Column(Numeric(12, 2), nullable=True)
    valor_excluido_servicio = Column(Numeric(12, 2), nullable=True)
    
    # Facturación y registros externos
    numero_factura_dian = Column(String(100))
    registrado_runt = Column(Boolean, default=False, nullable=False)
    registrado_sicov = Column(Boolean, default=False, nullable=False)
    registrado_indra = Column(Boolean, default=False, nullable=False)
    fecha_pago = Column(DateTime, nullable=True)
    certificado_entregado_at = Column(DateTime, nullable=True)
    certificado_entregado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    revision_cierre_resultado = Column(String(40), nullable=True)
    revision_cierre_observacion = Column(Text, nullable=True)
    revision_cierre_at = Column(DateTime, nullable=True)
    revision_cierre_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    reinspeccion_origen_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id"), nullable=True, index=True)
    reinspeccion_intento = Column(Integer, nullable=False, default=1)
    reinspeccion_vence_at = Column(DateTime, nullable=True)
    reinspeccion_exenta = Column(Boolean, nullable=False, default=False)
    
    # Estado del proceso
    estado = Column(SQLEnum(EstadoVehiculo), default=EstadoVehiculo.REGISTRADO, nullable=False)
    
    # Observaciones
    observaciones = Column(Text)
    recepcion_formato_extra_json = Column(JSONB, nullable=True)
    # Copia liviana del km (fuera del JSONB de firmas) para listados de Caja.
    kilometraje = Column(String(40), nullable=True)

    # Auditoría
    caja_id = Column(UUID(as_uuid=True), ForeignKey("cajas.id"), nullable=True)
    registrado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    cobrado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    fecha_registro = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Relaciones
    caja = relationship("Caja", back_populates="vehiculos")
    registrador = relationship("Usuario", foreign_keys=[registrado_por])
    cajero = relationship("Usuario", foreign_keys=[cobrado_por])
    certificado_entregador = relationship("Usuario", foreign_keys=[certificado_entregado_por])
    revision_cierre_usuario = relationship("Usuario", foreign_keys=[revision_cierre_por])
    
    def __repr__(self):
        return f"<VehiculoProceso {self.placa} - {self.estado}>"
    
    @property
    def antiguedad(self) -> int:
        """Calcular antigüedad del vehículo"""
        ano_actual = datetime.now().year
        return ano_actual - self.ano_modelo


def enforce_tramite_sin_cobro_montos(target: VehiculoProceso) -> None:
    """
    Candado de persistencia: reinspección exenta y pruebas de auditoría
    no pueden quedar con tarifa. Cubre registrar, editar, cobrar y cualquier
    UPDATE futuro (regresión MWQ631 tras CZK66E).
    """
    tipo = (getattr(target, "tipo_vehiculo", None) or "").strip().lower()
    exenta = bool(getattr(target, "reinspeccion_exenta", False))
    if not exenta and tipo != TIPO_VEHICULO_PRUEBAS_AUDITORIA:
        return
    target.valor_rtm = _ZERO_COBRO
    target.comision_soat = _ZERO_COBRO
    target.total_cobrado = _ZERO_COBRO
    target.tiene_soat = False


@event.listens_for(VehiculoProceso, "before_insert")
def _vehiculo_before_insert(_mapper, _connection, target: VehiculoProceso) -> None:
    enforce_tramite_sin_cobro_montos(target)


@event.listens_for(VehiculoProceso, "before_update")
def _vehiculo_before_update(_mapper, _connection, target: VehiculoProceso) -> None:
    enforce_tramite_sin_cobro_montos(target)
