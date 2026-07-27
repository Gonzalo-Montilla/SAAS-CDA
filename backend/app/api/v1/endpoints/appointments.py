"""
Endpoints de agendamiento (público + gestión interna por tenant).
"""
from datetime import datetime, date, time, timedelta, timezone
import hashlib
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, EmailStr, TypeAdapter, field_validator
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timezone_utils import zoneinfo_from_name
from app.core.deps import get_current_user, get_db, get_agendamiento_or_admin
from app.models.appointment import Appointment
from app.models.tarifa import Tarifa
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
    cliente_tipo_documento: Optional[str] = Field(default=None, max_length=10)
    cliente_documento: Optional[str] = Field(default=None, max_length=50)
    cliente_email: str = Field(min_length=5, max_length=255)
    cliente_celular: Optional[str] = Field(default=None, max_length=30)
    placa: str = Field(min_length=5, max_length=10)
    tipo_vehiculo: str = Field(min_length=2, max_length=40)
    ano_modelo: Optional[str] = Field(default=None, max_length=10)
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
            raise ValueError("Correo electrónico es obligatorio.")
        normalized = str(value).strip().lower()
        if not normalized:
            raise ValueError("Correo electrónico es obligatorio.")
        try:
            TypeAdapter(EmailStr).validate_python(normalized)
        except Exception:
            raise ValueError("Ingresa un correo válido.")
        return normalized

    @field_validator("tipo_vehiculo", mode="before")
    @classmethod
    def normalize_tipo_vehiculo(cls, value):
        if value is None:
            return value
        return str(value).strip().lower()

    @field_validator("cliente_tipo_documento", mode="before")
    @classmethod
    def normalize_doc_type(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().upper()
        if not normalized:
            return None
        if normalized not in {"CC", "CE", "PA", "NIT"}:
            raise ValueError("Tipo de documento inválido. Use CC, CE, PA o NIT.")
        return normalized

    @field_validator("cliente_documento", mode="before")
    @classmethod
    def normalize_doc_number(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().upper()
        return normalized or None


class InternalAppointmentCreateRequest(PublicAppointmentCreateRequest):
    source: str = Field(default="manual")


class AppointmentResponse(BaseModel):
    id: str
    cliente_nombre: str
    cliente_tipo_documento: Optional[str] = None
    cliente_documento: Optional[str] = None
    cliente_email: Optional[str] = None
    cliente_celular: Optional[str] = None
    placa: str
    tipo_vehiculo: str
    scheduled_at: datetime
    status: str
    source: str
    notes: Optional[str] = None
    created_at: datetime
    reminder_status: str = "pending"
    reminder_sent_at: Optional[datetime] = None


class AppointmentStatusUpdateRequest(BaseModel):
    """Transiciones permitidas desde la agenda interna."""

    status: Literal["confirmed", "cancelled", "no_show"]


class AppointmentEstimatedRtmResponse(BaseModel):
    disponible: bool
    tipo_vehiculo: str
    ano_modelo: int
    valor_rtm: Optional[float] = None
    valor_terceros: Optional[float] = None
    valor_total: Optional[float] = None
    descripcion_antiguedad: Optional[str] = None
    mensaje: str


def _appointment_to_response(row: Appointment) -> AppointmentResponse:
    return AppointmentResponse(
        id=str(row.id),
        cliente_nombre=row.cliente_nombre,
        cliente_tipo_documento=row.cliente_tipo_documento,
        cliente_documento=row.cliente_documento,
        cliente_email=row.cliente_email,
        cliente_celular=row.cliente_celular,
        placa=row.placa,
        tipo_vehiculo=row.tipo_vehiculo,
        scheduled_at=row.scheduled_at,
        status=row.status,
        source=row.source,
        notes=row.notes,
        created_at=row.created_at,
        reminder_status=row.reminder_status or "pending",
        reminder_sent_at=row.reminder_sent_at,
    )


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def _now_colombia_naive() -> datetime:
    # Validaciones de agenda usando hora operativa local (Colombia).
    tz = zoneinfo_from_name(settings.TIMEZONE)
    return datetime.now(tz).replace(tzinfo=None)


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


def _ensure_slot_allowed(target_date: date, target_time: time) -> datetime:
    scheduled_at = datetime.combine(target_date, target_time).replace(second=0, microsecond=0)
    allowed_slots = _build_slot_datetimes(target_date)
    if scheduled_at not in allowed_slots:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Hora fuera de franjas permitidas. "
                f"Usa intervalos de {SLOT_MINUTES} minutos entre {START_HOUR:02d}:00 y {END_HOUR:02d}:00."
            ),
        )
    return scheduled_at


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
        "pesado_particular": "Revisión técnico-mecánica vehículo pesado particular",
        "pesado_publico": "Revisión técnico-mecánica vehículo pesado público",
        "preventiva": "Servicio preventiva",
        "pruebas_auditoria": "Pruebas de auditoría",
    }
    return mapping.get(normalized, normalized.replace("_", " ").title() or "Revisión técnico-mecánica")


