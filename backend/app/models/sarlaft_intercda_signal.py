"""
Registro interno de señales inter-CDA (anonimizadas).
No almacena documento en claro; solo hash y métricas agregadas.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class SarlaftIntercdaSignal(Base):
    __tablename__ = "sarlaft_intercda_signals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    source_case_id = Column(UUID(as_uuid=True), ForeignKey("sarlaft_cases.id"), nullable=True, index=True)
    doc_hash = Column(String(64), nullable=False, index=True)
    window_days = Column(Integer, nullable=False, default=30)
    alert_level = Column(String(20), nullable=False, default="media")
    reason = Column(String(80), nullable=False, default="actividad_intercda_inusual")
    metrics_json = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

