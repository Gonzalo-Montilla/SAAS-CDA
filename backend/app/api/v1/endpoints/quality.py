"""
Endpoints de calidad (encuestas de satisfacción por tenant).
"""
from datetime import datetime, timezone, timedelta
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.models.quality import QualitySurveyInvite, QualitySurveyResponse
from app.models.rtm_reminder import RTMRenewalReminder
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.utils.quality import process_due_quality_invites, utcnow_naive
from app.utils.rtm_reminders import process_due_rtm_renewal_reminders
from app.utils.email import enviar_email, generar_email_recordatorio_proxima_rtm

router = APIRouter()


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class QualitySummaryResponse(BaseModel):
    total_invitaciones: int
    total_respondidas: int
    total_pendientes: int
    promedio_general: float
    tasa_respuesta: float


class QualityInviteItem(BaseModel):
    id: str
    cliente_nombre: str
    cliente_email: str | None = None
    cliente_celular: str | None = None
    placa: str
    tipo_vehiculo: str
    status: str
    scheduled_send_at: datetime
    sent_at: datetime | None = None
    responded_at: datetime | None = None
    expires_at: datetime
    atencion_general: int | None = None
    comentario: str | None = None
    created_at: datetime


class QualityInviteDetailResponse(QualityInviteItem):
    atencion_recepcion: int | None = None
    atencion_caja: int | None = None
    sala_espera: int | None = None
    agrado_visita: int | None = None
    cajero_nombre: str | None = None
    recepcionista_nombre: str | None = None


class QualityPublicSurveyInfo(BaseModel):
    token_valid: bool
    already_answered: bool
    expired: bool
    invite_id: str
    nombre_cda: str
    logo_url: str | None = None
    color_primario: str = "#2563eb"
    color_secundario: str = "#0f172a"
    cliente_nombre: str
    placa: str
    tipo_vehiculo: str


class QualityPublicSurveySubmitRequest(BaseModel):
    atencion_recepcion: int = Field(ge=1, le=5)
    atencion_caja: int = Field(ge=1, le=5)
    sala_espera: int = Field(ge=1, le=5)
    agrado_visita: int = Field(ge=1, le=5)
    atencion_general: int = Field(ge=1, le=5)
    comentario: str | None = Field(default=None, max_length=2000)


class RTMReminderItem(BaseModel):
    id: str
    vehiculo_id: str
    cliente_nombre: str
    cliente_email: str | None = None
    cliente_celular: str | None = None
    placa: str
    tipo_vehiculo: str
    next_due_at: datetime
    days_until_due: int
    urgency_window_days: int
    agendamiento_url: str | None = None
    nombre_cda: str | None = None
    status: str
    commercial_status: str
    commercial_notes: str | None = None
    assigned_to_name: str | None = None
    last_management_at: datetime | None = None
    last_management_channel: str | None = None
    management_count: int = 0
    next_contact_at: datetime | None = None
    sent_at: datetime | None = None
    last_manual_sent_at: datetime | None = None
    created_at: datetime


class RTMReminderSummary(BaseModel):
    total_upcoming: int
    due_30d: int
    due_15d: int
    due_8d: int
    no_management: int
    managed_count: int
    agendados: int
    conversion_agendado_pct: float


class RTMReminderCommercialUpdateRequest(BaseModel):
    commercial_status: str = Field(min_length=3, max_length=30)
    commercial_notes: str | None = Field(default=None, max_length=2000)
    assigned_to_name: str | None = Field(default=None, max_length=200)
    next_contact_at: datetime | None = None


class RTMReminderManualSendResponse(BaseModel):
    sent: bool
    message: str


class RTMReminderTouchManagementRequest(BaseModel):
    channel: str = Field(min_length=3, max_length=30)
    auto_status: str | None = Field(default=None, max_length=30)


def _invite_to_item(invite: QualitySurveyInvite, response: QualitySurveyResponse | None) -> QualityInviteItem:
    return QualityInviteItem(
        id=str(invite.id),
        cliente_nombre=invite.cliente_nombre,
        cliente_email=invite.cliente_email,
        cliente_celular=invite.cliente_celular,
        placa=invite.placa,
        tipo_vehiculo=invite.tipo_vehiculo,
        status=invite.status,
        scheduled_send_at=invite.scheduled_send_at,
        sent_at=invite.sent_at,
        responded_at=invite.responded_at,
        expires_at=invite.expires_at,
        atencion_general=response.atencion_general if response else None,
        comentario=response.comentario if response else None,
        created_at=invite.created_at,
    )


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


def _resolve_urgency_window(days_until_due: int) -> int:
    if days_until_due <= 8:
        return 8
    if days_until_due <= 15:
        return 15
    return 30


