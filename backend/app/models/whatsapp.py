"""
WhatsApp Business del CDA (1 NIT = 1 WABA). El CDA contrata Meta/BSP; CDASoft solo integra.
"""
from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class TenantWhatsAppSettings(Base):
    __tablename__ = "tenant_whatsapp_settings"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    # cloud_api = Graph de Meta. dialog360 = BSP 360dialog (mismo payload, otra URL/header).
    proveedor = Column(String(20), nullable=False, default="dialog360")
    habilitado = Column(Boolean, nullable=False, default=False)
    phone_number_id = Column(String(40), nullable=True)
    waba_id = Column(String(40), nullable=True)
    access_token_encrypted = Column(Text, nullable=True)
    dialog360_api_key_encrypted = Column(Text, nullable=True)
    display_phone_e164 = Column(String(20), nullable=True)

    avisos_calidad = Column(Boolean, nullable=False, default=False)
    plantilla_calidad = Column(String(120), nullable=True)
    plantilla_calidad_lang = Column(String(10), nullable=False, default="es")
    avisos_operativos = Column(Boolean, nullable=False, default=True)
    plantilla_bienvenida = Column(String(120), nullable=True)
    plantilla_caja = Column(String(120), nullable=True)
    plantilla_recibo = Column(String(120), nullable=True)
    avisos_citas = Column(Boolean, nullable=False, default=True)
    plantilla_cita = Column(String(120), nullable=True)
    plantilla_cita_recordatorio = Column(String(120), nullable=True)
    avisos_vencimientos = Column(Boolean, nullable=False, default=True)
    plantilla_rtm = Column(String(120), nullable=True)
    plantilla_preventiva = Column(String(120), nullable=True)
    plantilla_reinspeccion = Column(String(120), nullable=True)
    plantilla_aprobacion = Column(String(120), nullable=True)

    last_error = Column(Text, nullable=True)
    last_ok_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class TenantWhatsAppEnvio(Base):
    """Traza de envíos de utilidad. No mezcla tenants: cada fila lleva tenant_id."""

    __tablename__ = "tenant_whatsapp_envios"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    destino_e164 = Column(String(20), nullable=False)
    evento = Column(String(40), nullable=False)
    plantilla = Column(String(120), nullable=True)
    estado = Column(String(20), nullable=False)
    proveedor_message_id = Column(String(80), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
