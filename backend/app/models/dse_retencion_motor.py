"""
Parámetros numéricos para retención en documento soporte (UVT por año, tasas por concepto).
El uso en cálculo y payload Factus se conectará en pasos posteriores.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class DseUvtPorAnio(Base):
    """Valor de 1 UVT en pesos para un año fiscal (referencia DIAN)."""

    __tablename__ = "dse_uvt_por_anio"
    __table_args__ = (UniqueConstraint("tenant_id", "anio", name="uq_dse_uvt_tenant_anio"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    anio = Column(Integer, nullable=False, index=True)
    valor_uvt_cop = Column(Numeric(14, 2), nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, onupdate=lambda: datetime.now(timezone.utc))


class DseRetencionTasaConcepto(Base):
    """Tasa de retención en la fuente (%) por concepto y año; null en columna = fila sin configurar."""

    __tablename__ = "dse_retencion_tasas"
    __table_args__ = (
        UniqueConstraint("tenant_id", "anio", "concepto", name="uq_dse_tasa_tenant_anio_concepto"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    anio = Column(Integer, nullable=False, index=True)
    concepto = Column(String(32), nullable=False)
    porcentaje = Column(Numeric(8, 4), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
