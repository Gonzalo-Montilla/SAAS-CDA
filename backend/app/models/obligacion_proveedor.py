"""Obligaciones / facturas de compra por pagar (CxP formal gerencial)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Column, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class ObligacionProveedor(Base):
    __tablename__ = "obligaciones_proveedor"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)

    proveedor_catalogo_id = Column(
        UUID(as_uuid=True),
        ForeignKey("proveedores_catalogo.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    proveedor_nombre = Column(String(300), nullable=False)
    proveedor_documento = Column(String(80), nullable=False)
    proveedor_tipo_documento = Column(String(80), nullable=True)

    numero_documento = Column(String(80), nullable=False)
    fecha_emision = Column(Date, nullable=False)
    fecha_vencimiento = Column(Date, nullable=True)
    concepto = Column(Text, nullable=False)
    notas = Column(Text, nullable=True)

    valor_total = Column(Numeric(14, 2), nullable=False)
    saldo_pendiente = Column(Numeric(14, 2), nullable=False)
    # abierta | parcial | pagada | anulada
    estado = Column(String(20), nullable=False, default="abierta", index=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    proveedor_catalogo = relationship("ProveedorCatalogo", foreign_keys=[proveedor_catalogo_id])
    creador = relationship("Usuario", foreign_keys=[created_by])

    def recalcular_estado(self) -> None:
        if self.estado == "anulada":
            return
        saldo = Decimal(str(self.saldo_pendiente or 0))
        total = Decimal(str(self.valor_total or 0))
        if saldo <= 0:
            self.saldo_pendiente = Decimal("0.00")
            self.estado = "pagada"
        elif saldo < total:
            self.estado = "parcial"
        else:
            self.estado = "abierta"


class ObligacionProveedorPago(Base):
    __tablename__ = "obligaciones_proveedor_pagos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    obligacion_id = Column(
        UUID(as_uuid=True),
        ForeignKey("obligaciones_proveedor.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    monto = Column(Numeric(14, 2), nullable=False)
    fecha_pago = Column(Date, nullable=False, default=date.today)
    notas = Column(Text, nullable=True)
    movimiento_tesoreria_id = Column(
        UUID(as_uuid=True),
        ForeignKey("movimientos_tesoreria.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    obligacion = relationship("ObligacionProveedor", backref="pagos")
