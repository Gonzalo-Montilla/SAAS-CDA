"""Campañas WhatsApp del CDA (Fase D). Un NIT = un WABA; no cruza tenants."""
from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class CampanaWhatsApp(Base):
    __tablename__ = "tenant_whatsapp_campanas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id", ondelete="SET NULL"), nullable=True, index=True)
    creada_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)

    nombre = Column(String(160), nullable=False)
    tipo = Column(String(30), nullable=False, index=True)
    etiqueta = Column(String(120), nullable=True)
    estado = Column(String(20), nullable=False, default="borrador", index=True)
    plantilla = Column(String(120), nullable=False)
    categoria_meta = Column(String(20), nullable=False, default="utility")
    filtros_json = Column(JSONB, nullable=True)
    texto_propuesto = Column(Text, nullable=True)
    email_asunto = Column(String(180), nullable=True)
    email_cuerpo = Column(Text, nullable=True)
    total_destinatarios = Column(Integer, nullable=False, default=0)
    enviados_ok = Column(Integer, nullable=False, default=0)
    enviados_fail = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    sent_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    destinatarios = relationship(
        "CampanaWhatsAppDestinatario",
        back_populates="campana",
        cascade="all, delete-orphan",
    )


class CampanaWhatsAppDestinatario(Base):
    __tablename__ = "tenant_whatsapp_campana_destinatarios"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campana_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenant_whatsapp_campanas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    vehiculo_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id", ondelete="SET NULL"), nullable=True)
    destino_e164 = Column(String(20), nullable=False)
    cliente_nombre = Column(String(200), nullable=False)
    placa = Column(String(12), nullable=True)
    cliente_email = Column(String(255), nullable=True)
    opt_in_tipo = Column(String(40), nullable=False)
    motivo = Column(String(240), nullable=False)
    estado = Column(String(20), nullable=False, default="pendiente", index=True)
    error = Column(Text, nullable=True)
    estado_whatsapp = Column(String(20), nullable=True)
    estado_correo = Column(String(20), nullable=True)
    error_whatsapp = Column(Text, nullable=True)
    error_correo = Column(Text, nullable=True)
    envio_id = Column(UUID(as_uuid=True), ForeignKey("tenant_whatsapp_envios.id", ondelete="SET NULL"), nullable=True)

    campana = relationship("CampanaWhatsApp", back_populates="destinatarios")
