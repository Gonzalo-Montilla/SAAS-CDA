"""
Registro de auditoría del módulo documental (trazabilidad NTC 5385 / buenas prácticas tipo ISO 27002).
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class TenantDocumentoAuditoria(Base):
    __tablename__ = "tenant_documento_auditoria"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    documento_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenant_documentos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True, index=True)
    accion = Column(String(40), nullable=False)
    detalle = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    def __repr__(self):
        return f"<TenantDocumentoAuditoria {self.accion} doc={self.documento_id}>"
