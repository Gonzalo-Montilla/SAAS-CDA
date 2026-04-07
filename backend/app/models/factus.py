"""
Configuración Factus por tenant y registro de documentos electrónicos.
"""
from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class TenantFactusSettings(Base):
    """Credenciales y modo de facturación electrónica (Factus) por organización."""

    __tablename__ = "tenant_factus_settings"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    modo = Column(String(20), nullable=False, default="manual")  # manual | factus
    use_sandbox = Column(Boolean, nullable=False, default=True)

    client_id = Column(String(200), nullable=True)
    client_secret_encrypted = Column(Text, nullable=True)
    api_username = Column(String(255), nullable=True)
    api_password_encrypted = Column(Text, nullable=True)

    default_numbering_range_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class FacturaElectronica(Base):
    """Traza de documentos emitidos vía Factus (vinculación con cobro en fases posteriores)."""

    __tablename__ = "facturas_electronicas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    vehiculo_proceso_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id", ondelete="SET NULL"), nullable=True, index=True)

    reference_code = Column(String(120), nullable=False, index=True)
    factus_bill_id = Column(Integer, nullable=True)
    numero_documento = Column(String(80), nullable=True)
    cufe = Column(String(200), nullable=True)
    public_url = Column(String(800), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
