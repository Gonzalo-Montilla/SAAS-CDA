"""
Endpoints de agendamiento (público + gestión interna por tenant).
"""
from datetime import datetime, date, time, timedelta, timezone
import hashlib
from typing import Optional
from zoneinfo import ZoneInfo
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_db, get_agendamiento_or_admin
from app.models.appointment import Appointment
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.utils.email import (
    enviar_email,
    generar_email_confirmacion_cita,
    generar_email_recordatorio_cita,
)

router = APIRouter()

SLOT_CAPACITY = 4
SLOT_MINUTES = 30
START_HOUR = 8
END_HOUR = 17  # último slot inicia a las 17:00
ACTIVE_STATUSES = {"scheduled", "confirmed"}
REMINDER_HOURS_BEFORE = 3
REMINDER_FALLBACK_MINUTES = 10
MONTHS_ES = [
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


class AppointmentSlot(BaseModel):
    hora: str
    disponible: bool
    cupos_disponibles: int
    ocupados: int


class PublicAppointmentCreateRequest(BaseModel):
    cliente_nombre: str = Field(min_length=3, max_length=200)
    cliente_email: Optional[EmailStr] = None
    cliente_celular: Optional[str] = Field(default=None, max_length=30)
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(min_length=2, max_length=40)
    fecha: str
    hora: str
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("cliente_nombre", "placa", mode="before")
    @classmethod
    def normalize_upper_fields(cls, value):
        if value is None:
            return value
        return str(value).strip().upper()

    @field_validator("cliente_email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().lower()
        return normalized or None

    @field_validator("tipo_vehiculo", mode="before")
    @classmethod
    def normalize_tipo_vehiculo(cls, value):
        if value is None:
            return value
        return str(value).strip().lower()


class InternalAppointmentCreateRequest(PublicAppointmentCreateRequest):
    source: str = Field(default="manual")


class AppointmentResponse(BaseModel):
    id: str
    cliente_nombre: str
    cliente_email: Optional[str] = None
    cliente_celular: Optional[str] = None
    placa: str
    tipo_vehiculo: str
    scheduled_at: datetime
    status: str
    source: str
    notes: Optional[str] = None
    created_at: datetime


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def _now_colombia_naive() -> datetime:
    # Validaciones de agenda usando hora operativa local (Colombia).
    # En algunos entornos Windows no está disponible la base IANA (tzdata).
    try:
        return datetime.now(ZoneInfo(settings.TIMEZONE)).replace(tzinfo=None)
    except Exception:
        colombia_tz = timezone(timedelta(hours=-5))
        return datetime.now(timezone.utc).astimezone(colombia_tz).replace(tzinfo=None)


def _parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fecha inválida. Usa formato YYYY-MM-DD")


def _parse_time(value: str) -> time:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hora inválida. Usa formato HH:MM")


def _build_slot_datetimes(target_date: date) -> list[datetime]:
    slots: list[datetime] = []
    current = datetime.combine(target_date, time(hour=START_HOUR, minute=0))
    end = datetime.combine(target_date, time(hour=END_HOUR, minute=0))
    while current <= end:
        slots.append(current)
        current = current + timedelta(minutes=SLOT_MINUTES)
    return slots


def _get_tenant_or_404(db: Session, tenant_slug: str) -> Tenant:
    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug, Tenant.activo == True).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado o inactivo")
    return tenant


def _count_slot_occupancy(db: Session, tenant_id, slot_dt: datetime) -> int:
    return (
        db.query(func.count(Appointment.id))
        .filter(
            Appointment.tenant_id == tenant_id,
            Appointment.scheduled_at == slot_dt,
            Appointment.status.in_(ACTIVE_STATUSES),
        )
        .scalar()
        or 0
    )


def _format_fecha_es(target_date: date) -> str:
    return f"{target_date.day} de {MONTHS_ES[target_date.month - 1]} de {target_date.year}"


def _humanize_service(tipo_vehiculo: str) -> str:
    normalized = (tipo_vehiculo or "").strip().lower()
    mapping = {
        "moto": "Revisión técnico-mecánica de moto",
        "liviano_particular": "Revisión técnico-mecánica vehículo liviano particular",
        "liviano_publico": "Revisión técnico-mecánica vehículo liviano público",
        "pesado": "Revisión técnico-mecánica vehículo pesado",
    }
    return mapping.get(normalized, normalized.replace("_", " ").title() or "Revisión técnico-mecánica")


def _get_colombia_timezone():
    try:
        return ZoneInfo(settings.TIMEZONE)
    except Exception:
        return timezone(timedelta(hours=-5))


def _colombia_naive_to_utc_aware(colombia_dt: datetime) -> datetime:
    tz_col = _get_colombia_timezone()
    if colombia_dt.tzinfo is None:
        aware_col = colombia_dt.replace(tzinfo=tz_col)
    else:
        aware_col = colombia_dt.astimezone(tz_col)
    return aware_col.astimezone(timezone.utc)


def _build_ics_download_url(token: str) -> str:
    base = settings.BACKEND_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/api/v1/appointments/public/calendar/{token}.ics"


def _build_google_calendar_url(
    *,
    nombre_cda: str,
    placa: str,
    tipo_servicio: str,
    scheduled_at: datetime,
    duration_minutes: int = 60,
) -> str:
    start_utc = _colombia_naive_to_utc_aware(scheduled_at)
    end_utc = start_utc + timedelta(minutes=duration_minutes)
    start_str = start_utc.strftime("%Y%m%dT%H%M%SZ")
    end_str = end_utc.strftime("%Y%m%dT%H%M%SZ")

    title = f"Cita {nombre_cda} - {placa}"
    details = f"Servicio: {tipo_servicio}. Llega unos minutos antes para registro."
    location = nombre_cda
    return (
        "https://calendar.google.com/calendar/render?action=TEMPLATE"
        f"&text={quote(title)}"
        f"&dates={start_str}%2F{end_str}"
        f"&details={quote(details)}"
        f"&location={quote(location)}"
    )


def _build_ics_content(
    *,
    appointment: Appointment,
    nombre_cda: str,
    tipo_servicio: str,
    duration_minutes: int = 60,
) -> str:
    start_utc = _colombia_naive_to_utc_aware(appointment.scheduled_at)
    end_utc = start_utc + timedelta(minutes=duration_minutes)
    created_utc = _colombia_naive_to_utc_aware(appointment.created_at)
    uid = f"{appointment.id}@cdasoft"
    dtstamp = created_utc.strftime("%Y%m%dT%H%M%SZ")
    dtstart = start_utc.strftime("%Y%m%dT%H%M%SZ")
    dtend = end_utc.strftime("%Y%m%dT%H%M%SZ")
    summary = f"Cita {nombre_cda} - {appointment.placa}"
    description = (
        f"Cliente: {appointment.cliente_nombre}\\n"
        f"Placa: {appointment.placa}\\n"
        f"Servicio: {tipo_servicio}\\n"
        "Te recomendamos llegar unos minutos antes."
    )

    return (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//CDASOFT//Agendamiento//ES\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "METHOD:PUBLISH\r\n"
        "BEGIN:VEVENT\r\n"
        f"UID:{uid}\r\n"
        f"DTSTAMP:{dtstamp}\r\n"
        f"DTSTART:{dtstart}\r\n"
        f"DTEND:{dtend}\r\n"
        f"SUMMARY:{summary}\r\n"
        f"DESCRIPTION:{description}\r\n"
        f"LOCATION:{nombre_cda}\r\n"
        "STATUS:CONFIRMED\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )


def _compute_reminder_scheduled_at(scheduled_at: datetime) -> datetime:
    now = _now_colombia_naive()
    target = scheduled_at - timedelta(hours=REMINDER_HOURS_BEFORE)
    if target <= now:
        return now + timedelta(minutes=REMINDER_FALLBACK_MINUTES)
    return target


def _send_appointment_email_notification(
    tenant: Tenant,
    *,
    appointment: Appointment,
    cliente_email: str | None,
    cliente_nombre: str,
    scheduled_at: datetime,
    placa: str,
    tipo_vehiculo: str,
) -> None:
    if not cliente_email:
        return
    fecha_legible = _format_fecha_es(scheduled_at.date())
    hora_legible = scheduled_at.strftime("%H:%M")
    nombre_cda = tenant.nombre_comercial if tenant and tenant.nombre_comercial else tenant.nombre
    tipo_servicio = _humanize_service(tipo_vehiculo)
    google_calendar_url = _build_google_calendar_url(
        nombre_cda=nombre_cda,
        placa=placa,
        tipo_servicio=tipo_servicio,
        scheduled_at=scheduled_at,
    )
    ics_download_url = _build_ics_download_url(appointment.public_token)
    html = generar_email_confirmacion_cita(
        nombre_cda=nombre_cda,
        nombre_cliente=cliente_nombre,
        fecha_legible=fecha_legible,
        hora_legible=hora_legible,
        placa=placa,
        tipo_servicio=tipo_servicio,
        google_calendar_url=google_calendar_url,
        ics_download_url=ics_download_url,
    )
    asunto = f"{nombre_cda} - Confirmación de cita"
    try:
        enviar_email(cliente_email, asunto, html)
    except Exception:
        # No bloquear agendamiento por fallas SMTP.
        pass


def _send_appointment_reminder_notification(
    tenant: Tenant,
    *,
    appointment: Appointment,
) -> bool:
    if not appointment.cliente_email:
        return False

    nombre_cda = tenant.nombre_comercial if tenant and tenant.nombre_comercial else tenant.nombre
    tipo_servicio = _humanize_service(appointment.tipo_vehiculo)
    google_calendar_url = _build_google_calendar_url(
        nombre_cda=nombre_cda,
        placa=appointment.placa,
        tipo_servicio=tipo_servicio,
        scheduled_at=appointment.scheduled_at,
    )
    ics_download_url = _build_ics_download_url(appointment.public_token)

    html = generar_email_recordatorio_cita(
        nombre_cda=nombre_cda,
        nombre_cliente=appointment.cliente_nombre,
        fecha_legible=_format_fecha_es(appointment.scheduled_at.date()),
        hora_legible=appointment.scheduled_at.strftime("%H:%M"),
        placa=appointment.placa,
        tipo_servicio=tipo_servicio,
        google_calendar_url=google_calendar_url,
        ics_download_url=ics_download_url,
    )
    asunto = f"{nombre_cda} - Recordatorio de cita"
    return enviar_email(appointment.cliente_email, asunto, html)


def process_due_appointment_reminders(
    db: Session,
    *,
    tenant_id=None,
    limit: int = 100,
) -> int:
    now = _now_colombia_naive()
    query = db.query(Appointment).filter(
        Appointment.status.in_(ACTIVE_STATUSES),
        Appointment.cliente_email.isnot(None),
        Appointment.reminder_sent_at.is_(None),
        Appointment.reminder_scheduled_at.isnot(None),
        Appointment.reminder_scheduled_at <= now,
        Appointment.scheduled_at > now,
    )
    if tenant_id is not None:
        query = query.filter(Appointment.tenant_id == tenant_id)

    appointments = query.order_by(Appointment.reminder_scheduled_at.asc()).limit(limit).all()
    if not appointments:
        return 0

    tenant_ids = {appt.tenant_id for appt in appointments}
    tenants = db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    tenant_map = {t.id: t for t in tenants}

    sent_count = 0
    for appt in appointments:
        appt.reminder_attempted_at = now
        tenant = tenant_map.get(appt.tenant_id)
        if not tenant:
            appt.reminder_status = "failed"
            continue
        try:
            ok = _send_appointment_reminder_notification(tenant, appointment=appt)
            if ok:
                appt.reminder_sent_at = now
                appt.reminder_status = "sent"
                sent_count += 1
            else:
                appt.reminder_status = "failed"
        except Exception:
            appt.reminder_status = "failed"
        appt.updated_at = now

    db.commit()
    return sent_count


@router.get("/public/{tenant_slug}/availability", response_model=list[AppointmentSlot])
def get_public_availability(
    tenant_slug: str,
    fecha: str,
    db: Session = Depends(get_db),
):
    tenant = _get_tenant_or_404(db, tenant_slug)
    target_date = _parse_date(fecha)
    slots = _build_slot_datetimes(target_date)

    response: list[AppointmentSlot] = []
    for slot_dt in slots:
        ocupados = _count_slot_occupancy(db, tenant.id, slot_dt)
        cupos_disponibles = max(SLOT_CAPACITY - ocupados, 0)
        response.append(
            AppointmentSlot(
                hora=slot_dt.strftime("%H:%M"),
                disponible=cupos_disponibles > 0,
                cupos_disponibles=cupos_disponibles,
                ocupados=ocupados,
            )
        )
    return response


@router.post("/public/{tenant_slug}/book", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
def book_public_appointment(
    tenant_slug: str,
    payload: PublicAppointmentCreateRequest,
    db: Session = Depends(get_db),
):
    tenant = _get_tenant_or_404(db, tenant_slug)
    target_date = _parse_date(payload.fecha)
    target_time = _parse_time(payload.hora)
    scheduled_at = datetime.combine(target_date, target_time).replace(second=0, microsecond=0)

    if scheduled_at < _now_colombia_naive():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes agendar en una hora pasada")

    ocupados = _count_slot_occupancy(db, tenant.id, scheduled_at)
    if ocupados >= SLOT_CAPACITY:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este horario ya no tiene cupos disponibles")

    appointment = Appointment(
        tenant_id=tenant.id,
        cliente_nombre=payload.cliente_nombre.strip().upper(),
        cliente_email=(payload.cliente_email or "").strip().lower() or None,
        cliente_celular=(payload.cliente_celular or "").strip() or None,
        placa=payload.placa.strip().upper(),
        tipo_vehiculo=payload.tipo_vehiculo.strip().lower(),
        scheduled_at=scheduled_at,
        status="scheduled",
        source="public_link",
        notes=(payload.notes or "").strip() or None,
        reminder_scheduled_at=_compute_reminder_scheduled_at(scheduled_at),
        reminder_status="pending",
        created_by_user_id=None,
        created_at=_now_naive(),
        updated_at=_now_naive(),
    )
    db.add(appointment)
    db.commit()
    db.refresh(appointment)
    _send_appointment_email_notification(
        tenant,
        appointment=appointment,
        cliente_email=appointment.cliente_email,
        cliente_nombre=appointment.cliente_nombre,
        scheduled_at=appointment.scheduled_at,
        placa=appointment.placa,
        tipo_vehiculo=appointment.tipo_vehiculo,
    )
    return AppointmentResponse(
        id=str(appointment.id),
        cliente_nombre=appointment.cliente_nombre,
        cliente_email=appointment.cliente_email,
        cliente_celular=appointment.cliente_celular,
        placa=appointment.placa,
        tipo_vehiculo=appointment.tipo_vehiculo,
        scheduled_at=appointment.scheduled_at,
        status=appointment.status,
        source=appointment.source,
        notes=appointment.notes,
        created_at=appointment.created_at,
    )


@router.get("/", response_model=list[AppointmentResponse])
def list_appointments(
    fecha: Optional[str] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_agendamiento_or_admin),
):
    process_due_appointment_reminders(db, tenant_id=current_user.tenant_id, limit=100)
    query = db.query(Appointment).filter(Appointment.tenant_id == current_user.tenant_id)
    if fecha:
        target_date = _parse_date(fecha)
        start_dt = datetime.combine(target_date, time.min)
        end_dt = datetime.combine(target_date, time.max)
        query = query.filter(and_(Appointment.scheduled_at >= start_dt, Appointment.scheduled_at <= end_dt))
    if status_filter:
        query = query.filter(Appointment.status == status_filter.strip().lower())

    rows = query.order_by(Appointment.scheduled_at.asc()).limit(300).all()
    return [
        AppointmentResponse(
            id=str(row.id),
            cliente_nombre=row.cliente_nombre,
            cliente_email=row.cliente_email,
            cliente_celular=row.cliente_celular,
            placa=row.placa,
            tipo_vehiculo=row.tipo_vehiculo,
            scheduled_at=row.scheduled_at,
            status=row.status,
            source=row.source,
            notes=row.notes,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/internal", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
def create_internal_appointment(
    payload: InternalAppointmentCreateRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_agendamiento_or_admin),
):
    target_date = _parse_date(payload.fecha)
    target_time = _parse_time(payload.hora)
    scheduled_at = datetime.combine(target_date, target_time).replace(second=0, microsecond=0)
    if scheduled_at < _now_colombia_naive():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes agendar en una hora pasada")

    ocupados = _count_slot_occupancy(db, current_user.tenant_id, scheduled_at)
    if ocupados >= SLOT_CAPACITY:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este horario ya no tiene cupos disponibles")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    appointment = Appointment(
        tenant_id=current_user.tenant_id,
        cliente_nombre=payload.cliente_nombre.strip().upper(),
        cliente_email=(payload.cliente_email or "").strip().lower() or None,
        cliente_celular=(payload.cliente_celular or "").strip() or None,
        placa=payload.placa.strip().upper(),
        tipo_vehiculo=payload.tipo_vehiculo.strip().lower(),
        scheduled_at=scheduled_at,
        status="scheduled",
        source=(payload.source or "manual").strip().lower(),
        notes=(payload.notes or "").strip() or None,
        reminder_scheduled_at=_compute_reminder_scheduled_at(scheduled_at),
        reminder_status="pending",
        created_by_user_id=current_user.id,
        created_at=_now_naive(),
        updated_at=_now_naive(),
    )
    db.add(appointment)
    db.commit()
    db.refresh(appointment)
    _send_appointment_email_notification(
        tenant,
        appointment=appointment,
        cliente_email=appointment.cliente_email,
        cliente_nombre=appointment.cliente_nombre,
        scheduled_at=appointment.scheduled_at,
        placa=appointment.placa,
        tipo_vehiculo=appointment.tipo_vehiculo,
    )
    return AppointmentResponse(
        id=str(appointment.id),
        cliente_nombre=appointment.cliente_nombre,
        cliente_email=appointment.cliente_email,
        cliente_celular=appointment.cliente_celular,
        placa=appointment.placa,
        tipo_vehiculo=appointment.tipo_vehiculo,
        scheduled_at=appointment.scheduled_at,
        status=appointment.status,
        source=appointment.source,
        notes=appointment.notes,
        created_at=appointment.created_at,
    )


@router.post("/process-reminders")
def process_appointment_reminders(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_agendamiento_or_admin),
):
    processed = process_due_appointment_reminders(db, tenant_id=current_user.tenant_id, limit=200)
    return {"processed": processed}


@router.get("/public/calendar/{token}.ics")
def download_public_calendar_event(token: str, db: Session = Depends(get_db)):
    appointment = (
        db.query(Appointment)
        .filter(Appointment.public_token == token, Appointment.status.in_(ACTIVE_STATUSES))
        .first()
    )
    if not appointment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evento no encontrado")

    tenant = db.query(Tenant).filter(Tenant.id == appointment.tenant_id, Tenant.activo == True).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    nombre_cda = tenant.nombre_comercial if tenant.nombre_comercial else tenant.nombre
    tipo_servicio = _humanize_service(appointment.tipo_vehiculo)
    ics = _build_ics_content(appointment=appointment, nombre_cda=nombre_cda, tipo_servicio=tipo_servicio)
    file_hash = hashlib.md5(str(appointment.id).encode("utf-8")).hexdigest()[:10]
    filename = f"cita-{file_hash}.ics"
    return Response(
        content=ics,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{appointment_id}/check-in")
def check_in_appointment(
    appointment_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_agendamiento_or_admin),
):
    appointment = (
        db.query(Appointment)
        .filter(Appointment.id == appointment_id, Appointment.tenant_id == current_user.tenant_id)
        .first()
    )
    if not appointment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cita no encontrada")
    appointment.status = "checked_in"
    appointment.updated_at = _now_naive()
    db.commit()
    return {
        "success": True,
        "message": "Cita marcada como check-in",
        "prefill": {
            "placa": appointment.placa,
            "tipo_vehiculo": appointment.tipo_vehiculo,
            "cliente_nombre": appointment.cliente_nombre,
            "cliente_telefono": appointment.cliente_celular,
            "cliente_email": appointment.cliente_email,
        },
    }