def _format_cop_amount(value: float) -> str:
    try:
        amount = round(float(value))
    except Exception:
        amount = 0
    return f"${amount:,.0f}".replace(",", ".")


def _normalize_tarifa_tipo_vehiculo(tipo_vehiculo: str) -> str:
    raw = (tipo_vehiculo or "").strip().lower()
    aliases = {
        "pesado": "pesado_particular",
    }
    return aliases.get(raw, raw)


def _estimate_tarifa_for_tenant(
    db: Session,
    *,
    tenant_id,
    ano_modelo: int,
    tipo_vehiculo: str,
) -> AppointmentEstimatedRtmResponse:
    tipo_normalizado = _normalize_tarifa_tipo_vehiculo(tipo_vehiculo)
    if tipo_normalizado in {"preventiva", "pruebas_auditoria"}:
        return AppointmentEstimatedRtmResponse(
            disponible=False,
            tipo_vehiculo=tipo_normalizado,
            ano_modelo=ano_modelo,
            mensaje="Este tipo de servicio no usa estimación tarifaria automática.",
        )

    ano_actual = date.today().year
    if ano_modelo < 1950 or ano_modelo > (ano_actual + 1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Año de modelo inválido. Debe estar entre 1950 y {ano_actual + 1}.",
        )

    antiguedad = max(ano_actual - ano_modelo, 0)
    hoy = date.today()
    tarifa = (
        db.query(Tarifa)
        .filter(
            Tarifa.tenant_id == tenant_id,
            Tarifa.activa == True,
            Tarifa.tipo_vehiculo == tipo_normalizado,
            Tarifa.vigencia_inicio <= hoy,
            Tarifa.vigencia_fin >= hoy,
            Tarifa.antiguedad_min <= antiguedad,
            or_(Tarifa.antiguedad_max.is_(None), Tarifa.antiguedad_max >= antiguedad),
        )
        .order_by(Tarifa.vigencia_inicio.desc(), Tarifa.antiguedad_min.desc())
        .first()
    )
    if not tarifa:
        return AppointmentEstimatedRtmResponse(
            disponible=False,
            tipo_vehiculo=tipo_normalizado,
            ano_modelo=ano_modelo,
            mensaje="No hay una tarifa vigente para este tipo de vehículo y año/modelo.",
        )

    if tarifa.antiguedad_max is None:
        descripcion = f"{tarifa.antiguedad_min}+ años"
    elif tarifa.antiguedad_min == tarifa.antiguedad_max:
        descripcion = f"{tarifa.antiguedad_min} año"
    else:
        descripcion = f"{tarifa.antiguedad_min}-{tarifa.antiguedad_max} años"

    return AppointmentEstimatedRtmResponse(
        disponible=True,
        tipo_vehiculo=tipo_normalizado,
        ano_modelo=ano_modelo,
        valor_rtm=float(tarifa.valor_rtm),
        valor_terceros=float(tarifa.valor_terceros),
        valor_total=float(tarifa.valor_total),
        descripcion_antiguedad=descripcion,
        mensaje="Valor estimado informativo según tarifas vigentes del CDA.",
    )


def _get_colombia_timezone():
    return zoneinfo_from_name(settings.TIMEZONE)


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
    db: Session,
    tenant: Tenant,
    *,
    appointment: Appointment,
    cliente_email: str | None,
    cliente_nombre: str,
    scheduled_at: datetime,
    placa: str,
    tipo_vehiculo: str,
    ano_modelo: str | None = None,
) -> None:
    try:
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
        valor_aproximado = None
        raw_ano = (ano_modelo or "").strip()
        if raw_ano:
            try:
                estimated = _estimate_tarifa_for_tenant(
                    db,
                    tenant_id=tenant.id,
                    ano_modelo=int(raw_ano),
                    tipo_vehiculo=tipo_vehiculo,
                )
                if estimated.disponible and estimated.valor_total is not None:
                    valor_aproximado = _format_cop_amount(estimated.valor_total)
            except Exception:
                # El email no debe bloquearse por errores de cálculo informativo.
                valor_aproximado = None
        html = generar_email_confirmacion_cita(
            nombre_cda=nombre_cda,
            nombre_cliente=cliente_nombre,
            fecha_legible=fecha_legible,
            hora_legible=hora_legible,
            placa=placa,
            tipo_servicio=tipo_servicio,
            valor_aproximado=valor_aproximado,
            google_calendar_url=google_calendar_url,
            ics_download_url=ics_download_url,
        )
        asunto = f"{nombre_cda} - Confirmación de cita"
        try:
            enviar_email(cliente_email, asunto, html)
        except Exception:
            # No bloquear agendamiento por fallas SMTP.
            pass
    except Exception:
        # Regla crítica: nunca bloquear creación de cita por generación de correo.
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
    now = _now_colombia_naive()

    response: list[AppointmentSlot] = []
    for slot_dt in slots:
        if slot_dt < now:
            response.append(
                AppointmentSlot(
                    hora=slot_dt.strftime("%H:%M"),
                    disponible=False,
                    cupos_disponibles=0,
                    ocupados=0,
                )
            )
            continue
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
    scheduled_at = _ensure_slot_allowed(target_date, target_time)

    if scheduled_at < _now_colombia_naive():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes agendar en una hora pasada")

    ocupados = _count_slot_occupancy(db, tenant.id, scheduled_at)
    if ocupados >= SLOT_CAPACITY:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este horario ya no tiene cupos disponibles")

    appointment = Appointment(
        tenant_id=tenant.id,
        cliente_nombre=payload.cliente_nombre.strip().upper(),
        cliente_tipo_documento=(payload.cliente_tipo_documento or "").strip().upper() or None,
        cliente_documento=(payload.cliente_documento or "").strip().upper() or None,
        cliente_email=payload.cliente_email.strip().lower(),
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
        db,
        tenant,
        appointment=appointment,
        cliente_email=appointment.cliente_email,
        cliente_nombre=appointment.cliente_nombre,
        scheduled_at=appointment.scheduled_at,
        placa=appointment.placa,
        tipo_vehiculo=appointment.tipo_vehiculo,
        ano_modelo=payload.ano_modelo,
    )
    return _appointment_to_response(appointment)


