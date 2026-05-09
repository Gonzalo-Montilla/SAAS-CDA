"""
Partes vinculadas a un caso SARLAFT.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class SarlaftCaseParty(Base):
    __tablename__ = "sarlaft_case_parties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("sarlaft_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    role = Column(String(30), nullable=False)
    doc_type = Column(String(20), nullable=False)
    doc_number = Column(String(40), nullable=False, index=True)
    full_name = Column(String(220), nullable=False)
    phone = Column(String(30), nullable=True)
    email = Column(String(255), nullable=True)
    city = Column(String(120), nullable=True)
    address = Column(String(300), nullable=True)
    metadata_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
