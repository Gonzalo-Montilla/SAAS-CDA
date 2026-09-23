"""Esquemas de configuración WhatsApp del tenant."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


WhatsAppProveedor = Literal["cloud_api", "dialog360"]


class WhatsAppSettingsOut(BaseModel):
    proveedor: WhatsAppProveedor
    habilitado: bool
    phone_number_id: Optional[str] = None
    waba_id: Optional[str] = None
    access_token_configured: bool
    access_token_hint: Optional[str] = None
    dialog360_api_key_configured: bool
    dialog360_api_key_hint: Optional[str] = None
    display_phone_e164: Optional[str] = None
    avisos_calidad: bool
    plantilla_calidad: Optional[str] = None
    plantilla_calidad_lang: str
    avisos_operativos: bool = True
    plantilla_bienvenida: Optional[str] = None
    plantilla_caja: Optional[str] = None
    plantilla_recibo: Optional[str] = None
    avisos_citas: bool = True
    plantilla_cita: Optional[str] = None
    plantilla_cita_recordatorio: Optional[str] = None
    avisos_vencimientos: bool = True
    plantilla_rtm: Optional[str] = None
    plantilla_preventiva: Optional[str] = None
    plantilla_reinspeccion: Optional[str] = None
    plantilla_aprobacion: Optional[str] = None
    asistente_habilitado: bool = False
    listo_para_enviar: bool
    webhook_url: Optional[str] = None
    last_error: Optional[str] = None
    last_ok_at: Optional[datetime] = None


class WhatsAppSettingsUpdate(BaseModel):
    proveedor: WhatsAppProveedor = "cloud_api"
    habilitado: bool = False
    phone_number_id: Optional[str] = None
    waba_id: Optional[str] = None
    access_token: Optional[str] = Field(default=None, description="Vacío = no cambiar.")
    dialog360_api_key: Optional[str] = Field(default=None, description="Vacío = no cambiar.")
    display_phone_e164: Optional[str] = None
    avisos_calidad: bool = False
    plantilla_calidad: Optional[str] = None
    plantilla_calidad_lang: Optional[str] = "es"
    avisos_operativos: bool = True
    plantilla_bienvenida: Optional[str] = None
    plantilla_caja: Optional[str] = None
    plantilla_recibo: Optional[str] = None
    avisos_citas: bool = True
    plantilla_cita: Optional[str] = None
    plantilla_cita_recordatorio: Optional[str] = None
    avisos_vencimientos: bool = True
    plantilla_rtm: Optional[str] = None
    plantilla_preventiva: Optional[str] = None
    plantilla_reinspeccion: Optional[str] = None
    plantilla_aprobacion: Optional[str] = None
    asistente_habilitado: bool = False


class WhatsAppTestConnectionResult(BaseModel):
    ok: bool
    message: str
    display_phone: Optional[str] = None
    verified_name: Optional[str] = None
    quality_rating: Optional[str] = None


WhatsAppEventoPrueba = Literal[
    "calidad",
    "bienvenida",
    "caja",
    "recibo",
    "cita",
    "cita_recordatorio",
    "rtm",
    "rtm_vencida",
    "preventiva",
    "preventiva_vencida",
    "reinspeccion",
    "aprobado",
]


class WhatsAppTestSendIn(BaseModel):
    celular: str = Field(..., min_length=7, max_length=20)
    evento: WhatsAppEventoPrueba = "calidad"


class WhatsAppTestSendResult(BaseModel):
    ok: bool
    message: str
    destino_e164: Optional[str] = None
    message_id: Optional[str] = None


class WhatsAppPackItem(BaseModel):
    evento: str
    nombre: str
    grupo: str
    variables: int
    ejemplos: list[str]
    cuerpo: str
