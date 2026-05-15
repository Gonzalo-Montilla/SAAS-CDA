"""
Registros de provisión de IVA por venta (vehículo cobrado).
"""
from datetime import datetime, timezone, date
import uuid

from sqlalchemy import Column, Date, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class IvaProvisionRegistro(Base):
    __tablename__ = "iva_provision_registros"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    lote_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    vehiculo_id = Column(
        UUID(as_uuid=True),
        ForeignKey("vehiculos_proceso.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,
    )
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    periodo_desde = Column(Date, nullable=False)
    periodo_hasta = Column(Date, nullable=False)
    iva_causado_cop = Column(Numeric(14, 2), nullable=False, default=0)
    provisionado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False, index=True)
    provisionado_en = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
