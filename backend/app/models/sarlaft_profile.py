"""
Configuración SARLAFT por tenant.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class SarlaftProfile(Base):
    __tablename__ = "sarlaft_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True, index=True)
    enabled = Column(Boolean, nullable=False, default=False)
    mode = Column(String(20), nullable=False, default="manual")
    cash_threshold_cop = Column(Numeric(14, 2), nullable=False, default=0)
    api_trigger_mode = Column(String(20), nullable=False, default="risk_only")
    api_provider = Column(String(50), nullable=True)
    api_fallback_to_manual = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
