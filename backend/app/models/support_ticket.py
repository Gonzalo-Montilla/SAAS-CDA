"""
Modelo de tickets de soporte interno SaaS.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class SaaSSupportTicket(Base):
    __tablename__ = "saas_support_tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(40), nullable=False, default="general", index=True)
    priority = Column(String(20), nullable=False, default="media", index=True)
    status = Column(String(20), nullable=False, default="abierto", index=True)
    assigned_to_saas_user_id = Column(UUID(as_uuid=True), ForeignKey("saas_users.id"), nullable=True)
    created_by_saas_user_id = Column(UUID(as_uuid=True), ForeignKey("saas_users.id"), nullable=True, index=True)
    responded_by_saas_user_id = Column(UUID(as_uuid=True), ForeignKey("saas_users.id"), nullable=True, index=True)
    tenant_response_message = Column(Text, nullable=True)
    tenant_responded_at = Column(DateTime, nullable=True)
    internal_notes = Column(Text, nullable=True)
    sla_due_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

