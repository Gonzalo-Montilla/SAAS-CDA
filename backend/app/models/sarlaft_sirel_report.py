"""
Trazabilidad de reporte SARLAFT a SIREL/UIAF por caso.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class SarlaftSirelReport(Base):
    __tablename__ = "sarlaft_sirel_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    case_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sarlaft_cases.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    status = Column(String(30), nullable=False, default="pendiente_envio", index=True)
    report_type = Column(String(20), nullable=False, default="ros")
    sirel_reference = Column(String(120), nullable=True)
    sent_at = Column(DateTime, nullable=True)
    sent_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True, index=True)
    pre_ros_text = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    evidence_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
