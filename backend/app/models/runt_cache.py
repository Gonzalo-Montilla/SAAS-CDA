"""
Modelo de caché interno para respuestas de consulta RUNT.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class RuntConsultaCache(Base):
    __tablename__ = "runt_consultas_cache"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)

    placa_consultada = Column(String(12), nullable=False, index=True)
    document_type = Column(String(10), nullable=True)
    document_number_normalized = Column(String(30), nullable=True)
    provider_resolved = Column(String(30), nullable=False, default="unknown")

    encontrado = Column(Boolean, nullable=False, default=False)
    payload_json = Column(JSONB, nullable=False, default=dict)

    cached_hits = Column(Integer, nullable=False, default=0)
    last_hit_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
