"""
Sesión de checkout (ePayco u otro PSP) — intención de pago con monto fijado en servidor.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class TenantBillingCheckoutSession(Base):
    __tablename__ = "tenant_billing_checkout_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_code = Column(String(30), nullable=False)
    sedes_totales = Column(Integer, nullable=False, default=1)
    subtotal_cop = Column(Numeric(14, 2), nullable=False)
    iva_cop = Column(Numeric(14, 2), nullable=False)
    total_cop = Column(Numeric(14, 2), nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    payment_provider = Column(String(30), nullable=True, index=True)
    payment_ref = Column(String(120), nullable=True, index=True)
    epayco_ref = Column(String(120), nullable=True, index=True)
    idempotency_key = Column(String(100), nullable=True, unique=True)
    last_webhook_payload = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), nullable=False)
    completed_at = Column(DateTime, nullable=True)
    # Emisión FE suscripción (Factus emisor SaaS); no bloquea el cobro si falla
    saas_fe_status = Column(String(20), nullable=True)
    saas_fe_error = Column(Text, nullable=True)