def _to_rtm_item(
    reminder: RTMRenewalReminder,
    now: datetime,
    agendamiento_url: str | None = None,
    nombre_cda: str | None = None,
) -> RTMReminderItem:
    days_until_due = (reminder.next_due_at.date() - now.date()).days
    return RTMReminderItem(
        id=str(reminder.id),
        vehiculo_id=str(reminder.vehiculo_id),
        cliente_nombre=reminder.cliente_nombre,
        cliente_email=reminder.cliente_email,
        cliente_celular=reminder.cliente_celular,
        placa=reminder.placa,
        tipo_vehiculo=reminder.tipo_vehiculo,
        next_due_at=reminder.next_due_at,
        days_until_due=days_until_due,
        urgency_window_days=_resolve_urgency_window(days_until_due),
        agendamiento_url=agendamiento_url,
        nombre_cda=nombre_cda,
        status=reminder.status,
        commercial_status=reminder.commercial_status or "pendiente",
        commercial_notes=reminder.commercial_notes,
        assigned_to_name=reminder.assigned_to_name,
        last_management_at=reminder.last_management_at,
        last_management_channel=reminder.last_management_channel,
        management_count=reminder.management_count or 0,
        next_contact_at=reminder.next_contact_at,
        sent_at=reminder.sent_at,
        last_manual_sent_at=reminder.last_manual_sent_at,
        created_at=reminder.created_at,
    )


