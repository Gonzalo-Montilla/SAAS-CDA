"""Esquemas de campañas WhatsApp (Fase D)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


CampanaTipo = Literal["por_vencer", "inactivos", "excel", "temporada"]


class CampanaExcelFilaIn(BaseModel):
    nombre: str = Field(default="", max_length=200)
    celular: str = Field(default="", max_length=40)
    correo: Optional[str] = Field(default=None, max_length=255)
    autorizo_habeas: str = Field(default="", max_length=20)

    @field_validator("nombre", "celular", "autorizo_habeas", "correo", mode="before")
    @classmethod
    def _celda_a_texto(cls, value: Any) -> str | None:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "si" if value else "no"
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        if isinstance(value, int):
            return str(value)
        texto = str(value).strip()
        if texto.endswith(".0") and texto[:-2].isdigit():
            return texto[:-2]
        return texto


class CampanaFiltrosIn(BaseModel):
    tipo: CampanaTipo
    sucursal_id: Optional[UUID] = None
    tipo_vehiculo: Optional[str] = None
    dias_desde: int = Field(default=10, ge=1, le=30)
    dias_hasta: int = Field(default=20, ge=1, le=40)
    meses_inactivo: int = Field(default=11, ge=3, le=36)
    etiqueta: Optional[str] = Field(default=None, max_length=120)
    filas_excel: Optional[list[CampanaExcelFilaIn]] = None
    email_asunto: Optional[str] = Field(default=None, max_length=180)
    email_cuerpo: Optional[str] = Field(default=None, max_length=8000)

    @field_validator("sucursal_id", "tipo_vehiculo", "etiqueta", mode="before")
    @classmethod
    def _vacio_es_none(cls, value: Any) -> Any:
        if value == "" or value is None:
            return None
        return value


class CampanaDestinatarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: Optional[UUID] = None
    vehiculo_id: Optional[UUID] = None
    destino_e164: str
    cliente_nombre: str
    placa: Optional[str] = None
    cliente_email: Optional[str] = None
    opt_in_tipo: str
    motivo: str
    estado: str = "pendiente"
    error: Optional[str] = None
    estado_whatsapp: Optional[str] = None
    estado_correo: Optional[str] = None
    error_whatsapp: Optional[str] = None
    error_correo: Optional[str] = None


class CampanaPreviewOut(BaseModel):
    tipo: CampanaTipo
    categoria_meta: str
    plantilla: str
    plantilla_cuerpo: str = ""
    total: int
    omitidos: int
    tope: int
    destinatarios: list[CampanaDestinatarioOut]
    ventana_ok: bool
    ventana_motivo: Optional[str] = None
    canal_listo: bool
    canal_motivo: Optional[str] = None
    con_correo: int = 0
    whatsapp_hoy: int = 0
    whatsapp_preview: str = ""
    email_asunto: str = ""
    email_html: str = ""
    email_cuerpo: str = ""


class CampanaCrearIn(CampanaFiltrosIn):
    nombre: str = Field(..., min_length=3, max_length=160)


class CampanaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nombre: str
    tipo: str
    etiqueta: Optional[str] = None
    estado: str
    plantilla: str
    categoria_meta: str
    filtros_json: Optional[dict[str, Any]] = None
    texto_propuesto: Optional[str] = None
    email_asunto: Optional[str] = None
    email_cuerpo: Optional[str] = None
    total_destinatarios: int
    enviados_ok: int
    enviados_fail: int
    error: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    destinatarios: list[CampanaDestinatarioOut] = []


class CampanaListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nombre: str
    tipo: str
    etiqueta: Optional[str] = None
    estado: str
    plantilla: str
    categoria_meta: str
    total_destinatarios: int
    enviados_ok: int
    enviados_fail: int
    error: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class CampanaGrokIn(BaseModel):
    tipo: CampanaTipo
    etiqueta: Optional[str] = Field(default=None, max_length=120)
    plantilla_cuerpo: Optional[str] = None


class CampanaGrokOut(BaseModel):
    texto: str
    origen: str = "campana"


class CampanaCorreoGrokIn(BaseModel):
    tipo: CampanaTipo
    etiqueta: Optional[str] = Field(default=None, max_length=120)
    notas: Optional[str] = Field(default=None, max_length=800)
    cuerpo_actual: Optional[str] = Field(default=None, max_length=8000)


class CampanaCorreoGrokOut(BaseModel):
    asunto: str
    cuerpo: str
    origen: str = "campana"


class CampanaCorreoRenderIn(BaseModel):
    tipo: CampanaTipo
    etiqueta: Optional[str] = Field(default=None, max_length=120)
    email_asunto: Optional[str] = Field(default=None, max_length=180)
    email_cuerpo: str = Field(..., min_length=8, max_length=8000)
    nombre_muestra: Optional[str] = Field(default=None, max_length=200)
    placa_muestra: Optional[str] = Field(default=None, max_length=12)
    motivo_muestra: Optional[str] = Field(default=None, max_length=240)


class CampanaCorreoRenderOut(BaseModel):
    email_asunto: str
    email_html: str
    email_cuerpo: str


class CampanaEnviarOut(BaseModel):
    id: UUID
    estado: str
    total_destinatarios: int
    message: str
