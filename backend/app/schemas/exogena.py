"""
Schemas del módulo de Exógena (MVP Sprint 1).
"""
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ExogenaMapeoInput(BaseModel):
    formato: str = Field(min_length=3, max_length=10)
    cuenta_contable: str = Field(min_length=1, max_length=30)
    concepto: str = Field(min_length=1, max_length=20)
    categoria: str = Field(default="", max_length=80)
    saldo_a_reportar: str = Field(default="saldo_final", max_length=30)
    source_rule: str | None = Field(default=None, max_length=255)
    activo: str = Field(default="si", pattern="^(si|no)$")


class ExogenaMapeoOut(ExogenaMapeoInput):
    id: UUID
    tenant_id: UUID
    anio: str
    created_at: datetime
    updated_at: datetime
    updated_by: UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class ExogenaConfigUpsertRequest(BaseModel):
    anio: str = Field(min_length=4, max_length=4)
    uvt_anual: int = Field(ge=0)
    topes_por_formato_json: dict[str, Any] = Field(default_factory=dict)
    version_normativa: str | None = Field(default=None, max_length=50)
    mapeos: list[ExogenaMapeoInput] = Field(default_factory=list)


class ExogenaConfigResponse(BaseModel):
    anio: str
    uvt_anual: int
    topes_por_formato_json: dict[str, Any]
    version_normativa: str | None = None
    updated_at: datetime | None = None
    mapeos: list[ExogenaMapeoOut] = Field(default_factory=list)


class ExogenaValidationItem(BaseModel):
    id: UUID
    tenant_id: UUID
    ejecucion_id: UUID | None = None
    anio: str
    formato: str
    severidad: str
    codigo: str
    mensaje: str
    referencia_origen: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ExogenaValidationRequest(BaseModel):
    anio: str = Field(min_length=4, max_length=4)
    formatos: list[str] = Field(default_factory=list)


class ExogenaValidationSummary(BaseModel):
    anio: str
    formatos: list[str]
    total: int
    total_errors: int
    total_warnings: int
    items: list[ExogenaValidationItem] = Field(default_factory=list)


class ExogenaExportRequest(BaseModel):
    anio: str = Field(min_length=4, max_length=4)
    formato: str = Field(min_length=3, max_length=10)
    include_warnings: bool = True
    modo_exportacion: Literal["consolidado", "detalle"] = "consolidado"


class ExogenaExportOut(BaseModel):
    ok: bool
    ejecucion_id: UUID
    anio: str
    formato: str
    status: str
    total_rows: int
    total_errors: int
    total_warnings: int
    omitidos_rows: int = 0
    archivo_relpath: str | None = None
    archivo_sha256: str | None = None
    error_message: str | None = None
    created_at: datetime


class ExogenaExecutionItem(BaseModel):
    id: UUID
    tenant_id: UUID
    anio: str
    formato: str
    status: str
    total_rows: int
    total_errors: int
    total_warnings: int
    omitidos_rows: int = 0
    omitidos_relpath: str | None = None
    fuente_resumen_json: list[dict[str, Any]] = Field(default_factory=list)
    archivo_relpath: str | None = None
    archivo_sha256: str | None = None
    error_message: str | None = None
    created_at: datetime
    created_by: UUID | None = None

    model_config = ConfigDict(from_attributes=True)

