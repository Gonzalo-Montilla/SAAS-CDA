"""Envío de campañas por plantilla Meta, con tope y throttle."""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.campana import CampanaWhatsApp, CampanaWhatsAppDestinatario
from app.models.tenant import Tenant
from app.models.whatsapp import TenantWhatsAppSettings
from app.services.campana_audiencias import TOPE_ENVIO, canal_campana_listo, celulares_marketing_hoy, ventana_ley_2300
from app.services.whatsapp_pack import PACK, plantilla_por_evento
from app.services.whatsapp_tenant import (
    _cda,
    _enlace_publico_whatsapp,
    _nombre_param,
    _persona,
    enlace_agendar_publico,
    enviar_plantilla_utilidad,
)
from app.utils.email import (
    cuerpo_texto_predeterminado,
    enviar_email,
    generar_email_campana,
)
from app.utils.nombres import formatear_nombre_comercial
from app.utils.whatsapp_phone import normalizar_celular_co

THROTTLE_SEGUNDOS = 0.12
OMIT_WA_HOY = (
    "Ya se le envió un WhatsApp comercial hoy. Meta suele no entregar el segundo; el correo sí sale."
)


def _estado_correo_envio(dest: object, correo_ok: bool) -> tuple[str, str | None]:
    if correo_ok:
        return "ok", None
    if destinatario_tiene_correo(dest):
        return "fail", "El correo no salió."
    return "no_aplica", None


def _aplicar_canales(
    dest: CampanaWhatsAppDestinatario,
    *,
    wa: str,
    correo: str,
    err_wa: str | None,
    err_correo: str | None,
) -> bool:
    dest.estado_whatsapp = wa
    dest.estado_correo = correo
    dest.error_whatsapp = err_wa
    dest.error_correo = err_correo
    if wa == "ok" or correo == "ok":
        dest.estado = "ok"
        dest.error = None
        return True
    dest.estado = "fail"
    dest.error = err_wa or err_correo
    return False


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _body_params(
    *,
    campana: CampanaWhatsApp,
    dest: CampanaWhatsAppDestinatario,
    nombre_cda: str,
    agendar_url: str,
) -> list[str]:
    if campana.tipo == "por_vencer":
        return [
            _persona(dest.cliente_nombre),
            _cda(nombre_cda),
            _nombre_param(dest.placa, "SIN PLACA"),
            _nombre_param(dest.motivo.replace("RTM vence el ", "") if dest.motivo else None, "próximamente"),
            _enlace_publico_whatsapp(agendar_url),
        ]
    if campana.tipo == "inactivos":
        return [
            _persona(dest.cliente_nombre),
            _cda(nombre_cda),
            _nombre_param(dest.placa, "SIN PLACA"),
        ]
    etiqueta = (campana.etiqueta or "").strip() or "Lo esperamos para su revisión técnico-mecánica."
    if etiqueta[-1:] not in ".!?":
        etiqueta += "."
    return [
        _persona(dest.cliente_nombre),
        _cda(nombre_cda),
        _nombre_param(etiqueta, "Lo esperamos para su revisión técnico-mecánica."),
    ]


def destinatario_tiene_correo(dest: object) -> bool:
    correo = (getattr(dest, "cliente_email", None) or "").strip()
    return bool(correo and "@" in correo)


def destinatario_tiene_movil(dest: object) -> bool:
    return bool(normalizar_celular_co(getattr(dest, "destino_e164", None)))


def campana_puede_enviarse(*, whatsapp_listo: bool, con_correo: int) -> tuple[bool, str | None]:
    """WhatsApp listo, o al menos un destinatario con email si el CDA no tiene API."""
    if whatsapp_listo:
        return True, None
    if con_correo > 0:
        return True, None
    return False, (
        "WhatsApp no está conectado y nadie de la lista tiene correo. "
        "Conecte WhatsApp en Organización o cargue una lista con email."
    )


def resumir_error_whatsapp(raw: str | None) -> str:
    texto = (raw or "").strip()
    if not texto:
        return "Error WhatsApp"
    try:
        data = json.loads(texto)
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            details = (err.get("error_data") or {}).get("details") or err.get("message")
            if details:
                return str(details)[:500]
    except Exception:
        pass
    if "132000" in texto:
        return "La plantilla espera 3 datos (nombre, CDA y jornada) y se enviaron 2. Ya está corregido."
    return texto[:500]


def procesar_envio_campana(db: Session, campana_id: UUID) -> None:
    campana = db.query(CampanaWhatsApp).filter(CampanaWhatsApp.id == campana_id).first()
    if campana is None:
        return
    try:
        _procesar_envio_campana(db, campana)
    except Exception as exc:
        campana.estado = "fallida"
        campana.error = str(exc)[:1000]
        campana.finished_at = utcnow_naive()
        db.commit()
        print(f"[ERROR] campaña {campana_id}: {exc}")


