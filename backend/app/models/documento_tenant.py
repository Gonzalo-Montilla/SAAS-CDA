"""
Documentos almacenados por tenant (metadatos en BD, binarios en disco privado).
"""
from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, String, BigInteger, DateTime, ForeignKey, Integer, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class TenantDocumento(Base):
    __tablename__ = "tenant_documentos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)

    grupo_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    version_seq = Column(Integer, nullable=False, default=1)
    es_version_actual = Column(Boolean, nullable=False, default=True)

    titulo = Column(String(300), nullable=False)
    categoria = Column(String(120), nullable=True, index=True)
    nombre_archivo_original = Column(String(500), nullable=False)
    mime_type = Column(String(200), nullable=False)
    tamano_bytes = Column(BigInteger, nullable=False)
    storage_relpath = Column(String(800), nullable=False)
    # PDF u otro derivado para vista previa (fase B — conversión servidor); NULL si no aplica
    preview_pdf_relpath = Column(String(800), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"))
    updated_at = Column(DateTime, nullable=True)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    creador = relationship("Usuario", foreign_keys=[created_by])
    editor = relationship("Usuario", foreign_keys=[updated_by])
    sucursal = relationship("Sucursal", foreign_keys=[sucursal_id])

    def __repr__(self):
        return f"<TenantDocumento {self.titulo!r} ({self.mime_type})>"
