"""
Utilidades para recordatorios de próxima RTM y control preventivo.
"""
from datetime import datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.rtm_reminder import RTMRenewalReminder
from app.models.tenant import Tenant
from app.models.vehiculo import VehiculoProceso
from app.utils.email import (
    enviar_email,
    generar_email_recordatorio_control_preventivo,
    generar_email_recordatorio_proxima_rtm,
)

REMINDER_MONTHS_AFTER_PAYMENT = 12
REMINDER_DAYS_BEFORE_DUE = 30
PREVENTIVA_REMINDER_MONTHS_AFTER_PAYMENT = 4
PREVENTIVA_REMINDER_DAYS_BEFORE_DUE = 7
REMINDER_HOUR_LOCAL = 9
STATUSES_PROCESSABLE = {"pending", "failed"}
BOGOTA_TZ = ZoneInfo("America/Bogota")


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_naive_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return utcnow_naive()
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _utc_naive_to_bogota_naive(dt: datetime) -> datetime:
    aware_utc = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    return aware_utc.astimezone(BOGOTA_TZ).replace(tzinfo=None)


def _bogota_naive_to_utc_naive(dt: datetime) -> datetime:
    aware_local = dt.replace(tzinfo=BOGOTA_TZ) if dt.tzinfo is None else dt.astimezone(BOGOTA_TZ)
    return aware_local.astimezone(timezone.utc).replace(tzinfo=None)


def _humanize_service(tipo_vehiculo: str) -> str:
    normalized = (tipo_vehiculo or "").strip().lower()
    mapping = {
        "moto": "Revisión técnico-mecánica de moto",
        "liviano_particular": "Revisión técnico-mecánica vehículo liviano particular",
        "liviano_publico": "Revisión técnico-mecánica vehículo liviano público",
        "pesado": "Revisión técnico-mecánica vehículo pesado",
        "preventiva": "Control preventivo",
    }
    return mapping.get(normalized, normalized.replace("_", " ").title() or "Revisión técnico-mecánica")


def _is_preventiva(tipo_vehiculo: str | None) -> bool:
    return (tipo_vehiculo or "").strip().lower() == "preventiva"


def _format_fecha_es(target_date: datetime) -> str:
    local_dt = _utc_naive_to_bogota_naive(_to_naive_utc(target_date))
    months = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ]
    return f"{local_dt.day} de {months[local_dt.month - 1]} de {local_dt.year}"


def _rtm_anual_habilitado_por_cierre(vehiculo: VehiculoProceso) -> bool:
    resultado = (getattr(vehiculo, "revision_cierre_resultado", "") or "").strip().lower()
    if resultado == "aprobado":
        return True
    estado = getattr(vehiculo, "estado", None)
    estado_str = (estado.value if hasattr(estado, "value") else str(estado or "")).strip().lower()
    return estado_str in {"aprobado", "completado"}


def schedule_rtm_renewal_reminder_for_vehicle(db: Session, vehiculo: VehiculoProceso) -> RTMRenewalReminder | None:
    """
    Crea o actualiza recordatorio de próxima RTM / control preventivo para un vehículo cobrado.
    Deduplica por vehiculo_id.
    """
    tipo_vehiculo = (vehiculo.tipo_vehiculo or "").strip().lower()
    # Excluir flujos operativos que no generan recordatorio comercial.
    if tipo_vehiculo in {"pruebas_auditoria"}:
        return None
    if bool(getattr(vehiculo, "reinspeccion_exenta", False)):
        return None

    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if not cliente_email:
        return None

    paid_at_utc = _to_naive_utc(vehiculo.fecha_pago)
    paid_at_local = _utc_naive_to_bogota_naive(paid_at_utc)
    if _is_preventiva(tipo_vehiculo):
        # Preventiva: control cada 4 meses, recordar una semana antes.
        next_due_local = paid_at_local + relativedelta(months=PREVENTIVA_REMINDER_MONTHS_AFTER_PAYMENT)
        scheduled_send_local = (next_due_local - timedelta(days=PREVENTIVA_REMINDER_DAYS_BEFORE_DUE)).replace(
            hour=REMINDER_HOUR_LOCAL,
            minute=0,
            second=0,
            microsecond=0,
        )
    else:
        # RTM regular: vencimiento anual, recordar 30 días antes.
        if not _rtm_anual_habilitado_por_cierre(vehiculo):
            return None
        next_due_local = paid_at_local + relativedelta(months=REMINDER_MONTHS_AFTER_PAYMENT)
        scheduled_send_local = (next_due_local - timedelta(days=REMINDER_DAYS_BEFORE_DUE)).replace(
            hour=REMINDER_HOUR_LOCAL,
            minute=0,
            second=0,
            microsecond=0,
        )
    next_due_at = _bogota_naive_to_utc_naive(next_due_local)
    scheduled_send_at = _bogota_naive_to_utc_naive(scheduled_send_local)
    if scheduled_send_at <= utcnow_naive():
        scheduled_send_at = utcnow_naive() + timedelta(minutes=10)

    existing = db.query(RTMRenewalReminder).filter(RTMRenewalReminder.vehiculo_id == vehiculo.id).first()
    if existing:
        existing.placa = (vehiculo.placa or "").strip().upper()
        existing.tipo_vehiculo = (vehiculo.tipo_vehiculo or "").strip().lower()
        existing.cliente_nombre = (vehiculo.cliente_nombre or "").strip() or "Cliente"
        existing.cliente_email = cliente_email
        existing.cliente_celular = (vehiculo.cliente_telefono or "").strip() or None
        existing.last_paid_at = paid_at_utc
        existing.next_due_at = next_due_at
        existing.scheduled_send_at = scheduled_send_at
        existing.status = "pending"
        if not existing.commercial_status:
            existing.commercial_status = "pendiente"
        existing.sent_at = None
        existing.send_error = None
        existing.updated_at = utcnow_naive()
        return existing

    reminder = RTMRenewalReminder(
        tenant_id=vehiculo.tenant_id,
        vehiculo_id=vehiculo.id,
        placa=(vehiculo.placa or "").strip().upper(),
        tipo_vehiculo=(vehiculo.tipo_vehiculo or "").strip().lower(),
        cliente_nombre=(vehiculo.cliente_nombre or "").strip() or "Cliente",
        cliente_email=cliente_email,
        cliente_celular=(vehiculo.cliente_telefono or "").strip() or None,
        last_paid_at=paid_at_utc,
        next_due_at=next_due_at,
        scheduled_send_at=scheduled_send_at,
        status="pending",
        commercial_status="pendiente",
        created_at=utcnow_naive(),
        updated_at=utcnow_naive(),
    )
    db.add(reminder)
    return reminder


