"""Métricas de lecturas Grok de tarjeta de propiedad (pago CDASoft / xAI)."""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class GrokTarjetaMetrica(Base):
    __tablename__ = "grok_tarjeta_lecturas_metricas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True, index=True)

    origen = Column(String(20), nullable=False, default="tarjeta", index=True)  # tarjeta | whatsapp
    placa_consultada = Column(String(12), nullable=True)
    modelo = Column(String(40), nullable=False, default="grok-4.3")
    status = Column(String(20), nullable=False, index=True)  # success | empty | error
    encontrado = Column(Boolean, nullable=False, default=False)
    billed = Column(Boolean, nullable=False, default=True)

    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    estimated_cost_cop = Column(Numeric(14, 2), nullable=False, default=0)
    estimated_cost_usd = Column(Numeric(14, 6), nullable=False, default=0)
    fx_rate_usd_cop_applied = Column(Numeric(14, 6), nullable=False, default=0)
    error_detail = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
