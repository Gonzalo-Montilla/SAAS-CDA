"""
Sucursal (sede operativa) dentro de un tenant CDA.
"""
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from app.db.database import Base


class Sucursal(Base):
    """Sede física u operativa del tenant."""
    __tablename__ = "sucursales"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    nombre = Column(String(200), nullable=False)
    codigo = Column(String(40), nullable=True, index=True)
    activa = Column(Boolean, default=True, nullable=False)
    es_principal = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    tenant = relationship("Tenant", backref="sucursales")

    def __repr__(self):
        return f"<Sucursal {self.nombre}>"