@router.post("/process-pending")
def process_pending_quality_invites(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    # Acción manual del módulo Calidad: forzar envío inmediato de pendientes.
    sent = process_due_quality_invites(db, tenant_id=current_user.tenant_id, limit=100, force_send=True)
    return {"processed": sent}


@router.get("/summary", response_model=QualitySummaryResponse)
def get_quality_summary(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    process_due_quality_invites(db, tenant_id=current_user.tenant_id, limit=100)

    invites = (
        db.query(QualitySurveyInvite)
        .filter(QualitySurveyInvite.tenant_id == current_user.tenant_id)
        .order_by(QualitySurveyInvite.created_at.desc())
        .all()
    )
    invite_ids = [invite.id for invite in invites]
    responses = (
        db.query(QualitySurveyResponse)
        .filter(QualitySurveyResponse.invite_id.in_(invite_ids))
        .all()
        if invite_ids
        else []
    )
    response_count = len(responses)
    pending_count = sum(1 for invite in invites if invite.status in {"pending", "sent"})
    average = round(mean([resp.atencion_general for resp in responses]), 2) if responses else 0.0
    response_rate = round((response_count / len(invites)) * 100, 2) if invites else 0.0

    return QualitySummaryResponse(
        total_invitaciones=len(invites),
        total_respondidas=response_count,
        total_pendientes=pending_count,
        promedio_general=average,
        tasa_respuesta=response_rate,
    )


@router.get("/invites", response_model=list[QualityInviteItem])
def list_quality_invites(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    process_due_quality_invites(db, tenant_id=current_user.tenant_id, limit=100)

    query = db.query(QualitySurveyInvite).filter(QualitySurveyInvite.tenant_id == current_user.tenant_id)
    if status_filter:
        query = query.filter(QualitySurveyInvite.status == status_filter.strip().lower())
    invites = query.order_by(QualitySurveyInvite.created_at.desc()).limit(300).all()
    invite_ids = [invite.id for invite in invites]
    responses = (
        db.query(QualitySurveyResponse)
        .filter(QualitySurveyResponse.invite_id.in_(invite_ids))
        .all()
        if invite_ids
        else []
    )
    response_map = {str(resp.invite_id): resp for resp in responses}
    return [_invite_to_item(invite, response_map.get(str(invite.id))) for invite in invites]


@router.get("/invites/{invite_id}", response_model=QualityInviteDetailResponse)
def get_quality_invite_detail(
    invite_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    invite = (
        db.query(QualitySurveyInvite)
        .filter(QualitySurveyInvite.id == invite_id, QualitySurveyInvite.tenant_id == current_user.tenant_id)
        .first()
    )
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")

    response = db.query(QualitySurveyResponse).filter(QualitySurveyResponse.invite_id == invite.id).first()
    base = _invite_to_item(invite, response)
    return QualityInviteDetailResponse(
        **base.model_dump(),
        atencion_recepcion=response.atencion_recepcion if response else None,
        atencion_caja=response.atencion_caja if response else None,
        sala_espera=response.sala_espera if response else None,
        agrado_visita=response.agrado_visita if response else None,
        cajero_nombre=invite.cajero_nombre,
        recepcionista_nombre=invite.recepcionista_nombre,
    )


@router.get("/public/{token}", response_model=QualityPublicSurveyInfo)
def get_public_quality_survey(token: str, db: Session = Depends(get_db)):
    invite = db.query(QualitySurveyInvite).filter(QualitySurveyInvite.response_token == token).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enlace inválido")

    tenant = db.query(Tenant).filter(Tenant.id == invite.tenant_id).first()
    now = _now_naive()
    already_answered = invite.responded_at is not None or invite.status == "responded"
    expired = now > invite.expires_at
    return QualityPublicSurveyInfo(
        token_valid=not expired,
        already_answered=already_answered,
        expired=expired,
        invite_id=str(invite.id),
        nombre_cda=(
            tenant.nombre_comercial if tenant and tenant.nombre_comercial else (tenant.nombre if tenant else "CDASOFT")
        ),
        logo_url=tenant.logo_url if tenant else None,
        color_primario=tenant.color_primario if tenant and tenant.color_primario else "#2563eb",
        color_secundario=tenant.color_secundario if tenant and tenant.color_secundario else "#0f172a",
        cliente_nombre=invite.cliente_nombre,
        placa=invite.placa,
        tipo_vehiculo=invite.tipo_vehiculo,
    )


@router.post("/public/{token}/submit")
def submit_public_quality_survey(
    token: str,
    payload: QualityPublicSurveySubmitRequest,
    db: Session = Depends(get_db),
):
    invite = db.query(QualitySurveyInvite).filter(QualitySurveyInvite.response_token == token).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enlace inválido")

    now = _now_naive()
    if now > invite.expires_at:
        invite.status = "expired"
        invite.updated_at = now
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El enlace ha expirado")

    existing = db.query(QualitySurveyResponse).filter(QualitySurveyResponse.invite_id == invite.id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esta encuesta ya fue respondida")

    response = QualitySurveyResponse(
        invite_id=invite.id,
        tenant_id=invite.tenant_id,
        atencion_recepcion=payload.atencion_recepcion,
        atencion_caja=payload.atencion_caja,
        sala_espera=payload.sala_espera,
        agrado_visita=payload.agrado_visita,
        atencion_general=payload.atencion_general,
        comentario=(payload.comentario or "").strip() or None,
        created_at=now,
    )
    db.add(response)
    invite.status = "responded"
    invite.responded_at = now
    invite.updated_at = now
    db.commit()
    return {"success": True, "message": "Gracias por compartir tu experiencia."}


@router.get("/rtm-reminders/summary", response_model=RTMReminderSummary)
def get_rtm_reminders_summary(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    now = _now_naive()
    horizon = now + timedelta(days=30)
    rows = (
        db.query(RTMRenewalReminder)
        .filter(RTMRenewalReminder.tenant_id == current_user.tenant_id)
        .filter(RTMRenewalReminder.next_due_at >= now)
        .filter(RTMRenewalReminder.next_due_at <= horizon)
        .all()
    )
    due_30d = len(rows)
    due_15d = sum(1 for row in rows if (row.next_due_at.date() - now.date()).days <= 15)
    due_8d = sum(1 for row in rows if (row.next_due_at.date() - now.date()).days <= 8)
    no_management = sum(1 for row in rows if (row.commercial_status or "pendiente") == "pendiente")
    managed_count = sum(1 for row in rows if (row.commercial_status or "pendiente") != "pendiente")
    agendados = sum(1 for row in rows if (row.commercial_status or "") == "agendado")
    conversion = round((agendados / due_30d) * 100, 2) if due_30d else 0.0
    return RTMReminderSummary(
        total_upcoming=due_30d,
        due_30d=due_30d,
        due_15d=due_15d,
        due_8d=due_8d,
        no_management=no_management,
        managed_count=managed_count,
        agendados=agendados,
        conversion_agendado_pct=conversion,
    )


@router.get("/rtm-reminders", response_model=list[RTMReminderItem])
def list_rtm_reminders(
    days_window: int = 30,
    commercial_status: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if days_window not in {8, 15, 30}:
        days_window = 30
    now = _now_naive()
    upper = now + timedelta(days=days_window)
    query = (
        db.query(RTMRenewalReminder)
        .filter(RTMRenewalReminder.tenant_id == current_user.tenant_id)
        .filter(RTMRenewalReminder.next_due_at >= now)
        .filter(RTMRenewalReminder.next_due_at <= upper)
    )
    if commercial_status and commercial_status.strip().lower() != "todos":
        query = query.filter(RTMRenewalReminder.commercial_status == commercial_status.strip().lower())
    rows = query.order_by(RTMRenewalReminder.next_due_at.asc()).limit(500).all()

    if search:
        q = search.strip().lower()
        rows = [
            row
            for row in rows
            if q in (row.cliente_nombre or "").lower()
            or q in (row.placa or "").lower()
            or q in (row.cliente_celular or "").lower()
            or q in (row.cliente_email or "").lower()
        ]
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )
    agendamiento_url = (
        f"{settings.FRONTEND_URL.rstrip('/')}/agendar/{tenant.slug}"
        if tenant and tenant.slug
        else None
    )
    return [_to_rtm_item(row, now, agendamiento_url, nombre_cda) for row in rows]


@router.patch("/rtm-reminders/{reminder_id}", response_model=RTMReminderItem)
def update_rtm_reminder_commercial(
    reminder_id: str,
    payload: RTMReminderCommercialUpdateRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    reminder = (
        db.query(RTMRenewalReminder)
        .filter(RTMRenewalReminder.id == reminder_id, RTMRenewalReminder.tenant_id == current_user.tenant_id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recordatorio no encontrado")

    reminder.commercial_status = payload.commercial_status.strip().lower()
    reminder.commercial_notes = (payload.commercial_notes or "").strip() or None
    reminder.assigned_to_name = (payload.assigned_to_name or "").strip() or None
    reminder.next_contact_at = payload.next_contact_at
    reminder.last_management_at = _now_naive()
    reminder.last_management_channel = "manual_update"
    reminder.management_count = int(reminder.management_count or 0) + 1
    reminder.updated_at = _now_naive()
    db.commit()
    db.refresh(reminder)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )
    agendamiento_url = (
        f"{settings.FRONTEND_URL.rstrip('/')}/agendar/{tenant.slug}"
        if tenant and tenant.slug
        else None
    )
    return _to_rtm_item(reminder, _now_naive(), agendamiento_url, nombre_cda)


@router.post("/rtm-reminders/{reminder_id}/send-now", response_model=RTMReminderManualSendResponse)
def send_rtm_reminder_now(
    reminder_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    reminder = (
        db.query(RTMRenewalReminder)
        .filter(RTMRenewalReminder.id == reminder_id, RTMRenewalReminder.tenant_id == current_user.tenant_id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recordatorio no encontrado")
    if not reminder.cliente_email:
        return RTMReminderManualSendResponse(sent=False, message="El cliente no tiene correo registrado.")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
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
    sent = enviar_email(reminder.cliente_email, f"{nombre_cda} - Recordatorio de próxima RTM", html)
    now = _now_naive()
    reminder.last_manual_sent_at = now
    reminder.last_management_at = now
    reminder.last_management_channel = "email_manual"
    reminder.management_count = int(reminder.management_count or 0) + 1
    if (reminder.commercial_status or "pendiente") == "pendiente":
        reminder.commercial_status = "contactado"
    reminder.updated_at = now
    reminder.send_error = None if sent else "No fue posible enviar email manual"
    db.commit()
    return RTMReminderManualSendResponse(
        sent=bool(sent),
        message="Recordatorio enviado correctamente." if sent else "No fue posible enviar el recordatorio.",
    )


@router.post("/rtm-reminders/process")
def process_pending_rtm_reminders(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    processed = process_due_rtm_renewal_reminders(db, tenant_id=current_user.tenant_id, limit=200)
    return {"processed": processed}


@router.post("/rtm-reminders/{reminder_id}/touch-management", response_model=RTMReminderItem)
def touch_rtm_management(
    reminder_id: str,
    payload: RTMReminderTouchManagementRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    reminder = (
        db.query(RTMRenewalReminder)
        .filter(RTMRenewalReminder.id == reminder_id, RTMRenewalReminder.tenant_id == current_user.tenant_id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recordatorio no encontrado")

    now = _now_naive()
    reminder.last_management_at = now
    reminder.last_management_channel = (payload.channel or "").strip().lower()
    reminder.management_count = int(reminder.management_count or 0) + 1
    if payload.auto_status:
        next_status = payload.auto_status.strip().lower()
        if next_status in {"contactado", "interesado", "agendado", "no responde", "descartado", "pendiente"}:
            reminder.commercial_status = next_status
    elif (reminder.commercial_status or "pendiente") == "pendiente":
        reminder.commercial_status = "contactado"
    reminder.updated_at = now
    db.commit()
    db.refresh(reminder)

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )
    agendamiento_url = (
        f"{settings.FRONTEND_URL.rstrip('/')}/agendar/{tenant.slug}"
        if tenant and tenant.slug
        else None
    )
    return _to_rtm_item(reminder, now, agendamiento_url, nombre_cda)

