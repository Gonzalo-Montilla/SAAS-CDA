"""Audiencias de campañas WhatsApp.

No sustituye el cron de RTM (30/2/vencido). El gerente dispara el lote.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.rtm_reminder import RTMRenewalReminder
from app.models.vehiculo import EstadoVehiculo, VehiculoProceso
from app.models.whatsapp import TenantWhatsAppEnvio, TenantWhatsAppSettings
from app.services.whatsapp_pack import plantilla_por_evento
from app.utils.whatsapp_phone import normalizar_celular_co

BOGOTA_TZ = ZoneInfo("America/Bogota")
TOPE_ENVIO = 500
OPT_IN_RTM = "contacto_recordatorio_rtm_soat"
OPT_IN_COMERCIAL = "contacto_fuerza_comercial"
TIPOS_NO_RTM = {"preventiva", "pruebas_auditoria"}
COMMERCIAL_EXCLUIDOS = {"agendado", "descartado"}
EVENTOS_MARKETING_CAMPANA = (
    "campana_excel",
    "campana_inactivos",
    "campana_temporada",
    "campana_jornada",
)

# Festivos Colombia 2026-2027 (Ley 2300: no contactar).
_FESTIVOS_CO = {
    (2026, 1, 1), (2026, 1, 12), (2026, 3, 23), (2026, 4, 2), (2026, 4, 3),
    (2026, 5, 1), (2026, 5, 18), (2026, 6, 8), (2026, 6, 15), (2026, 6, 29),
    (2026, 7, 20), (2026, 8, 7), (2026, 8, 17), (2026, 10, 12), (2026, 11, 2),
    (2026, 11, 16), (2026, 12, 8), (2026, 12, 25),
    (2027, 1, 1), (2027, 1, 11), (2027, 3, 22), (2027, 3, 25), (2027, 3, 26),
    (2027, 5, 1), (2027, 5, 17), (2027, 6, 7), (2027, 6, 14), (2027, 7, 5),
    (2027, 7, 20), (2027, 8, 7), (2027, 8, 16), (2027, 10, 18), (2027, 11, 1),
    (2027, 11, 15), (2027, 12, 8), (2027, 12, 25),
}

PLANTILLA_POR_TIPO = {
    "por_vencer": "cdasoft_rtm",
    "inactivos": "cdasoft_campana_inactivos",
    "excel": "cdasoft_campana_jornada",
    "temporada": "cdasoft_campana_jornada",
}


@dataclass
class DestinatarioPreview:
    vehiculo_id: UUID | None
    destino_e164: str
    cliente_nombre: str
    placa: str | None
    opt_in_tipo: str
    motivo: str
    cliente_email: str | None = None


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def ahora_bogota(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(BOGOTA_TZ)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc).astimezone(BOGOTA_TZ)
    return now.astimezone(BOGOTA_TZ)


def es_festivo_colombia(dt_local: datetime) -> bool:
    return (dt_local.year, dt_local.month, dt_local.day) in _FESTIVOS_CO


def ventana_ley_2300(now: datetime | None = None) -> tuple[bool, str | None]:
    """Comercial: lun-sáb 7:00-19:00 Colombia, no domingo ni festivo."""
    local = ahora_bogota(now)
    if local.weekday() == 6:
        return False, "Ley 2300: no se envían campañas en domingo."
    if es_festivo_colombia(local):
        return False, "Ley 2300: no se envían campañas en festivo."
    if local.hour < 7 or local.hour >= 19:
        return False, "Ley 2300: campañas solo entre 7:00 a.m. y 7:00 p.m. (hora Colombia)."
    return True, None


def _email_cliente(raw: Any) -> str | None:
    v = str(raw or "").strip().lower()
    if "@" in v and "." in v.split("@")[-1] and 5 < len(v) <= 254:
        return v
    return None


def autorizo_habeas(valor: Any) -> bool:
    v = str(valor or "").strip().lower()
    v = v.replace("í", "i")
    return v in {"si", "true", "1", "s", "yes"}


def opt_in_formato(extra: Any, clave: str) -> bool:
    if not isinstance(extra, dict):
        return False
    auth = extra.get("autorizaciones_datos") or extra.get("autorizaciones") or {}
    if not isinstance(auth, dict):
        return False
    return autorizo_habeas(auth.get(clave))


def _opt_in_sql(clave: str):
    return VehiculoProceso.recepcion_formato_extra_json["autorizaciones_datos"][clave].astext


def _es_rtm(tipo: str | None) -> bool:
    t = (tipo or "").strip().lower()
    return bool(t) and t not in TIPOS_NO_RTM


def categoria_meta_para(tipo: str) -> str:
    return "utility" if tipo == "por_vencer" else "marketing"


def plantilla_para_tipo(
    row: TenantWhatsAppSettings | None,
    tipo: str,
) -> str:
    pack = plantilla_por_evento(tipo if tipo != "excel" else "campana_temporada")
    default = PLANTILLA_POR_TIPO.get(tipo) or (pack["nombre"] if pack else "cdasoft_campana_temporada")
    if row is None:
        return default
    if tipo == "por_vencer":
        return (getattr(row, "plantilla_rtm", None) or "").strip() or default
    if tipo == "inactivos":
        return (getattr(row, "plantilla_campana_inactivos", None) or "").strip() or default
    jornada = plantilla_por_evento("campana_jornada")
    jornada_nombre = jornada["nombre"] if jornada else "cdasoft_campana_jornada"
    configurada = (getattr(row, "plantilla_campana_temporada", None) or "").strip()
    if configurada == jornada_nombre:
        return configurada
    return jornada_nombre


def canal_campana_listo(row: TenantWhatsAppSettings | None) -> tuple[bool, str | None]:
    if row is None or not bool(row.habilitado):
        return False, "Conecte el WhatsApp del CDA en Organización."
    from app.services.whatsapp_tenant import creds_listas

    if not creds_listas(row):
        return False, "Faltan credenciales de WhatsApp (360dialog o Cloud API)."
    return True, None


def _tipo_vehiculo_ok(valor: str | None, filtro: str | None) -> bool:
    if not filtro:
        return True
    return (valor or "").strip().lower() == filtro.strip().lower()


def _id_sin_movil(correo: str) -> str:
    """Identificador de 20 letras para filas sin celular (no pasa como E.164)."""
    digest = hashlib.sha1(correo.strip().lower().encode("utf-8")).hexdigest()
    trans = str.maketrans("0123456789", "abcdefghij")
    return ("m" + digest.translate(trans))[:20]


def destino_desde_contacto(celular: str | None, correo: str | None) -> str | None:
    e164 = normalizar_celular_co(celular or "")
    if e164:
        return e164
    mail = _email_cliente(correo)
    if mail:
        return _id_sin_movil(mail)
    return None


def _dedupe_destinatarios(items: list[DestinatarioPreview]) -> list[DestinatarioPreview]:
    seen: set[str] = set()
    out: list[DestinatarioPreview] = []
    for item in items:
        movil = normalizar_celular_co(item.destino_e164)
        key = f"m:{movil}" if movil else f"e:{(item.cliente_email or item.destino_e164 or '').lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _celulares_con_rtm_reciente(db: Session, tenant_id: UUID, dias: int = 7) -> set[str]:
    since = utcnow_naive() - timedelta(days=dias)
    rows = (
        db.query(TenantWhatsAppEnvio.destino_e164)
        .filter(
            TenantWhatsAppEnvio.tenant_id == tenant_id,
            TenantWhatsAppEnvio.evento.in_(("rtm", "rtm_vencida")),
            TenantWhatsAppEnvio.estado == "ok",
            TenantWhatsAppEnvio.created_at >= since,
        )
        .all()
    )
    return {str(r[0]) for r in rows if r[0]}


def celulares_marketing_hoy(db: Session, tenant_id: UUID, now: datetime | None = None) -> set[str]:
    """Números a los que ya salió un WhatsApp de campaña (Marketing) hoy, hora Colombia."""
    local = ahora_bogota(now)
    inicio_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_utc = inicio_local.astimezone(timezone.utc).replace(tzinfo=None)
    rows = (
        db.query(TenantWhatsAppEnvio.destino_e164)
        .filter(
            TenantWhatsAppEnvio.tenant_id == tenant_id,
            TenantWhatsAppEnvio.evento.in_(EVENTOS_MARKETING_CAMPANA),
            TenantWhatsAppEnvio.estado == "ok",
            TenantWhatsAppEnvio.created_at >= inicio_utc,
        )
        .all()
    )
    return {str(r[0]) for r in rows if r[0]}


def preview_por_vencer(
    db: Session,
    *,
    tenant_id: UUID,
    sucursal_id: UUID | None,
    tipo_vehiculo: str | None,
    dias_desde: int,
    dias_hasta: int,
    sucursales_permitidas: list[UUID] | None,
) -> tuple[list[DestinatarioPreview], int]:
    now = utcnow_naive()
    if dias_hasta < dias_desde:
        dias_desde, dias_hasta = dias_hasta, dias_desde
    inicio = now + timedelta(days=dias_desde)
    fin = now + timedelta(days=dias_hasta)
    q = (
        db.query(RTMRenewalReminder, VehiculoProceso)
        .join(VehiculoProceso, VehiculoProceso.id == RTMRenewalReminder.vehiculo_id)
        .filter(
            RTMRenewalReminder.tenant_id == tenant_id,
            RTMRenewalReminder.next_due_at >= inicio,
            RTMRenewalReminder.next_due_at <= fin,
            or_(
                RTMRenewalReminder.commercial_status.is_(None),
                RTMRenewalReminder.commercial_status.notin_(tuple(COMMERCIAL_EXCLUIDOS)),
            ),
            _opt_in_sql(OPT_IN_RTM) == "si",
        )
    )
    if sucursal_id is not None:
        q = q.filter(VehiculoProceso.sucursal_id == sucursal_id)
    elif sucursales_permitidas is not None:
        q = q.filter(VehiculoProceso.sucursal_id.in_(sucursales_permitidas))
    if tipo_vehiculo:
        q = q.filter(func.lower(VehiculoProceso.tipo_vehiculo) == tipo_vehiculo.strip().lower())
    rows = q.order_by(RTMRenewalReminder.next_due_at.asc()).all()
    recientes = _celulares_con_rtm_reciente(db, tenant_id)
    omitidos = 0
    dests: list[DestinatarioPreview] = []
    for reminder, vehiculo in rows:
        if not _es_rtm(vehiculo.tipo_vehiculo or reminder.tipo_vehiculo):
            omitidos += 1
            continue
        raw_cel = reminder.cliente_celular or vehiculo.cliente_telefono
        mail = reminder.cliente_email or vehiculo.cliente_email
        e164 = destino_desde_contacto(raw_cel, mail)
        if not e164:
            omitidos += 1
            continue
        movil = normalizar_celular_co(e164)
        if movil and movil in recientes:
            omitidos += 1
            continue
        due = _to_naive_utc(reminder.next_due_at)
        motivo = "RTM por vencer (hueco d15, disparo del gerente)"
        if due:
            motivo = f"RTM vence el {due.date().isoformat()}"
        dests.append(
            DestinatarioPreview(
                vehiculo_id=vehiculo.id,
                destino_e164=e164,
                cliente_nombre=(reminder.cliente_nombre or vehiculo.cliente_nombre or "Cliente").strip() or "Cliente",
                placa=(vehiculo.placa or reminder.placa or "").strip().upper() or None,
                opt_in_tipo=OPT_IN_RTM,
                motivo=motivo,
                cliente_email=_email_cliente(reminder.cliente_email or vehiculo.cliente_email),
            )
        )
    dests = _dedupe_destinatarios(dests)
    return dests, omitidos


def preview_inactivos(
    db: Session,
    *,
    tenant_id: UUID,
    sucursal_id: UUID | None,
    tipo_vehiculo: str | None,
    meses_inactivo: int,
    sucursales_permitidas: list[UUID] | None,
) -> tuple[list[DestinatarioPreview], int]:
    cutoff = utcnow_naive() - relativedelta(months=meses_inactivo)
    filtros = [
        VehiculoProceso.tenant_id == tenant_id,
        VehiculoProceso.fecha_pago.isnot(None),
        VehiculoProceso.estado.in_((EstadoVehiculo.APROBADO, EstadoVehiculo.COMPLETADO)),
        or_(VehiculoProceso.reinspeccion_exenta.is_(False), VehiculoProceso.reinspeccion_exenta.is_(None)),
        func.lower(func.coalesce(VehiculoProceso.tipo_vehiculo, "")).notin_(tuple(TIPOS_NO_RTM)),
        _opt_in_sql(OPT_IN_COMERCIAL) == "si",
    ]
    if sucursal_id is not None:
        filtros.append(VehiculoProceso.sucursal_id == sucursal_id)
    elif sucursales_permitidas is not None:
        filtros.append(VehiculoProceso.sucursal_id.in_(sucursales_permitidas))
    if tipo_vehiculo:
        filtros.append(func.lower(VehiculoProceso.tipo_vehiculo) == tipo_vehiculo.strip().lower())

    ultimas = (
        db.query(
            VehiculoProceso.cliente_telefono,
            func.max(VehiculoProceso.fecha_pago).label("ultima"),
        )
        .filter(*filtros)
        .group_by(VehiculoProceso.cliente_telefono)
        .having(func.max(VehiculoProceso.fecha_pago) < cutoff)
        .all()
    )
    omitidos = 0
    dests: list[DestinatarioPreview] = []
    for telefono, ultima in ultimas:
        e164 = normalizar_celular_co(telefono)
        if not e164:
            omitidos += 1
            continue
        vehiculo = (
            db.query(VehiculoProceso)
            .filter(
                *filtros,
                VehiculoProceso.cliente_telefono == telefono,
                VehiculoProceso.fecha_pago == ultima,
            )
            .order_by(VehiculoProceso.fecha_registro.desc())
            .first()
        )
        if vehiculo is None:
            omitidos += 1
            continue
        ultima_n = _to_naive_utc(ultima)
        motivo = f"Sin visita desde hace {meses_inactivo} meses"
        if ultima_n:
            motivo = f"Última visita {ultima_n.date().isoformat()}"
        dests.append(
            DestinatarioPreview(
                vehiculo_id=vehiculo.id,
                destino_e164=e164,
                cliente_nombre=(vehiculo.cliente_nombre or "Cliente").strip() or "Cliente",
                placa=(vehiculo.placa or "").strip().upper() or None,
                opt_in_tipo=OPT_IN_COMERCIAL,
                motivo=motivo,
                cliente_email=_email_cliente(vehiculo.cliente_email),
            )
        )
    dests = _dedupe_destinatarios(dests)
    return dests, omitidos


def preview_excel(
    filas: list[Any],
) -> tuple[list[DestinatarioPreview], int]:
    omitidos = 0
    dests: list[DestinatarioPreview] = []
    for fila in filas or []:
        nombre = str(getattr(fila, "nombre", None) or (fila.get("nombre") if isinstance(fila, dict) else "") or "").strip()
        celular = getattr(fila, "celular", None) if not isinstance(fila, dict) else fila.get("celular")
        habeas = getattr(fila, "autorizo_habeas", None) if not isinstance(fila, dict) else fila.get("autorizo_habeas")
        correo = getattr(fila, "correo", None) if not isinstance(fila, dict) else fila.get("correo")
        e164 = destino_desde_contacto(str(celular or ""), correo)
        if not nombre or not e164 or not autorizo_habeas(habeas):
            omitidos += 1
            continue
        dests.append(
            DestinatarioPreview(
                vehiculo_id=None,
                destino_e164=e164,
                cliente_nombre=nombre[:200],
                placa=None,
                opt_in_tipo="excel_habeas",
                motivo="Lista Excel con autorización de habeas",
                cliente_email=_email_cliente(correo),
            )
        )
    dests = _dedupe_destinatarios(dests)
    return dests, omitidos


def armar_preview(
    db: Session,
    *,
    tenant_id: UUID,
    filtros: Any,
    sucursales_permitidas: list[UUID] | None,
) -> tuple[list[DestinatarioPreview], int, str, str]:
    tipo = str(getattr(filtros, "tipo", "") or "").strip().lower()
    sucursal_id = getattr(filtros, "sucursal_id", None)
    tipo_vehiculo = (getattr(filtros, "tipo_vehiculo", None) or "").strip() or None
    if tipo_vehiculo and tipo_vehiculo.lower() in TIPOS_NO_RTM:
        raise ValueError("No mezclar preventiva ni auditoría en la misma audiencia de RTM.")
    if tipo == "por_vencer":
        dests, omitidos = preview_por_vencer(
            db,
            tenant_id=tenant_id,
            sucursal_id=sucursal_id,
            tipo_vehiculo=tipo_vehiculo,
            dias_desde=int(getattr(filtros, "dias_desde", 10) or 10),
            dias_hasta=int(getattr(filtros, "dias_hasta", 20) or 20),
            sucursales_permitidas=sucursales_permitidas,
        )
    elif tipo == "inactivos":
        dests, omitidos = preview_inactivos(
            db,
            tenant_id=tenant_id,
            sucursal_id=sucursal_id,
            tipo_vehiculo=tipo_vehiculo,
            meses_inactivo=int(getattr(filtros, "meses_inactivo", 11) or 11),
            sucursales_permitidas=sucursales_permitidas,
        )
    elif tipo in {"excel", "temporada"}:
        dests, omitidos = preview_excel(getattr(filtros, "filas_excel", None) or [])
    else:
        raise ValueError("Tipo de campaña no válido.")
    row = db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == tenant_id).first()
    plantilla = plantilla_para_tipo(row, tipo)
    categoria = categoria_meta_para(tipo)
    return dests, omitidos, plantilla, categoria
