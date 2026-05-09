"""
Caso SARLAFT por operación.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class SarlaftCase(Base):
    __tablename__ = "sarlaft_cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sede_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    operacion_ref = Column(String(120), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="open")
    risk_level = Column(String(20), nullable=False, default="verde")
    risk_score = Column(Numeric(5, 2), nullable=False, default=0)
    transaction_amount_cop = Column(Numeric(14, 2), nullable=False, default=0)
    cash_amount_cop = Column(Numeric(14, 2), nullable=False, default=0)
    payment_method = Column(String(30), nullable=False, default="otro")
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
