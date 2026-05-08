"""
Métricas de consultas RUNT por proveedor.
"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Numeric, Boolean
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime, timezone
import uuid

from app.db.database import Base


class RuntConsultaMetrica(Base):
    __tablename__ = "runt_consultas_metricas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False, index=True)

    placa_consultada = Column(String(12), nullable=False, index=True)
    document_type = Column(String(10), nullable=True)
    document_number_last4 = Column(String(4), nullable=True)

    provider_configured = Column(String(30), nullable=False)
    provider_resolved = Column(String(30), nullable=False)
    providers_attempted = Column(String(80), nullable=False)
    fallback_used = Column(Boolean, nullable=False, default=False)

    status = Column(String(20), nullable=False, index=True)  # success | empty | error
    encontrado = Column(Boolean, nullable=False, default=False)
    cached = Column(Boolean, nullable=False, default=False)
    error_detail = Column(String(500), nullable=True)

    estimated_cost_cop = Column(Numeric(14, 2), nullable=False, default=0)
    estimated_cost_usd = Column(Numeric(14, 6), nullable=False, default=0)
    fx_rate_usd_cop_applied = Column(Numeric(14, 6), nullable=False, default=0)
    resolved_cost_cop = Column(Numeric(14, 2), nullable=False, default=0)
    resolved_cost_usd = Column(Numeric(14, 6), nullable=False, default=0)
    fallback_extra_cost_cop = Column(Numeric(14, 2), nullable=False, default=0)
    fallback_extra_cost_usd = Column(Numeric(14, 6), nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
