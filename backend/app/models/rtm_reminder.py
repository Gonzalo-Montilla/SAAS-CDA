"""
Recordatorios de próxima RTM por tenant.
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class RTMRenewalReminder(Base):
    __tablename__ = "rtm_renewal_reminders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    vehiculo_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id"), nullable=False, index=True, unique=True)
    placa = Column(String(10), nullable=False, index=True)
    tipo_vehiculo = Column(String(40), nullable=False)
    cliente_nombre = Column(String(200), nullable=False)
    cliente_email = Column(String(255), nullable=True, index=True)
    cliente_celular = Column(String(30), nullable=True)
    last_paid_at = Column(DateTime, nullable=False, index=True)
    next_due_at = Column(DateTime, nullable=False, index=True)
    scheduled_send_at = Column(DateTime, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    commercial_status = Column(String(30), nullable=False, default="pendiente", index=True)
    commercial_notes = Column(Text, nullable=True)
    assigned_to_name = Column(String(200), nullable=True)
    last_management_at = Column(DateTime, nullable=True)
    last_management_channel = Column(String(30), nullable=True)
    management_count = Column(Integer, nullable=False, default=0)
    next_contact_at = Column(DateTime, nullable=True, index=True)
    sent_at = Column(DateTime, nullable=True)
    last_manual_sent_at = Column(DateTime, nullable=True)
    send_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

