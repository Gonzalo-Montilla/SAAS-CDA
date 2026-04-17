"""
Catálogo de proveedores por tenant: datos tributarios y de contacto para documento soporte Factus.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class ProveedorCatalogo(Base):
    """Proveedor frecuente con datos alineados al RUT/DIAN."""

    __tablename__ = "proveedores_catalogo"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    alias = Column(String(120), nullable=True)
    razon_social_rut = Column(String(300), nullable=False)
    tipo_identificacion = Column(String(80), nullable=False)
    numero_identificacion = Column(String(80), nullable=False)
    direccion = Column(Text, nullable=False)
    email = Column(String(255), nullable=False)
    telefono = Column(String(30), nullable=False)
    factus_municipality_id = Column(Integer, nullable=False)

    activo = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, onupdate=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant", backref="proveedores_catalogo")
