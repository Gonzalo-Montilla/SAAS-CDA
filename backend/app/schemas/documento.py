"""
Schemas — documentos por tenant
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    sucursal_id: UUID | None = None
    grupo_id: UUID
    version_seq: int
    es_version_actual: bool
    titulo: str
    categoria: str | None = None
    nombre_archivo_original: str
    mime_type: str
    tamano_bytes: int
    preview_pdf_relpath: str | None = None
    created_at: datetime
    created_by: UUID | None
    updated_at: datetime | None = None
    updated_by: UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class DocumentoStorageUsageResponse(BaseModel):
    """Uso de disco del módulo documental del tenant autenticado."""

    used_bytes: int
    quota_bytes: int | None = Field(
        default=None,
        description="None si la cuota efectiva es ilimitada.",
    )
    max_file_bytes: int
    used_pct: float | None = None
    documentos_count: int = 0
    # Override del tenant: null = usa default global; 0 = ilimitado; >0 = MB propios
    documentos_quota_mb: int | None = None
    default_quota_mb: int = Field(
        description="DOCUMENTOS_TENANT_QUOTA_MB del servidor (cuando el tenant no tiene override).",
    )
    quota_source: str = Field(
        description="tenant | default | unlimited",
    )


class DocumentoMetadataUpdate(BaseModel):
    titulo: Optional[str] = Field(default=None, max_length=300)
    categoria: Optional[str] = Field(default=None, max_length=120)
    sucursal_id: Optional[UUID] = None


class DocumentoAuditoriaResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    documento_id: UUID | None
    usuario_id: UUID | None
    usuario_nombre: str | None = None  # usuarios.nombre_completo
    usuario_email: str | None = None
    accion: str
    detalle: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentoAuditoriaPageResponse(BaseModel):
    items: list[DocumentoAuditoriaResponse]
    total: int
    skip: int
    limit: int


class CertificacionCuentaVerificacionResponse(BaseModel):
    tenant_slug: str | None = None
    codigo: str
    valido: bool
    generated_at: datetime | None = None
    documento_id: UUID | None = None
    documento_titulo: str | None = None
    documento_nombre_archivo: str | None = None
    total_documentos_certificados: int | None = None
    hash_incluido: bool | None = None
    sello_electronico: str | None = Field(
        default=None,
        description="Sello del PDF (derivado SHA-256); ausente en certificaciones antiguas.",
    )
    detalle: str | None = None
