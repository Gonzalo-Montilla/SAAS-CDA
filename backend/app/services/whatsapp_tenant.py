"""Lectura/escritura de WhatsApp del tenant y envío de plantillas de utilidad."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.factus_crypto import decrypt_secret, encrypt_secret
from app.integrations.whatsapp_client import (
    WhatsAppApiResult,
    build_template_payload,
    enviar_plantilla_cloud_api,
    enviar_plantilla_dialog360,
    probar_cloud_api,
    probar_dialog360,
)
from app.models.whatsapp import TenantWhatsAppEnvio, TenantWhatsAppSettings
from app.schemas.whatsapp import (
    WhatsAppSettingsOut,
    WhatsAppSettingsUpdate,
    WhatsAppTestConnectionResult,
    WhatsAppTestSendResult,
)
from app.utils.nombres import formatear_nombre_comercial, formatear_nombre_persona
from app.utils.whatsapp_phone import hint_secret, normalizar_celular_co


PLANTILLA_CALIDAD_DEFAULT = "encuesta_calidad"
PLANTILLA_BIENVENIDA_DEFAULT = "cdasoft_bienvenida"
PLANTILLA_CAJA_DEFAULT = "cdasoft_pase_caja"
PLANTILLA_RECIBO_DEFAULT = "cdasoft_recibo"
PLANTILLA_RECIBO_FE_DEFAULT = "cdasoft_recibo_fe"
PLANTILLA_CITA_DEFAULT = "cdasoft_cita_ok"
PLANTILLA_CITA_RECORDATORIO_DEFAULT = "cdasoft_cita_recordatorio"
PLANTILLA_RTM_DEFAULT = "cdasoft_rtm"
PLANTILLA_PREVENTIVA_DEFAULT = "cdasoft_preventiva"
PLANTILLA_REINSPECCION_DEFAULT = "cdasoft_reinspeccion"
PLANTILLA_APROBACION_DEFAULT = "cdasoft_aprobado"


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_or_create_settings_row(db: Session, tenant_id: UUID) -> TenantWhatsAppSettings:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        row = TenantWhatsAppSettings(tenant_id=tenant_id, proveedor="dialog360", habilitado=False)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def creds_listas(row: TenantWhatsAppSettings) -> bool:
    proveedor = (row.proveedor or "cloud_api").strip()
    if proveedor == "dialog360":
        return bool(row.dialog360_api_key_encrypted)
    return bool((row.phone_number_id or "").strip() and row.access_token_encrypted)


def listo_para_calidad(row: TenantWhatsAppSettings) -> bool:
    return bool(
        row.habilitado
        and row.avisos_calidad
        and creds_listas(row)
        and (row.plantilla_calidad or "").strip()
    )


def listo_para_operativo(row: TenantWhatsAppSettings) -> bool:
    return bool(row.habilitado and bool(getattr(row, "avisos_operativos", True)) and creds_listas(row))


def listo_para_citas(row: TenantWhatsAppSettings) -> bool:
    return bool(row.habilitado and bool(getattr(row, "avisos_citas", True)) and creds_listas(row))


def listo_para_vencimientos(row: TenantWhatsAppSettings) -> bool:
    return bool(row.habilitado and bool(getattr(row, "avisos_vencimientos", True)) and creds_listas(row))


def _lang(row: TenantWhatsAppSettings) -> str:
    return (row.plantilla_calidad_lang or "es").strip() or "es"


def _nombre_param(valor: str | None, fallback: str) -> str:
    return (valor or "").strip() or fallback


def _persona(valor: str | None) -> str:
    return formatear_nombre_persona(valor, "Cliente")


def _cda(valor: str | None) -> str:
    return formatear_nombre_comercial(valor, "CDA")


def _plantilla_o_default(valor: str | None, default: str) -> str:
    return (valor or "").strip() or default


def row_to_out(row: TenantWhatsAppSettings) -> WhatsAppSettingsOut:
    token = decrypt_secret(row.access_token_encrypted)
    d360 = decrypt_secret(row.dialog360_api_key_encrypted)
    proveedor = row.proveedor if row.proveedor in ("cloud_api", "dialog360") else "cloud_api"
    return WhatsAppSettingsOut(
        proveedor=proveedor,  # type: ignore[arg-type]
        habilitado=bool(row.habilitado),
        phone_number_id=(row.phone_number_id or "").strip() or None,
        waba_id=(row.waba_id or "").strip() or None,
        access_token_configured=bool(row.access_token_encrypted),
        access_token_hint=hint_secret(token),
        dialog360_api_key_configured=bool(row.dialog360_api_key_encrypted),
        dialog360_api_key_hint=hint_secret(d360),
        display_phone_e164=(row.display_phone_e164 or "").strip() or None,
        avisos_calidad=bool(row.avisos_calidad),
        plantilla_calidad=(row.plantilla_calidad or "").strip() or None,
        plantilla_calidad_lang=_lang(row),
        avisos_operativos=bool(getattr(row, "avisos_operativos", True)),
        plantilla_bienvenida=(getattr(row, "plantilla_bienvenida", None) or "").strip() or None,
        plantilla_caja=(getattr(row, "plantilla_caja", None) or "").strip() or None,
        plantilla_recibo=(getattr(row, "plantilla_recibo", None) or "").strip() or None,
        avisos_citas=bool(getattr(row, "avisos_citas", True)),
        plantilla_cita=(getattr(row, "plantilla_cita", None) or "").strip() or None,
        plantilla_cita_recordatorio=(getattr(row, "plantilla_cita_recordatorio", None) or "").strip() or None,
        avisos_vencimientos=bool(getattr(row, "avisos_vencimientos", True)),
        plantilla_rtm=(getattr(row, "plantilla_rtm", None) or "").strip() or None,
        plantilla_preventiva=(getattr(row, "plantilla_preventiva", None) or "").strip() or None,
        plantilla_reinspeccion=(getattr(row, "plantilla_reinspeccion", None) or "").strip() or None,
        plantilla_aprobacion=(getattr(row, "plantilla_aprobacion", None) or "").strip() or None,
        listo_para_enviar=listo_para_calidad(row)
        or listo_para_operativo(row)
        or listo_para_citas(row)
        or listo_para_vencimientos(row),
        last_error=row.last_error,
        last_ok_at=row.last_ok_at,
    )


def apply_settings_update(db: Session, row: TenantWhatsAppSettings, body: WhatsAppSettingsUpdate) -> None:
    row.proveedor = body.proveedor
    row.habilitado = bool(body.habilitado)
    row.phone_number_id = (body.phone_number_id or "").strip() or None
    row.waba_id = (body.waba_id or "").strip() or None
    row.display_phone_e164 = normalizar_celular_co(body.display_phone_e164) or (
        (body.display_phone_e164 or "").strip() or None
    )
    row.avisos_calidad = bool(body.avisos_calidad)
    plantilla = (body.plantilla_calidad or "").strip() or None
    if row.avisos_calidad and not plantilla:
        plantilla = PLANTILLA_CALIDAD_DEFAULT
    row.plantilla_calidad = plantilla
    row.plantilla_calidad_lang = (body.plantilla_calidad_lang or "es").strip() or "es"
    row.avisos_operativos = bool(body.avisos_operativos)
    bienvenida = (body.plantilla_bienvenida or "").strip() or None
    caja = (body.plantilla_caja or "").strip() or None
    recibo = (body.plantilla_recibo or "").strip() or None
    if row.avisos_operativos:
        bienvenida = bienvenida or PLANTILLA_BIENVENIDA_DEFAULT
        caja = caja or PLANTILLA_CAJA_DEFAULT
        recibo = recibo or PLANTILLA_RECIBO_DEFAULT
    row.plantilla_bienvenida = bienvenida
    row.plantilla_caja = caja
    row.plantilla_recibo = recibo
    row.avisos_citas = bool(body.avisos_citas)
    cita = (body.plantilla_cita or "").strip() or None
    cita_rec = (body.plantilla_cita_recordatorio or "").strip() or None
    if row.avisos_citas:
        cita = cita or PLANTILLA_CITA_DEFAULT
        cita_rec = cita_rec or PLANTILLA_CITA_RECORDATORIO_DEFAULT
    row.plantilla_cita = cita
    row.plantilla_cita_recordatorio = cita_rec
    row.avisos_vencimientos = bool(body.avisos_vencimientos)
    rtm = (body.plantilla_rtm or "").strip() or None
    preventiva = (body.plantilla_preventiva or "").strip() or None
    if row.avisos_vencimientos:
        rtm = rtm or PLANTILLA_RTM_DEFAULT
        preventiva = preventiva or PLANTILLA_PREVENTIVA_DEFAULT
    row.plantilla_rtm = rtm
    row.plantilla_preventiva = preventiva
    reinspeccion = (body.plantilla_reinspeccion or "").strip() or None
    aprobacion = (body.plantilla_aprobacion or "").strip() or None
    if row.avisos_operativos:
        reinspeccion = reinspeccion or PLANTILLA_REINSPECCION_DEFAULT
        aprobacion = aprobacion or PLANTILLA_APROBACION_DEFAULT
    row.plantilla_reinspeccion = reinspeccion
    row.plantilla_aprobacion = aprobacion
    if body.access_token:
        row.access_token_encrypted = encrypt_secret(body.access_token.strip())
    if body.dialog360_api_key:
        row.dialog360_api_key_encrypted = encrypt_secret(body.dialog360_api_key.strip())
    db.commit()
    db.refresh(row)


def run_test_connection(row: TenantWhatsAppSettings) -> WhatsAppTestConnectionResult:
    if not creds_listas(row):
        return WhatsAppTestConnectionResult(
            ok=False,
            message="Faltan credenciales. Cloud API: Phone number ID + token. 360dialog: API key.",
        )
    proveedor = (row.proveedor or "cloud_api").strip()
    if proveedor == "dialog360":
        key = decrypt_secret(row.dialog360_api_key_encrypted)
        if not key:
            return WhatsAppTestConnectionResult(ok=False, message="No se pudo descifrar la API key de 360dialog.")
        result = probar_dialog360(api_key=key)
    else:
        token = decrypt_secret(row.access_token_encrypted)
        pid = (row.phone_number_id or "").strip()
        if not token or not pid:
            return WhatsAppTestConnectionResult(ok=False, message="No se pudieron descifrar las credenciales de Cloud API.")
        result = probar_cloud_api(phone_number_id=pid, access_token=token)
    if result.ok:
        return WhatsAppTestConnectionResult(
            ok=True,
            message="Conexión correcta con el número del CDA.",
            display_phone=result.display_phone,
            verified_name=result.verified_name,
            quality_rating=result.quality_rating,
        )
    return WhatsAppTestConnectionResult(
        ok=False,
        message=result.error or f"Error HTTP {result.status_code}",
    )


def _enviar_con_row(
    row: TenantWhatsAppSettings,
    payload: dict,
) -> WhatsAppApiResult:
    proveedor = (row.proveedor or "cloud_api").strip()
    if proveedor == "dialog360":
        key = decrypt_secret(row.dialog360_api_key_encrypted)
        if not key:
            return WhatsAppApiResult(ok=False, status_code=0, error="API key 360dialog no descifrable")
        return enviar_plantilla_dialog360(api_key=key, payload=payload)
    token = decrypt_secret(row.access_token_encrypted)
    pid = (row.phone_number_id or "").strip()
    if not token or not pid:
        return WhatsAppApiResult(ok=False, status_code=0, error="Token Cloud API no descifrable")
    return enviar_plantilla_cloud_api(phone_number_id=pid, access_token=token, payload=payload)


def _idiomas_alternos(lang: str) -> list[str]:
    """Meta a veces aprueba la plantilla en es_CO y no en es (o al revés)."""
    primario = (lang or "es").strip() or "es"
    vistos: list[str] = []
    for codigo in (primario, "es", "es_CO"):
        if codigo not in vistos:
            vistos.append(codigo)
    return vistos


def _es_error_idioma_plantilla(error: str | None) -> bool:
    texto = (error or "").lower()
    return "132001" in texto or "does not exist in the translation" in texto


def enviar_plantilla_utilidad(
    db: Session,
    *,
    tenant_id: UUID,
    destino_raw: str | None,
    evento: str,
    plantilla: str,
    lang: str,
    body_params: list[str],
) -> bool:
    destino = normalizar_celular_co(destino_raw)
    if not destino:
        return False
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None or not creds_listas(row) or not row.habilitado:
        return False
    nombre = plantilla.strip()
    result = None
    lang_usado = (lang or "es").strip() or "es"
    for codigo in _idiomas_alternos(lang):
        payload = build_template_payload(destino, nombre, codigo, body_params)
        result = _enviar_con_row(row, payload)
        lang_usado = codigo
        if result.ok:
            break
        if not _es_error_idioma_plantilla(result.error):
            break
    assert result is not None
    now = utcnow_naive()
    envio = TenantWhatsAppEnvio(
        tenant_id=tenant_id,
        destino_e164=destino,
        evento=evento,
        plantilla=nombre,
        estado="ok" if result.ok else "fail",
        proveedor_message_id=result.message_id,
        error=None if result.ok else (result.error or "Error WhatsApp")[:1000],
        created_at=now,
    )
    db.add(envio)
    if result.ok:
        row.last_ok_at = now
        row.last_error = None
        if lang_usado != ((lang or "es").strip() or "es"):
            print(f"WhatsApp tenant={tenant_id} evento={evento}: enviada con idioma {lang_usado}")
    else:
        row.last_error = (result.error or "Error WhatsApp")[:1000]
        print(f"Error WhatsApp tenant={tenant_id} evento={evento}: {row.last_error}")
    db.commit()
    return result.ok


def _enlace_publico_whatsapp(survey_link: str) -> str:
    """Meta rechaza localhost/http en variables de plantilla; el celular tampoco abre ese host."""
    link = (survey_link or "").strip()
    if not link:
        return "https://www.cdasoft.com.co/calidad"
    low = link.lower()
    if "localhost" in low or "127.0.0.1" in low:
        token = link.rstrip("/").rsplit("/", 1)[-1]
        if token:
            return f"https://www.cdasoft.com.co/calidad/encuesta/{token}"
        return "https://www.cdasoft.com.co/calidad"
    if link.startswith("http://"):
        return "https://" + link[len("http://") :]
    return link


def enviar_aviso_calidad(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    survey_link: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None or not listo_para_calidad(row):
        if row is not None and row.habilitado and row.avisos_calidad:
            if not (row.plantilla_calidad or "").strip():
                row.last_error = "Falta el nombre de la plantilla Meta (ej. encuesta_calidad). Guárdelo en Organización."
                db.commit()
        return False
    return enviar_plantilla_utilidad(
        db,
        tenant_id=tenant_id,
        destino_raw=celular,
        evento="calidad",
        plantilla=(row.plantilla_calidad or "").strip(),
        lang=_lang(row),
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _enlace_publico_whatsapp(survey_link),
        ],
    )


def _enviar_operativo(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    evento: str,
    plantilla: str,
    body_params: list[str],
    listo=listo_para_operativo,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None or not listo(row):
        return False
    return enviar_plantilla_utilidad(
        db,
        tenant_id=tenant_id,
        destino_raw=celular,
        evento=evento,
        plantilla=plantilla,
        lang=_lang(row),
        body_params=body_params,
    )


def enviar_aviso_bienvenida(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    placa: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_bienvenida", None), PLANTILLA_BIENVENIDA_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="bienvenida",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(placa, "SIN PLACA"),
        ],
    )


def enviar_aviso_caja(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_caja", None), PLANTILLA_CAJA_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="caja",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
        ],
    )


def enviar_aviso_recibo(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    placa: str,
    factura_url: str | None = None,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    raw = (factura_url or "").strip()
    link = _enlace_publico_whatsapp(raw) if raw else ""
    usa_fe = bool(link.lower().startswith("https://"))
    params_recibo = [
        _persona(nombre_cliente),
        _cda(nombre_cda),
        _nombre_param(placa, "SIN PLACA"),
    ]
    if usa_fe:
        ok_fe = _enviar_operativo(
            db,
            tenant_id=tenant_id,
            celular=celular,
            evento="recibo_fe",
            plantilla=PLANTILLA_RECIBO_FE_DEFAULT,
            body_params=[*params_recibo, link],
        )
        if ok_fe:
            return True
        # Meta 132001 / plantilla no Approved: el cliente igual debe recibir el recibo.
    plantilla = _plantilla_o_default(getattr(row, "plantilla_recibo", None), PLANTILLA_RECIBO_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="recibo",
        plantilla=plantilla,
        body_params=params_recibo,
    )


def enlace_agendar_publico(tenant_slug: str | None) -> str:
    from app.core.config import settings

    if not (tenant_slug or "").strip():
        return "https://www.cdasoft.com.co"
    raw = f"{settings.FRONTEND_URL.rstrip('/')}/agendar/{tenant_slug.strip()}"
    return _enlace_publico_whatsapp(raw)


def enviar_aviso_cita(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    fecha: str,
    hora: str,
    placa: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_cita", None), PLANTILLA_CITA_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="cita",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(fecha, "por confirmar"),
            _nombre_param(hora, "por confirmar"),
            _nombre_param(placa, "SIN PLACA"),
        ],
        listo=listo_para_citas,
    )


def enviar_aviso_cita_recordatorio(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    fecha: str,
    hora: str,
    placa: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(
        getattr(row, "plantilla_cita_recordatorio", None), PLANTILLA_CITA_RECORDATORIO_DEFAULT
    )
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="cita_recordatorio",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(fecha, "por confirmar"),
            _nombre_param(hora, "por confirmar"),
            _nombre_param(placa, "SIN PLACA"),
        ],
        listo=listo_para_citas,
    )


def enviar_aviso_rtm(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    placa: str,
    fecha_sugerida: str,
    agendar_url: str | None,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_rtm", None), PLANTILLA_RTM_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="rtm",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(placa, "SIN PLACA"),
            _nombre_param(fecha_sugerida, "próximamente"),
            _enlace_publico_whatsapp(agendar_url or "https://www.cdasoft.com.co"),
        ],
        listo=listo_para_vencimientos,
    )


def enviar_aviso_preventiva(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    placa: str,
    fecha_sugerida: str,
    agendar_url: str | None,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_preventiva", None), PLANTILLA_PREVENTIVA_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="preventiva",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(placa, "SIN PLACA"),
            _nombre_param(fecha_sugerida, "próximamente"),
            _enlace_publico_whatsapp(agendar_url or "https://www.cdasoft.com.co"),
        ],
        listo=listo_para_vencimientos,
    )


def enviar_aviso_reinspeccion(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    placa: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_reinspeccion", None), PLANTILLA_REINSPECCION_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="reinspeccion",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(placa, "SIN PLACA"),
        ],
    )


def enviar_aviso_aprobacion(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    nombre_cliente: str,
    nombre_cda: str,
    placa: str,
) -> bool:
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    if row is None:
        return False
    plantilla = _plantilla_o_default(getattr(row, "plantilla_aprobacion", None), PLANTILLA_APROBACION_DEFAULT)
    return _enviar_operativo(
        db,
        tenant_id=tenant_id,
        celular=celular,
        evento="aprobado",
        plantilla=plantilla,
        body_params=[
            _persona(nombre_cliente),
            _cda(nombre_cda),
            _nombre_param(placa, "SIN PLACA"),
        ],
    )


def enviar_prueba_calidad(
    db: Session,
    *,
    tenant_id: UUID,
    celular: str | None,
    evento: str = "calidad",
) -> WhatsAppTestSendResult:
    from app.models.tenant import Tenant

    destino = normalizar_celular_co(celular)
    if not destino:
        return WhatsAppTestSendResult(ok=False, message="Celular inválido. Use 10 dígitos Colombia, ej. 3001234567.")
    row = get_or_create_settings_row(db, tenant_id)
    if evento == "calidad" and row.avisos_calidad and not (row.plantilla_calidad or "").strip():
        row.plantilla_calidad = PLANTILLA_CALIDAD_DEFAULT
        db.commit()
        db.refresh(row)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    nombre_cda = (
        (tenant.nombre_comercial if tenant and tenant.nombre_comercial else None)
        or (tenant.nombre if tenant else None)
        or "CDA"
    )
    listo_map = {
        "calidad": listo_para_calidad,
        "bienvenida": listo_para_operativo,
        "caja": listo_para_operativo,
        "recibo": listo_para_operativo,
        "reinspeccion": listo_para_operativo,
        "aprobado": listo_para_operativo,
        "cita": listo_para_citas,
        "cita_recordatorio": listo_para_citas,
        "rtm": listo_para_vencimientos,
        "preventiva": listo_para_vencimientos,
    }
    listo_fn = listo_map.get(evento or "calidad", listo_para_operativo)
    if not listo_fn(row):
        return WhatsAppTestSendResult(
            ok=False,
            message="No está listo. Habilite el canal, el aviso correspondiente y la API key.",
            destino_e164=destino,
        )
    slug = tenant.slug if tenant and tenant.slug else "ejemplo"
    agendar = enlace_agendar_publico(slug)
    senders = {
        "calidad": lambda: enviar_aviso_calidad(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            survey_link="https://www.cdasoft.com.co/calidad/encuesta/prueba",
        ),
        "bienvenida": lambda: enviar_aviso_bienvenida(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            placa="ABC123",
        ),
        "caja": lambda: enviar_aviso_caja(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
        ),
        "recibo": lambda: enviar_aviso_recibo(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            placa="ABC123",
            factura_url="https://www.cdasoft.com.co/factura/ejemplo",
        ),
        "cita": lambda: enviar_aviso_cita(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            fecha="23 de septiembre de 2026",
            hora="08:00",
            placa="ABC123",
        ),
        "cita_recordatorio": lambda: enviar_aviso_cita_recordatorio(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            fecha="23 de septiembre de 2026",
            hora="08:00",
            placa="ABC123",
        ),
        "rtm": lambda: enviar_aviso_rtm(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            placa="ABC123",
            fecha_sugerida="15 de noviembre de 2026",
            agendar_url=agendar,
        ),
        "preventiva": lambda: enviar_aviso_preventiva(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            placa="ABC123",
            fecha_sugerida="15 de noviembre de 2026",
            agendar_url=agendar,
        ),
        "reinspeccion": lambda: enviar_aviso_reinspeccion(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            placa="ABC123",
        ),
        "aprobado": lambda: enviar_aviso_aprobacion(
            db,
            tenant_id=tenant_id,
            celular=destino,
            nombre_cliente="Prueba",
            nombre_cda=nombre_cda,
            placa="ABC123",
        ),
    }
    ok = bool(senders.get(evento or "calidad", senders["calidad"])())
    db.refresh(row)
    if ok:
        return WhatsAppTestSendResult(
            ok=True,
            message="Plantilla enviada. Si no llega en 1-2 minutos, revise Activity en 360dialog.",
            destino_e164=destino,
        )
    return WhatsAppTestSendResult(
        ok=False,
        message=(row.last_error or "360dialog rechazó el envío. ¿La plantilla está Approved en Meta?")[:500],
        destino_e164=destino,
    )