def _procesar_envio_campana(db: Session, campana: CampanaWhatsApp) -> None:
    ok_ventana, motivo_ventana = ventana_ley_2300()
    if not ok_ventana:
        campana.estado = "fallida"
        campana.error = motivo_ventana
        campana.finished_at = utcnow_naive()
        db.commit()
        return
    tenant = db.query(Tenant).filter(Tenant.id == campana.tenant_id).first()
    nombre_cda = formatear_nombre_comercial(
        (tenant.nombre_comercial if tenant else None) or (tenant.nombre if tenant else None),
        "CDA",
    )
    slug = (tenant.slug if tenant else "") or ""
    suffix = (slug.strip() or None) if campana.tipo != "por_vencer" else None
    agendar_url = enlace_agendar_publico(slug)
    evento = f"campana_{campana.tipo}"[:40]
    dests = (
        db.query(CampanaWhatsAppDestinatario)
        .filter(
            CampanaWhatsAppDestinatario.campana_id == campana.id,
            CampanaWhatsAppDestinatario.estado == "pendiente",
        )
        .order_by(CampanaWhatsAppDestinatario.cliente_nombre.asc())
        .limit(TOPE_ENVIO)
        .all()
    )
    settings_row = (
        db.query(TenantWhatsAppSettings)
        .filter(TenantWhatsAppSettings.tenant_id == campana.tenant_id)
        .first()
    )
    whatsapp_listo, _ = canal_campana_listo(settings_row)
    es_marketing = campana.tipo != "por_vencer"
    ya_marketing = celulares_marketing_hoy(db, campana.tenant_id) if es_marketing else set()
    ok_n = int(campana.enviados_ok or 0)
    fail_n = int(campana.enviados_fail or 0)
    for dest in dests:
        movil = normalizar_celular_co(getattr(dest, "destino_e164", None))
        usar_wa = whatsapp_listo and bool(movil)
        omitir_wa = bool(usar_wa and es_marketing and movil in ya_marketing)
        if usar_wa and not omitir_wa:
            params = _body_params(
                campana=campana,
                dest=dest,
                nombre_cda=nombre_cda,
                agendar_url=agendar_url,
            )
            enviado = enviar_plantilla_utilidad(
                db,
                tenant_id=campana.tenant_id,
                destino_raw=dest.destino_e164,
                evento=evento,
                plantilla=campana.plantilla,
                lang="es",
                body_params=params,
                url_button_suffix=suffix,
            )
            if not enviado and suffix:
                enviado = enviar_plantilla_utilidad(
                    db,
                    tenant_id=campana.tenant_id,
                    destino_raw=dest.destino_e164,
                    evento=evento,
                    plantilla=campana.plantilla,
                    lang="es",
                    body_params=params,
                    url_button_suffix=None,
                )
            correo_ok = _enviar_correo_destinatario(
                campana=campana,
                dest=dest,
                nombre_cda=nombre_cda,
                agendar_url=agendar_url,
            )
            mail_estado, mail_err = _estado_correo_envio(dest, correo_ok)
            persona_ok = _aplicar_canales(
                dest,
                wa="ok" if enviado else "fail",
                correo=mail_estado,
                err_wa=None
                if enviado
                else resumir_error_whatsapp(
                    (settings_row.last_error if settings_row else None) or "Error WhatsApp"
                ),
                err_correo=mail_err,
            )
            if enviado and movil:
                ya_marketing.add(movil)
        elif omitir_wa:
            correo_ok = _enviar_correo_destinatario(
                campana=campana,
                dest=dest,
                nombre_cda=nombre_cda,
                agendar_url=agendar_url,
            )
            mail_estado, mail_err = _estado_correo_envio(dest, correo_ok)
            persona_ok = _aplicar_canales(
                dest,
                wa="omitido",
                correo=mail_estado,
                err_wa=OMIT_WA_HOY,
                err_correo=mail_err,
            )
        else:
            correo_ok = _enviar_correo_destinatario(
                campana=campana,
                dest=dest,
                nombre_cda=nombre_cda,
                agendar_url=agendar_url,
            )
            mail_estado, mail_err = _estado_correo_envio(dest, correo_ok)
            if not destinatario_tiene_correo(dest) and not mail_err:
                mail_err = (
                    "Sin correo. Este CDA no tiene WhatsApp conectado."
                    if not whatsapp_listo
                    else "Sin correo y sin celular válido para WhatsApp."
                )
            persona_ok = _aplicar_canales(
                dest,
                wa="no_aplica",
                correo=mail_estado,
                err_wa=None,
                err_correo=mail_err,
            )
        if persona_ok:
            ok_n += 1
        else:
            fail_n += 1
        campana.enviados_ok = ok_n
        campana.enviados_fail = fail_n
        db.commit()
        time.sleep(THROTTLE_SEGUNDOS)
    if ok_n == 0 and fail_n > 0:
        campana.estado = "fallida"
        last_err = next((d.error for d in dests if d.error), None)
        campana.error = (
            resumir_error_whatsapp(last_err or "WhatsApp rechazó el envío.")
            if whatsapp_listo and any(destinatario_tiene_movil(d) for d in dests)
            else (last_err or "El correo no salió.")
        )
    else:
        campana.estado = "enviada"
        if fail_n == 0:
            campana.error = None
    campana.finished_at = utcnow_naive()
    db.commit()


