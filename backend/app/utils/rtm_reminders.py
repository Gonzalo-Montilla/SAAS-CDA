"""
Utilidades para recordatorios de próxima RTM.
"""
from datetime import datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.rtm_reminder import RTMRenewalReminder
from app.models.tenant import Tenant
from app.models.vehiculo import VehiculoProceso
from app.utils.email import enviar_email, generar_email_recordatorio_proxima_rtm

REMINDER_MONTHS_AFTER_PAYMENT = 11
REMINDER_HOUR_LOCAL = 9
STATUSES_PROCESSABLE = {"pending", "failed"}


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_naive_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return utcnow_naive()
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _humanize_service(tipo_vehiculo: str) -> str:
    normalized = (tipo_vehiculo or "").strip().lower()
    mapping = {
        "moto": "Revisión técnico-mecánica de moto",
        "liviano_particular": "Revisión técnico-mecánica vehículo liviano particular",
        "liviano_publico": "Revisión técnico-mecánica vehículo liviano público",
        "pesado": "Revisión técnico-mecánica vehículo pesado",
        "preventiva": "Servicio preventiva",
    }
    return mapping.get(normalized, normalized.replace("_", " ").title() or "Revisión técnico-mecánica")


def _format_fecha_es(target_date: datetime) -> str:
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
    return f"{target_date.day} de {months[target_date.month - 1]} de {target_date.year}"


def schedule_rtm_renewal_reminder_for_vehicle(db: Session, vehiculo: VehiculoProceso) -> RTMRenewalReminder | None:
    """
    Crea o actualiza recordatorio de próxima RTM para un vehículo cobrado.
    Deduplica por vehiculo_id.
    """
    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if not cliente_email:
        return None

    paid_at = _to_naive_utc(vehiculo.fecha_pago)
    next_due_at = paid_at + relativedelta(months=REMINDER_MONTHS_AFTER_PAYMENT)
    scheduled_send_at = next_due_at.replace(hour=REMINDER_HOUR_LOCAL, minute=0, second=0, microsecond=0)
    if scheduled_send_at <= utcnow_naive():
        scheduled_send_at = utcnow_naive() + timedelta(minutes=10)

    existing = db.query(RTMRenewalReminder).filter(RTMRenewalReminder.vehiculo_id == vehiculo.id).first()
    if existing:
        existing.placa = (vehiculo.placa or "").strip().upper()
        existing.tipo_vehiculo = (vehiculo.tipo_vehiculo or "").strip().lower()
        existing.cliente_nombre = (vehiculo.cliente_nombre or "").strip() or "Cliente"
        existing.cliente_email = cliente_email
        existing.cliente_celular = (vehiculo.cliente_telefono or "").strip() or None
        existing.last_paid_at = paid_at
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
        last_paid_at=paid_at,
        next_due_at=next_due_at,
        scheduled_send_at=scheduled_send_at,
        status="pending",
        commercial_status="pendiente",
        created_at=utcnow_naive(),
        updated_at=utcnow_naive(),
    )
    db.add(reminder)
    return reminder


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

