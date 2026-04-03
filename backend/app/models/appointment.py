"""
Modelo de agendamiento de citas por tenant.
"""
from datetime import datetime, timezone
import uuid
import secrets

from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    cliente_nombre = Column(String(200), nullable=False)
    cliente_email = Column(String(255), nullable=True, index=True)
    cliente_celular = Column(String(30), nullable=True)
    placa = Column(String(10), nullable=False, index=True)
    tipo_vehiculo = Column(String(40), nullable=False)
    scheduled_at = Column(DateTime, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="scheduled", index=True)
    public_token = Column(String(120), nullable=False, unique=True, index=True, default=lambda: secrets.token_urlsafe(24))
    source = Column(String(30), nullable=False, default="public_link")
    notes = Column(Text, nullable=True)
    reminder_scheduled_at = Column(DateTime, nullable=True, index=True)
    reminder_sent_at = Column(DateTime, nullable=True)
    reminder_attempted_at = Column(DateTime, nullable=True)
    reminder_status = Column(String(20), nullable=False, default="pending", index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

