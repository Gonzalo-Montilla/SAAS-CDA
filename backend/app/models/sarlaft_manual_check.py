"""
Registro de consultas manuales SARLAFT (fuera de recepción).
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class SarlaftManualCheck(Base):
    __tablename__ = "sarlaft_manual_checks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False, index=True)
    subject_type = Column(String(20), nullable=False, default="natural")  # natural | juridica
    full_name = Column(String(220), nullable=False)
    doc_type = Column(String(20), nullable=True)
    doc_number = Column(String(60), nullable=True, index=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    economic_activity = Column(String(200), nullable=True)
    legal_representative = Column(String(220), nullable=True)
    dataset = Column(String(60), nullable=False, default="sanctions")
    algorithm = Column(String(40), nullable=False, default="best")
    risk_level = Column(String(20), nullable=False, default="verde")
    risk_score = Column(Numeric(5, 2), nullable=False, default=0)
    alert = Column(Boolean, nullable=False, default=False)
    hits_count = Column(Integer, nullable=False, default=0)
    hits_json = Column(JSONB, nullable=True)
    notes = Column(Text, nullable=True)
    certificate_code = Column(String(120), nullable=True, index=True)
    certificate_pdf_relpath = Column(String(512), nullable=True)
    certificate_pdf_sha256 = Column(String(64), nullable=True)
    certificate_issued_at = Column(DateTime, nullable=True)
    certificate_issued_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
