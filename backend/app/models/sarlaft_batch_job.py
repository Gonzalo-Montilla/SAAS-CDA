"""
Cabecera de procesamiento por lotes para consultas manuales SARLAFT.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class SarlaftBatchJob(Base):
    __tablename__ = "sarlaft_batch_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    dataset = Column(String(60), nullable=False, default="sanctions")
    status = Column(String(30), nullable=False, default="queued", index=True)
    total_records = Column(Integer, nullable=False, default=0)
    processed_records = Column(Integer, nullable=False, default=0)
    success_records = Column(Integer, nullable=False, default=0)
    error_records = Column(Integer, nullable=False, default=0)
    verde_records = Column(Integer, nullable=False, default=0)
    amarillo_records = Column(Integer, nullable=False, default=0)
    rojo_records = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
