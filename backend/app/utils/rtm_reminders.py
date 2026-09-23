"""
Utilidades para recordatorios de próxima RTM y control preventivo.

RTM anual y preventiva no se mezclan.
Secuencia RTM: correo 30/15/8/2/vencido+1; WhatsApp solo 30/2/vencido+1.
Secuencia preventiva: correo y WhatsApp 7/2/vencido+1.
Los 15 y 8 de Calidad siguen siendo lista comercial (llamada), no WhatsApp.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_
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
from app.services.whatsapp_tenant import (
    enlace_agendar_publico,
    enviar_aviso_preventiva,
    enviar_aviso_rtm,
)

REMINDER_MONTHS_AFTER_PAYMENT = 12
REMINDER_DAYS_BEFORE_DUE = 30
PREVENTIVA_REMINDER_MONTHS_AFTER_PAYMENT = 4
PREVENTIVA_REMINDER_DAYS_BEFORE_DUE = 7
REMINDER_HOUR_LOCAL = 9
STATUSES_PROCESSABLE = {"pending", "failed"}
COMMERCIAL_STOP_STATUSES = {"agendado", "descartado"}
OVERDUE_GRACE_DAYS = 14
BOGOTA_TZ = ZoneInfo("America/Bogota")


@dataclass(frozen=True)
class ReminderStep:
    key: str
    days_before: int | None = None
    days_after: int | None = None
    email: bool = True
    whatsapp: bool = False
    vencido: bool = False


RTM_STEPS: tuple[ReminderStep, ...] = (
    ReminderStep("d30", days_before=30, email=True, whatsapp=True),
    ReminderStep("d15", days_before=15, email=True, whatsapp=False),
    ReminderStep("d8", days_before=8, email=True, whatsapp=False),
    ReminderStep("d2", days_before=2, email=True, whatsapp=True),
    ReminderStep("overdue", days_after=1, email=True, whatsapp=True, vencido=True),
)

PREVENTIVA_STEPS: tuple[ReminderStep, ...] = (
    ReminderStep("d7", days_before=7, email=True, whatsapp=True),
    ReminderStep("d2", days_before=2, email=True, whatsapp=True),
    ReminderStep("overdue", days_after=1, email=True, whatsapp=True, vencido=True),
)


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


def steps_for_tipo(tipo_vehiculo: str | None) -> tuple[ReminderStep, ...]:
    return PREVENTIVA_STEPS if _is_preventiva(tipo_vehiculo) else RTM_STEPS


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


def parse_sent_keys(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: list[str] = []
    for part in raw.replace(";", ",").split(","):
        key = part.strip().lower()
        if key and key not in seen:
            seen.append(key)
    return seen


def join_sent_keys(keys: list[str]) -> str | None:
    cleaned = [k.strip().lower() for k in keys if (k or "").strip()]
    return ",".join(cleaned) if cleaned else None


def step_send_at_local(next_due_local: datetime, step: ReminderStep) -> datetime:
    if step.days_after is not None:
        target = next_due_local + timedelta(days=step.days_after)
    else:
        target = next_due_local - timedelta(days=int(step.days_before or 0))
    return target.replace(hour=REMINDER_HOUR_LOCAL, minute=0, second=0, microsecond=0)


def pick_next_step(
    tipo_vehiculo: str | None,
    next_due_at,
    sent_keys,
    now=None,
) -> tuple[ReminderStep | None, datetime | None]:
    """
    Devuelve el siguiente toque automático y su hora UTC naive.
    Omite ventanas ya cerradas (ej. no manda el de 30 días si ya estamos a 8).
    El de vencido+1 solo sale si el vencimiento no tiene más de OVERDUE_GRACE_DAYS.
    """
    now_utc = _to_naive_utc(now or utcnow_naive())
    due_utc = _to_naive_utc(next_due_at)
    now_local = _utc_naive_to_bogota_naive(now_utc)
    due_local = _utc_naive_to_bogota_naive(due_utc)
    sent = {str(k).strip().lower() for k in (sent_keys or []) if str(k).strip()}
    steps = steps_for_tipo(tipo_vehiculo)
    grace_end_local = (due_local + timedelta(days=OVERDUE_GRACE_DAYS)).replace(
        hour=23, minute=59, second=59, microsecond=0
    )

    for index, step in enumerate(steps):
        if step.key in sent:
            continue
        send_local = step_send_at_local(due_local, step)
        later = next((item for item in steps[index + 1 :] if item.key not in sent), None)
        later_local = step_send_at_local(due_local, later) if later else None

        if step.vencido and now_local > grace_end_local:
            return None, None

        if send_local > now_local:
            return step, _bogota_naive_to_utc_naive(send_local)

        if step.vencido:
            return step, now_utc

        if later_local is None or now_local < later_local:
            return step, now_utc

    return None, None


def _contact_email(vehiculo: VehiculoProceso) -> str | None:
    return (vehiculo.cliente_email or "").strip().lower() or None


def _contact_celular(vehiculo: VehiculoProceso) -> str | None:
    return (vehiculo.cliente_telefono or "").strip() or None


def _apply_schedule_fields(
    reminder: RTMRenewalReminder,
    *,
    vehiculo: VehiculoProceso,
    cliente_email: str | None,
    cliente_celular: str | None,
    paid_at_utc: datetime,
    next_due_at: datetime,
    scheduled_send_at: datetime,
) -> None:
    reminder.placa = (vehiculo.placa or "").strip().upper()
    reminder.tipo_vehiculo = (vehiculo.tipo_vehiculo or "").strip().lower()
    reminder.cliente_nombre = (vehiculo.cliente_nombre or "").strip() or "Cliente"
    reminder.cliente_email = cliente_email
    reminder.cliente_celular = cliente_celular
    reminder.last_paid_at = paid_at_utc
    reminder.next_due_at = next_due_at
    reminder.scheduled_send_at = scheduled_send_at
    reminder.status = "pending"
    reminder.auto_steps_sent = None
    reminder.sent_at = None
    reminder.send_error = None
    reminder.updated_at = utcnow_naive()
    if not reminder.commercial_status:
        reminder.commercial_status = "pendiente"


def schedule_rtm_renewal_reminder_for_vehicle(db: Session, vehiculo: VehiculoProceso) -> RTMRenewalReminder | None:
    """
    Crea o actualiza recordatorio de próxima RTM / control preventivo para un vehículo cobrado.
    Deduplica por vehiculo_id. Basta correo o celular.
    """
    tipo_vehiculo = (vehiculo.tipo_vehiculo or "").strip().lower()
    if tipo_vehiculo in {"pruebas_auditoria"}:
        return None
    if bool(getattr(vehiculo, "reinspeccion_exenta", False)):
        return None

    cliente_email = _contact_email(vehiculo)
    cliente_celular = _contact_celular(vehiculo)
    if not cliente_email and not cliente_celular:
        return None

    paid_at_utc = _to_naive_utc(vehiculo.fecha_pago)
    paid_at_local = _utc_naive_to_bogota_naive(paid_at_utc)
    if _is_preventiva(tipo_vehiculo):
        next_due_local = paid_at_local + relativedelta(months=PREVENTIVA_REMINDER_MONTHS_AFTER_PAYMENT)
    else:
        if not _rtm_anual_habilitado_por_cierre(vehiculo):
            return None
        next_due_local = paid_at_local + relativedelta(months=REMINDER_MONTHS_AFTER_PAYMENT)
    next_due_at = _bogota_naive_to_utc_naive(next_due_local)
    step, scheduled_send_at = pick_next_step(tipo_vehiculo, next_due_at, [], utcnow_naive())
    if step is None or scheduled_send_at is None:
        return None
    if scheduled_send_at <= utcnow_naive():
        scheduled_send_at = utcnow_naive() + timedelta(minutes=10)

    existing = db.query(RTMRenewalReminder).filter(RTMRenewalReminder.vehiculo_id == vehiculo.id).first()
    if existing:
        _apply_schedule_fields(
            existing,
            vehiculo=vehiculo,
            cliente_email=cliente_email,
            cliente_celular=cliente_celular,
            paid_at_utc=paid_at_utc,
            next_due_at=next_due_at,
            scheduled_send_at=scheduled_send_at,
        )
        return existing

    reminder = RTMRenewalReminder(
        tenant_id=vehiculo.tenant_id,
        vehiculo_id=vehiculo.id,
        placa=(vehiculo.placa or "").strip().upper(),
        tipo_vehiculo=(vehiculo.tipo_vehiculo or "").strip().lower(),
        cliente_nombre=(vehiculo.cliente_nombre or "").strip() or "Cliente",
        cliente_email=cliente_email,
        cliente_celular=cliente_celular,
        last_paid_at=paid_at_utc,
        next_due_at=next_due_at,
        scheduled_send_at=scheduled_send_at,
        status="pending",
        commercial_status="pendiente",
        auto_steps_sent=None,
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


def _legacy_first_step_key(tipo_vehiculo: str | None) -> str:
    return "d7" if _is_preventiva(tipo_vehiculo) else "d30"


def _sent_keys_for_reminder(reminder: RTMRenewalReminder) -> list[str]:
    keys = parse_sent_keys(getattr(reminder, "auto_steps_sent", None))
    if keys:
        return keys
    if reminder.status == "sent":
        return [_legacy_first_step_key(reminder.tipo_vehiculo)]
    return []


def _stop_commercial(reminder: RTMRenewalReminder) -> bool:
    return (reminder.commercial_status or "").strip().lower() in COMMERCIAL_STOP_STATUSES


def _reopen_sequences_with_remaining_steps(db: Session, *, tenant_id, now: datetime) -> None:
    cutoff = now - timedelta(days=OVERDUE_GRACE_DAYS)
    query = db.query(RTMRenewalReminder).filter(
        RTMRenewalReminder.status == "sent",
        RTMRenewalReminder.next_due_at >= cutoff,
        or_(
            RTMRenewalReminder.auto_steps_sent.is_(None),
            ~RTMRenewalReminder.auto_steps_sent.ilike("%overdue%"),
        ),
    )
    if tenant_id is not None:
        query = query.filter(RTMRenewalReminder.tenant_id == tenant_id)
    for reminder in query.all():
        sent = _sent_keys_for_reminder(reminder)
        step, send_at = pick_next_step(reminder.tipo_vehiculo, reminder.next_due_at, sent, now)
        if step is None or send_at is None:
            continue
        reminder.auto_steps_sent = join_sent_keys(sent)
        reminder.status = "pending"
        reminder.scheduled_send_at = send_at if send_at > now else now
        reminder.updated_at = now


def _mark_step_done(
    reminder: RTMRenewalReminder,
    step: ReminderStep,
    now: datetime,
    *,
    next_send_at: datetime | None,
    sequence_done: bool,
    contacted: bool,
    channel: str | None,
    send_error: str | None,
) -> None:
    sent = _sent_keys_for_reminder(reminder)
    if step.key not in sent:
        sent.append(step.key)
    reminder.auto_steps_sent = join_sent_keys(sent)
    reminder.send_error = send_error
    reminder.updated_at = now
    if sequence_done:
        reminder.status = "sent"
        reminder.sent_at = now
        reminder.scheduled_send_at = now
    else:
        reminder.status = "pending"
        reminder.sent_at = now if contacted else reminder.sent_at
        reminder.scheduled_send_at = next_send_at or (now + timedelta(hours=12))
    if contacted:
        reminder.sent_at = now
        reminder.last_management_at = now
        reminder.last_management_channel = channel
        reminder.management_count = int(reminder.management_count or 0) + 1
        if (reminder.commercial_status or "pendiente") == "pendiente":
            reminder.commercial_status = "contactado"


def _deliver_step(
    db: Session,
    reminder: RTMRenewalReminder,
    step: ReminderStep,
    *,
    tenant: Tenant | None,
    now: datetime,
) -> tuple[bool, bool, bool, str | None]:
    """email_sent, wa_sent, skipped, error"""
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )
    tenant_slug = tenant.slug if tenant and tenant.slug else None
    agendamiento_url = (
        f"{settings.FRONTEND_URL.rstrip('/')}/agendar/{tenant_slug}" if tenant_slug else None
    )
    fecha_sugerida = _format_fecha_es(reminder.next_due_at)
    es_preventiva = _is_preventiva(reminder.tipo_vehiculo)
    etapa = "vencido" if step.vencido else "proximo"
    want_email = bool(step.email and reminder.cliente_email)
    want_wa = bool(step.whatsapp and reminder.cliente_celular)
    if not want_email and not want_wa:
        return False, False, True, None

    if es_preventiva:
        html = generar_email_recordatorio_control_preventivo(
            nombre_cda=nombre_cda,
            nombre_cliente=reminder.cliente_nombre,
            placa=reminder.placa,
            tipo_servicio=_humanize_service(reminder.tipo_vehiculo),
            fecha_sugerida=fecha_sugerida,
            agendamiento_url=agendamiento_url,
            etapa=etapa,
        )
        subject = (
            f"{nombre_cda} - Control preventivo vencido"
            if step.vencido
            else f"{nombre_cda} - Recordatorio de control preventivo"
        )
    else:
        html = generar_email_recordatorio_proxima_rtm(
            nombre_cda=nombre_cda,
            nombre_cliente=reminder.cliente_nombre,
            placa=reminder.placa,
            tipo_servicio=_humanize_service(reminder.tipo_vehiculo),
            fecha_sugerida=fecha_sugerida,
            agendamiento_url=agendamiento_url,
            etapa=etapa,
        )
        subject = (
            f"{nombre_cda} - RTM vencida"
            if step.vencido
            else f"{nombre_cda} - Recordatorio de próxima RTM"
        )

    email_sent = False
    email_error = None
    if want_email:
        try:
            email_sent = bool(enviar_email(reminder.cliente_email, subject, html))
            if not email_sent:
                email_error = "No fue posible enviar email con proveedor SMTP"
        except Exception as exc:
            email_error = str(exc)[:1000]

    wa_sent = False
    if want_wa:
        try:
            wa_kwargs = dict(
                db=db,
                tenant_id=reminder.tenant_id,
                celular=reminder.cliente_celular,
                nombre_cliente=reminder.cliente_nombre or "Cliente",
                nombre_cda=nombre_cda,
                placa=reminder.placa or "",
                fecha_sugerida=fecha_sugerida,
                agendar_url=enlace_agendar_publico(tenant_slug),
                vencida=step.vencido,
            )
            if es_preventiva:
                wa_sent = bool(enviar_aviso_preventiva(**wa_kwargs))
            else:
                wa_sent = bool(enviar_aviso_rtm(**wa_kwargs))
        except Exception as exc:
            print(f"Error WhatsApp recordatorio {reminder.id}: {exc}")

    if email_sent or wa_sent:
        return email_sent, wa_sent, False, None if email_sent else (
            "Enviado por WhatsApp; el correo no salió" if wa_sent else email_error
        )
    return False, False, False, email_error or "No fue posible enviar correo ni WhatsApp"


def process_due_rtm_renewal_reminders(db: Session, *, tenant_id=None, limit: int = 100) -> int:
    now = utcnow_naive()
    _reopen_sequences_with_remaining_steps(db, tenant_id=tenant_id, now=now)
    query = db.query(RTMRenewalReminder).filter(
        RTMRenewalReminder.status.in_(STATUSES_PROCESSABLE),
        or_(
            RTMRenewalReminder.cliente_email.isnot(None),
            RTMRenewalReminder.cliente_celular.isnot(None),
        ),
        RTMRenewalReminder.scheduled_send_at <= now,
    )
    if tenant_id is not None:
        query = query.filter(RTMRenewalReminder.tenant_id == tenant_id)
    reminders = query.order_by(RTMRenewalReminder.scheduled_send_at.asc()).limit(limit).all()
    if not reminders:
        db.commit()
        return 0

    tenant_ids = {reminder.tenant_id for reminder in reminders}
    tenants = db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    tenant_map = {tenant.id: tenant for tenant in tenants}

    sent_count = 0
    for reminder in reminders:
        if _stop_commercial(reminder):
            reminder.status = "sent"
            reminder.updated_at = now
            continue

        sent_keys = _sent_keys_for_reminder(reminder)
        # Si solo inferimos el primer toque por sent_at legado, no lo volvamos a mandar.
        if reminder.auto_steps_sent is None and sent_keys:
            reminder.auto_steps_sent = join_sent_keys(sent_keys)

        tenant = tenant_map.get(reminder.tenant_id)
        for _ in range(len(steps_for_tipo(reminder.tipo_vehiculo))):
            step, send_at = pick_next_step(reminder.tipo_vehiculo, reminder.next_due_at, sent_keys, now)
            if step is None or send_at is None:
                reminder.status = "sent"
                reminder.updated_at = now
                break
            if send_at > now:
                reminder.status = "pending"
                reminder.scheduled_send_at = send_at
                reminder.updated_at = now
                break

            email_sent, wa_sent, skipped, error = _deliver_step(
                db, reminder, step, tenant=tenant, now=now
            )
            remaining_after = [key for key in sent_keys if key != step.key] + [step.key]
            next_step, next_send_at = pick_next_step(
                reminder.tipo_vehiculo, reminder.next_due_at, remaining_after, now
            )
            sequence_done = next_step is None

            if skipped:
                _mark_step_done(
                    reminder,
                    step,
                    now,
                    next_send_at=next_send_at,
                    sequence_done=sequence_done,
                    contacted=False,
                    channel=None,
                    send_error=None,
                )
                sent_keys = remaining_after
                continue

            if email_sent or wa_sent:
                channel = "whatsapp_auto" if wa_sent and not email_sent else "email_auto"
                _mark_step_done(
                    reminder,
                    step,
                    now,
                    next_send_at=next_send_at,
                    sequence_done=sequence_done,
                    contacted=True,
                    channel=channel,
                    send_error=error,
                )
                sent_count += 1
            else:
                reminder.status = "failed"
                reminder.send_error = error or "No fue posible enviar correo ni WhatsApp"
                reminder.updated_at = now
            break

    db.commit()
    return sent_count
