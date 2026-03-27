"""
Modelo de Tenant (organización CDA) para baseline SaaS multitenant.
"""
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from app.db.database import Base


class Tenant(Base):
    """Tenant/organización del SaaS."""
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(200), nullable=False)
    slug = Column(String(120), unique=True, nullable=False, index=True)
    activo = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    usuarios = relationship("Usuario", back_populates="tenant")

    def __repr__(self):
        return f"<Tenant {self.slug}>"