def disable_rtm_renewal_reminder_for_vehicle(
    db: Session,
    vehiculo: VehiculoProceso,
    *,
    reason: str = "deshabilitado",
) -> RTMRenewalReminder | None:
    row = db.query(RTMRenewalReminder).filter(RTMRenewalReminder.vehiculo_id == vehiculo.id).first()
    if not row:
        return None
    row.status = "cancelled"
    row.send_error = (reason or "deshabilitado")[:1000]
    row.updated_at = utcnow_naive()
    return row


def process_due_rtm_renewal_reminders(db: Session, *, tenant_id=None, limit: int = 100) -> int:
    now = utcnow_naive()
    query = db.query(RTMRenewalReminder).filter(
        RTMRenewalReminder.status.in_(STATUSES_PROCESSABLE),
        RTMRenewalReminder.cliente_email.isnot(None),
        RTMRenewalReminder.sent_at.is_(None),
        RTMRenewalReminder.scheduled_send_at <= now,
    )
    if tenant_id is not None:
        query = query.filter(RTMRenewalReminder.tenant_id == tenant_id)
    reminders = query.order_by(RTMRenewalReminder.scheduled_send_at.asc()).limit(limit).all()
    if not reminders:
        return 0

    tenant_ids = {reminder.tenant_id for reminder in reminders}
    tenants = db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    tenant_map = {tenant.id: tenant for tenant in tenants}

    sent_count = 0
    for reminder in reminders:
        tenant = tenant_map.get(reminder.tenant_id)
        nombre_cda = (
            tenant.nombre_comercial
            if tenant and tenant.nombre_comercial
            else (tenant.nombre if tenant else "CDASOFT")
        )
        tenant_slug = tenant.slug if tenant and tenant.slug else None
        agendamiento_url = (
            f"{settings.FRONTEND_URL.rstrip('/')}/agendar/{tenant_slug}"
            if tenant_slug
            else None
        )
        if _is_preventiva(reminder.tipo_vehiculo):
            html = generar_email_recordatorio_control_preventivo(
                nombre_cda=nombre_cda,
                nombre_cliente=reminder.cliente_nombre,
                placa=reminder.placa,
                tipo_servicio=_humanize_service(reminder.tipo_vehiculo),
                fecha_sugerida=_format_fecha_es(reminder.next_due_at),
                agendamiento_url=agendamiento_url,
            )
            subject = f"{nombre_cda} - Recordatorio de control preventivo"
        else:
            html = generar_email_recordatorio_proxima_rtm(
                nombre_cda=nombre_cda,
                nombre_cliente=reminder.cliente_nombre,
                placa=reminder.placa,
                tipo_servicio=_humanize_service(reminder.tipo_vehiculo),
                fecha_sugerida=_format_fecha_es(reminder.next_due_at),
                agendamiento_url=agendamiento_url,
            )
            subject = f"{nombre_cda} - Recordatorio de próxima RTM"
        try:
            sent = enviar_email(reminder.cliente_email, subject, html)
            if sent:
                reminder.status = "sent"
                reminder.sent_at = now
                reminder.last_management_at = now
                reminder.last_management_channel = "email_auto"
                reminder.management_count = int(reminder.management_count or 0) + 1
                if (reminder.commercial_status or "pendiente") == "pendiente":
                    reminder.commercial_status = "contactado"
                reminder.send_error = None
                sent_count += 1
            else:
                reminder.status = "failed"
                reminder.send_error = "No fue posible enviar email con proveedor SMTP"
        except Exception as exc:
            reminder.status = "failed"
            reminder.send_error = str(exc)[:1000]
        reminder.updated_at = now

    db.commit()
    return sent_count