@router.get("/public/{tenant_slug}/estimated-rtm", response_model=AppointmentEstimatedRtmResponse)
def get_public_estimated_rtm(
    tenant_slug: str,
    ano_modelo: int,
    tipo_vehiculo: str,
    db: Session = Depends(get_db),
):
    tenant = _get_tenant_or_404(db, tenant_slug)
    return _estimate_tarifa_for_tenant(
        db,
        tenant_id=tenant.id,
        ano_modelo=ano_modelo,
        tipo_vehiculo=tipo_vehiculo,
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
    return [_appointment_to_response(row) for row in rows]


@router.get("/estimated-rtm", response_model=AppointmentEstimatedRtmResponse)
def get_internal_estimated_rtm(
    ano_modelo: int,
    tipo_vehiculo: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_agendamiento_or_admin),
):
    return _estimate_tarifa_for_tenant(
        db,
        tenant_id=current_user.tenant_id,
        ano_modelo=ano_modelo,
        tipo_vehiculo=tipo_vehiculo,
    )


@router.post("/internal", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
def create_internal_appointment(
    payload: InternalAppointmentCreateRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_agendamiento_or_admin),
):
    target_date = _parse_date(payload.fecha)
    target_time = _parse_time(payload.hora)
    scheduled_at = _ensure_slot_allowed(target_date, target_time)
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
        cliente_tipo_documento=(payload.cliente_tipo_documento or "").strip().upper() or None,
        cliente_documento=(payload.cliente_documento or "").strip().upper() or None,
        cliente_email=payload.cliente_email.strip().lower(),
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
        db,
        tenant,
        appointment=appointment,
        cliente_email=appointment.cliente_email,
        cliente_nombre=appointment.cliente_nombre,
        scheduled_at=appointment.scheduled_at,
        placa=appointment.placa,
        tipo_vehiculo=appointment.tipo_vehiculo,
        ano_modelo=payload.ano_modelo,
    )
    return _appointment_to_response(appointment)


@router.patch("/{appointment_id}/status", response_model=AppointmentResponse)
def update_appointment_status(
    appointment_id: str,
    payload: AppointmentStatusUpdateRequest,
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

    target = payload.status
    if target == "confirmed":
        if appointment.status != "scheduled":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo se puede confirmar una cita en estado agendada",
            )
        appointment.status = "confirmed"
    elif target == "cancelled":
        if appointment.status not in ("scheduled", "confirmed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo se puede cancelar una cita agendada o confirmada",
            )
        appointment.status = "cancelled"
        appointment.reminder_status = "skipped"
    elif target == "no_show":
        if appointment.status not in ("scheduled", "confirmed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo se puede marcar «no asistió» en citas agendadas o confirmadas",
            )
        appointment.status = "no_show"
        appointment.reminder_status = "skipped"

    appointment.updated_at = _now_naive()
    db.commit()
    db.refresh(appointment)
    return _appointment_to_response(appointment)


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
    if appointment.status not in ("scheduled", "confirmed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede hacer check-in en citas agendadas o confirmadas.",
        )
    appointment.status = "checked_in"
    appointment.reminder_status = "skipped"
    appointment.updated_at = _now_naive()
    db.commit()
    return {
        "success": True,
        "message": "Cita marcada como check-in",
        "prefill": {
            "placa": appointment.placa,
            "tipo_vehiculo": appointment.tipo_vehiculo,
            "cliente_nombre": appointment.cliente_nombre,
            "cliente_tipo_documento": appointment.cliente_tipo_documento,
            "cliente_documento": appointment.cliente_documento,
            "cliente_telefono": appointment.cliente_celular,
            "cliente_email": appointment.cliente_email,
        },
    }