def cuerpo_plantilla_campana(tipo: str, plantilla: str | None = None) -> str:
    if tipo in {"excel", "temporada"}:
        jornada = plantilla_por_evento("campana_jornada")
        if jornada:
            return jornada["cuerpo"]
    nombre = (plantilla or "").strip()
    if nombre:
        for item in PACK:
            if item["nombre"] == nombre:
                return item["cuerpo"]
    evento = {
        "por_vencer": "rtm",
        "inactivos": "campana_inactivos",
        "excel": "campana_jornada",
        "temporada": "campana_jornada",
    }.get(tipo, "campana_jornada")
    pack = plantilla_por_evento(evento)
    if pack:
        return pack["cuerpo"]
    return plantilla or ""


def rellenar_cuerpo_whatsapp(cuerpo: str, params: list[str]) -> str:
    texto = cuerpo or ""
    for i, val in enumerate(params, start=1):
        texto = texto.replace("{{" + str(i) + "}}", val or "")
    return texto


def preview_canales_campana(
    *,
    tipo: str,
    etiqueta: str | None,
    dest: object | None,
    nombre_cda: str,
    agendar_url: str,
    plantilla: str | None = None,
    asunto_libre: str | None = None,
    cuerpo_libre: str | None = None,
) -> tuple[str, str, str, str]:
    """WhatsApp relleno, asunto, HTML y cuerpo plano editable."""
    from types import SimpleNamespace

    cuerpo_wa = cuerpo_plantilla_campana(tipo, plantilla)
    muestra = dest or SimpleNamespace(cliente_nombre="Cliente", placa=None, motivo=etiqueta or "")
    campana = SimpleNamespace(tipo=tipo, etiqueta=etiqueta)
    params = _body_params(
        campana=campana,  # type: ignore[arg-type]
        dest=muestra,  # type: ignore[arg-type]
        nombre_cda=nombre_cda,
        agendar_url=agendar_url,
    )
    whatsapp = rellenar_cuerpo_whatsapp(cuerpo_wa, params)
    asunto_def, cuerpo_def = cuerpo_texto_predeterminado(tipo=tipo, etiqueta=etiqueta)
    asunto_uso = (asunto_libre or "").strip() or asunto_def
    cuerpo_uso = (cuerpo_libre or "").strip() or cuerpo_def
    asunto, html_cuerpo = generar_email_campana(
        nombre_cda=nombre_cda,
        nombre_cliente=getattr(muestra, "cliente_nombre", None) or "Cliente",
        placa=getattr(muestra, "placa", None),
        agendamiento_url=agendar_url,
        tipo=tipo,
        etiqueta=etiqueta,
        motivo=getattr(muestra, "motivo", None),
        asunto_libre=asunto_uso,
        cuerpo_libre=cuerpo_uso,
    )
    return whatsapp, asunto_uso, html_cuerpo, cuerpo_uso


def _enviar_correo_destinatario(
    *,
    campana: CampanaWhatsApp,
    dest: CampanaWhatsAppDestinatario,
    nombre_cda: str,
    agendar_url: str,
) -> bool:
    correo = (getattr(dest, "cliente_email", None) or "").strip()
    if not correo or "@" not in correo:
        return False
    try:
        asunto, html_cuerpo = generar_email_campana(
            nombre_cda=nombre_cda,
            nombre_cliente=dest.cliente_nombre,
            placa=dest.placa,
            agendamiento_url=agendar_url,
            tipo=campana.tipo,
            etiqueta=campana.etiqueta,
            motivo=dest.motivo,
            asunto_libre=getattr(campana, "email_asunto", None),
            cuerpo_libre=getattr(campana, "email_cuerpo", None),
        )
        ok = bool(enviar_email(correo, asunto, html_cuerpo))
        if not ok:
            print(f"[WARN] campaña {campana.id}: correo no salió a {correo}")
        return ok
    except Exception as exc:
        print(f"[WARN] campaña {campana.id}: correo {correo}: {exc}")
        return False
