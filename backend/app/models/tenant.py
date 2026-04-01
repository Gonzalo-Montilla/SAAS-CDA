"""
Modelo de Tenant (organización CDA) para baseline SaaS multitenant.
"""
from sqlalchemy import Column, String, Boolean, DateTime, Integer
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
    nit_cda = Column(String(30), unique=True, nullable=True, index=True)
    correo_electronico = Column(String(255), nullable=True)
    nombre_representante = Column(String(200), nullable=True)
    celular = Column(String(30), nullable=True)
    nombre_comercial = Column(String(200), nullable=False, default="CDASOFT")
    logo_url = Column(String(500), nullable=True)
    color_primario = Column(String(20), nullable=False, default="#2563eb")
    color_secundario = Column(String(20), nullable=False, default="#0f172a")
    plan_actual = Column(String(30), nullable=False, default="demo")
    subscription_status = Column(String(30), nullable=False, default="trial")
    sedes_totales = Column(Integer, nullable=False, default=1)
    plan_started_at = Column(DateTime, nullable=True)
    plan_ends_at = Column(DateTime, nullable=True)
    demo_ends_at = Column(DateTime, nullable=True)
    billing_cycle_days = Column(Integer, nullable=False, default=30)
    next_billing_at = Column(DateTime, nullable=True)
    last_payment_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    usuarios = relationship("Usuario", back_populates="tenant")

    def __repr__(self):
        return f"<Tenant {self.slug}>"
