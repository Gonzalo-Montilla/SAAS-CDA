"""
Detalle por fila procesada en lote de consultas manuales SARLAFT.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class SarlaftBatchRow(Base):
    __tablename__ = "sarlaft_batch_rows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    batch_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sarlaft_batch_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_index = Column(Integer, nullable=False)
    subject_type = Column(String(20), nullable=True)
    full_name = Column(String(220), nullable=True)
    doc_type = Column(String(20), nullable=True)
    doc_number = Column(String(60), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    risk_level = Column(String(20), nullable=True)
    hits_count = Column(Integer, nullable=False, default=0)
    alert = Column(Boolean, nullable=False, default=False)
    source_labels_json = Column(JSONB, nullable=True)
    source_coverage_json = Column(JSONB, nullable=True)
    error_detail = Column(Text, nullable=True)
    created_manual_check_id = Column(UUID(as_uuid=True), ForeignKey("sarlaft_manual_checks.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
