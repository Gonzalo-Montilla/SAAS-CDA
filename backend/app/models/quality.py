"""
Modelo de encuestas de calidad por tenant.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class QualitySurveyInvite(Base):
    __tablename__ = "quality_survey_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    vehiculo_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id"), nullable=True, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    sucursal_nombre = Column(String(200), nullable=True)
    cliente_nombre = Column(String(200), nullable=False)
    cliente_email = Column(String(255), nullable=True, index=True)
    cliente_celular = Column(String(30), nullable=True)
    placa = Column(String(10), nullable=False, index=True)
    tipo_vehiculo = Column(String(40), nullable=False)
    cajero_nombre = Column(String(200), nullable=True)
    recepcionista_nombre = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    response_token = Column(String(120), nullable=False, unique=True, index=True)
    scheduled_send_at = Column(DateTime, nullable=False, index=True)
    sent_at = Column(DateTime, nullable=True)
    responded_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    send_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class QualitySurveyResponse(Base):
    __tablename__ = "quality_survey_responses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invite_id = Column(UUID(as_uuid=True), ForeignKey("quality_survey_invites.id"), nullable=False, unique=True, index=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    facilidad_agendar_cita = Column(Integer, nullable=False)
    tiempo_espera_revision = Column(Integer, nullable=False)
    amabilidad_recepcion_caja = Column(Integer, nullable=False)
    limpieza_instalaciones = Column(Integer, nullable=False)
    amenidades_cda = Column(Integer, nullable=False)
    claridad_resultados_revision = Column(Integer, nullable=False)
    confianza_diagnostico_tecnico = Column(Integer, nullable=False)
    recomendar_cda = Column(Integer, nullable=False)
    experiencia_global = Column(Integer, nullable=False)
    # "mostrador" (submit en CDA) | "correo" (enlace público del email)
    canal_respuesta = Column(String(20), nullable=True, index=True)
    comentario = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

