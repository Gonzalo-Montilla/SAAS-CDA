"""
Endpoints de calidad (encuestas de satisfacción por tenant).
"""
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from statistics import mean
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import false, or_
from sqlalchemy.orm import Session

from app.api.v1.endpoints.vehiculos import REINSPECCION_VENTANA_DIAS, _build_reinspeccion_context_for_origen
from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.models.audit_log import AuditAction, AuditLog
from app.models.quality import QualitySurveyInvite, QualitySurveyResponse
from app.models.rtm_reminder import RTMRenewalReminder
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.usuario import RolEnum, Usuario
from app.models.vehiculo import EstadoVehiculo, VehiculoProceso
from app.utils.quality import process_due_quality_invites, utcnow_naive
from app.utils.rtm_reminders import process_due_rtm_renewal_reminders
from app.utils.email import (
    enviar_email,
    generar_email_recordatorio_proxima_rtm,
    generar_email_rechazo_reinspeccion_cliente,
)
from app.utils.tenant_logo import normalize_external_logo_url, save_tenant_logo_upload

router = APIRouter()


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _calidad_puede_elegir_sede(user: Usuario) -> bool:
    return user.rol in (RolEnum.ADMINISTRADOR, RolEnum.CONTADOR)


def _parse_calidad_sucursal_id_param(raw: str | None) -> uuid.UUID | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        return uuid.UUID(str(raw).strip())
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sucursal_id inválido") from None


def _apply_calidad_sede_filter(query, db: Session, user: Usuario, sucursal_uuid: uuid.UUID | None):
    """Admin/contador: todo el tenant o una sede elegida. Resto: solo su sede (sin ver otras ni legado sin sede)."""
    if _calidad_puede_elegir_sede(user):
        if sucursal_uuid is not None:
            sede = (
                db.query(Sucursal)
                .filter(Sucursal.id == sucursal_uuid, Sucursal.tenant_id == user.tenant_id)
                .first()
            )
            if not sede:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sede no encontrada")
            return query.filter(QualitySurveyInvite.sucursal_id == sucursal_uuid)
        return query
    if user.sucursal_id is None:
        # Sin sede asignada: no listar nada (evita ver tenant completo ni legado ambiguo).
        return query.filter(false())
    return query.filter(QualitySurveyInvite.sucursal_id == user.sucursal_id)


def _calidad_invite_visible_for_user(invite: QualitySurveyInvite, user: Usuario) -> bool:
    if _calidad_puede_elegir_sede(user):
        return True
    if invite.sucursal_id is None:
        # Legado sin sede: solo quien puede ver todo el tenant.
        return False
    if user.sucursal_id is None:
        return False
    return invite.sucursal_id == user.sucursal_id


class QualitySummaryResponse(BaseModel):
    total_invitaciones: int
    total_respondidas: int
    total_pendientes: int
    promedio_general: float
    tasa_respuesta: float


class QualityTenantLogoResponse(BaseModel):
    logo_calidad_url: str | None = None
    logo_general_url: str | None = None
    formato_prerevision_version: str | None = None


class QualityInviteItem(BaseModel):
    id: str
    cliente_nombre: str
    cliente_email: str | None = None
    cliente_celular: str | None = None
    sucursal_id: str | None = None
    sucursal_nombre: str | None = None
    placa: str
    tipo_vehiculo: str
    status: str
    scheduled_send_at: datetime
    sent_at: datetime | None = None
    responded_at: datetime | None = None
    expires_at: datetime
    experiencia_global: int | None = None
    comentario: str | None = None
    certificado_entregado_at: datetime | None = None
    certificado_entregado_por: str | None = None
    revision_cierre_resultado: str | None = None
    revision_cierre_observacion: str | None = None
    revision_cierre_at: datetime | None = None
    correccion_cierre_disponible: bool = False
    created_at: datetime


class QualityInviteListResponse(BaseModel):
    items: list[QualityInviteItem]
    total: int


class QualityInviteDetailResponse(QualityInviteItem):
    facilidad_agendar_cita: int | None = None
    tiempo_espera_revision: int | None = None
    amabilidad_recepcion_caja: int | None = None
    limpieza_instalaciones: int | None = None
    amenidades_cda: int | None = None
    claridad_resultados_revision: int | None = None
    confianza_diagnostico_tecnico: int | None = None
    recomendar_cda: int | None = None
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
    facilidad_agendar_cita: int = Field(ge=1, le=5)
    tiempo_espera_revision: int = Field(ge=1, le=5)
    amabilidad_recepcion_caja: int = Field(ge=1, le=5)
    limpieza_instalaciones: int = Field(ge=1, le=5)
    amenidades_cda: int = Field(ge=1, le=5)
    claridad_resultados_revision: int = Field(ge=1, le=5)
    confianza_diagnostico_tecnico: int = Field(ge=1, le=5)
    recomendar_cda: int = Field(ge=1, le=5)
    experiencia_global: int = Field(ge=1, le=5)
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


class MarkCertificateDeliveredResponse(BaseModel):
    success: bool
    vehiculo_id: str
    resultado: Literal["aprobado", "rechazado"]
    certificado_entregado_at: datetime | None = None
    certificado_entregado_por: str | None = None
    observacion: str | None = None
    message: str


class MarkCertificateDeliveredRequest(BaseModel):
    resultado: Literal["aprobado", "rechazado"]
    observacion: str | None = Field(default=None, max_length=2000)


class CorrectInspectionResultRequest(BaseModel):
    motivo: str = Field(min_length=10, max_length=2000)
    sincronizar_reintento_pendiente: bool = True


class CorrectInspectionResultResponse(BaseModel):
    success: bool
    vehiculo_id: str
    placa: str
    resultado_anterior: str
    resultado_nuevo: Literal["rechazado"]
    reintento_sincronizado: bool
    reintento_vehiculo_id: str | None = None
    message: str


class RTMReminderTouchManagementRequest(BaseModel):
    channel: str = Field(min_length=3, max_length=30)
    auto_status: str | None = Field(default=None, max_length=30)


_IN_PERSON_SUBMIT_STATUSES = frozenset({"pending", "no_email", "sent", "failed"})


def _vehiculo_cerrado_como_aprobado(vehiculo: VehiculoProceso) -> bool:
    resultado = (vehiculo.revision_cierre_resultado or "").strip().lower()
    if resultado == "aprobado":
        return True
    if resultado == "rechazado":
        return False
    if vehiculo.certificado_entregado_at is not None:
        return True
    estado_raw = vehiculo.estado.value if hasattr(vehiculo.estado, "value") else str(vehiculo.estado)
    return estado_raw.strip().lower() == "aprobado"


def _correccion_cierre_disponible(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    vehiculo: VehiculoProceso | None,
) -> bool:
    if not vehiculo or not _vehiculo_cerrado_como_aprobado(vehiculo):
        return False
    if vehiculo.estado == EstadoVehiculo.REGISTRADO:
        return False
    origen = _resolve_reinspeccion_origen(db, tenant_id=tenant_id, vehiculo=vehiculo)
    vence_at = origen.fecha_registro + timedelta(days=REINSPECCION_VENTANA_DIAS)
    return _now_naive() <= vence_at


def _resolve_reinspeccion_origen(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    vehiculo: VehiculoProceso,
) -> VehiculoProceso:
    if vehiculo.reinspeccion_origen_id is None:
        return vehiculo
    origen = (
        db.query(VehiculoProceso)
        .filter(
            VehiculoProceso.id == vehiculo.reinspeccion_origen_id,
            VehiculoProceso.tenant_id == tenant_id,
        )
        .first()
    )
    return origen or vehiculo


def _sync_pending_reinspeccion_registro(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    origen: VehiculoProceso,
) -> VehiculoProceso | None:
    root = _resolve_reinspeccion_origen(db, tenant_id=tenant_id, vehiculo=origen)
    ctx = _build_reinspeccion_context_for_origen(db, tenant_id=tenant_id, origen=root)
    if not ctx["elegible"]:
        return None

    pending = (
        db.query(VehiculoProceso)
        .filter(
            VehiculoProceso.tenant_id == tenant_id,
            VehiculoProceso.placa == origen.placa,
            VehiculoProceso.estado == EstadoVehiculo.REGISTRADO,
            VehiculoProceso.fecha_pago.is_(None),
            VehiculoProceso.id != origen.id,
            or_(
                VehiculoProceso.reinspeccion_exenta.is_(False),
                VehiculoProceso.reinspeccion_exenta.is_(None),
            ),
        )
        .order_by(VehiculoProceso.fecha_registro.desc())
        .first()
    )
    if not pending:
        return None

    intento_actual = int(ctx["intentos_usados"]) + 1
    pending.reinspeccion_exenta = True
    pending.reinspeccion_origen_id = root.id
    pending.reinspeccion_intento = intento_actual
    pending.reinspeccion_vence_at = ctx["vence_at"]
    pending.valor_rtm = Decimal(0)
    pending.comision_soat = Decimal(0)
    pending.total_cobrado = Decimal(0)
    pending.tiene_soat = False
    return pending


def _audit_inspection_correction(
    db: Session,
    *,
    current_user: Usuario,
    request: Request,
    vehiculo: VehiculoProceso,
    resultado_anterior: str,
    motivo: str,
    synced_pending: VehiculoProceso | None,
    before_snapshot: dict[str, Any],
) -> None:
    ip_address = None
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip_address = forwarded.split(",")[0].strip()
    elif request.client:
        ip_address = request.client.host

    db.add(
        AuditLog(
            action=AuditAction.CORRECT_INSPECTION_RESULT.value,
            description=(
                f"Corrección de resultado de inspección: {vehiculo.placa} "
                f"({resultado_anterior} -> rechazado)"
            ),
            usuario_id=current_user.id,
            usuario_email=current_user.email,
            usuario_nombre=current_user.nombre_completo,
            usuario_rol=current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol),
            ip_address=ip_address,
            user_agent=request.headers.get("User-Agent"),
            extra_data={
                "vehiculo_id": str(vehiculo.id),
                "placa": vehiculo.placa,
                "resultado_anterior": resultado_anterior,
                "resultado_nuevo": "rechazado",
                "motivo": motivo,
                "before": before_snapshot,
                "reintento_sincronizado": synced_pending is not None,
                "reintento_vehiculo_id": str(synced_pending.id) if synced_pending else None,
            },
            success="success",
        )
    )


def _persist_quality_survey_response(
    db: Session,
    invite: QualitySurveyInvite,
    payload: QualityPublicSurveySubmitRequest,
    now: datetime,
) -> None:
    response = QualitySurveyResponse(
        invite_id=invite.id,
        tenant_id=invite.tenant_id,
        facilidad_agendar_cita=payload.facilidad_agendar_cita,
        tiempo_espera_revision=payload.tiempo_espera_revision,
        amabilidad_recepcion_caja=payload.amabilidad_recepcion_caja,
        limpieza_instalaciones=payload.limpieza_instalaciones,
        amenidades_cda=payload.amenidades_cda,
        claridad_resultados_revision=payload.claridad_resultados_revision,
        confianza_diagnostico_tecnico=payload.confianza_diagnostico_tecnico,
        recomendar_cda=payload.recomendar_cda,
        experiencia_global=payload.experiencia_global,
        comentario=(payload.comentario or "").strip() or None,
        created_at=now,
    )
    db.add(response)
    invite.status = "responded"
    invite.responded_at = now
    invite.updated_at = now


def _invite_to_item(
    invite: QualitySurveyInvite,
    response: QualitySurveyResponse | None,
    vehiculo: VehiculoProceso | None = None,
    entregador_nombre: str | None = None,
    correccion_cierre_disponible: bool = False,
) -> QualityInviteItem:
    return QualityInviteItem(
        id=str(invite.id),
        cliente_nombre=invite.cliente_nombre,
        cliente_email=invite.cliente_email,
        cliente_celular=invite.cliente_celular,
        sucursal_id=str(invite.sucursal_id) if invite.sucursal_id else None,
        sucursal_nombre=invite.sucursal_nombre,
        placa=invite.placa,
        tipo_vehiculo=invite.tipo_vehiculo,
        status=invite.status,
        scheduled_send_at=invite.scheduled_send_at,
        sent_at=invite.sent_at,
        responded_at=invite.responded_at,
        expires_at=invite.expires_at,
        experiencia_global=response.experiencia_global if response else None,
        comentario=response.comentario if response else None,
        certificado_entregado_at=(vehiculo.certificado_entregado_at if vehiculo else None),
        certificado_entregado_por=entregador_nombre,
        revision_cierre_resultado=(vehiculo.revision_cierre_resultado if vehiculo else None),
        revision_cierre_observacion=(vehiculo.revision_cierre_observacion if vehiculo else None),
        revision_cierre_at=(vehiculo.revision_cierre_at if vehiculo else None),
        correccion_cierre_disponible=correccion_cierre_disponible,
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


def _require_logo_calidad_admin(user: Usuario) -> None:
    if user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden actualizar el logo de Calidad.",
        )


@router.get("/logo-calidad", response_model=QualityTenantLogoResponse)
def get_quality_logo_config(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return QualityTenantLogoResponse(
        logo_calidad_url=tenant.logo_calidad_url,
        logo_general_url=tenant.logo_url,
        formato_prerevision_version=(tenant.formato_prerevision_version or "").strip() or None,
    )


@router.put("/logo-calidad", response_model=QualityTenantLogoResponse)
def upsert_quality_logo_config(
    logo_url: str | None = Form(default=None),
    logo_file: UploadFile | None = File(default=None),
    formato_prerevision_version: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_logo_calidad_admin(current_user)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    version_payload_provided = formato_prerevision_version is not None
    if logo_file is None and not (logo_url or "").strip() and not version_payload_provided:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes enviar logo_url, subir logo_file o actualizar formato_prerevision_version",
        )

    if logo_file is not None:
        tenant.logo_calidad_url = save_tenant_logo_upload(logo_file)
    elif (logo_url or "").strip():
        tenant.logo_calidad_url = normalize_external_logo_url((logo_url or "").strip())

    if version_payload_provided:
        version_clean = (formato_prerevision_version or "").strip()
        if len(version_clean) > 50:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="formato_prerevision_version no puede superar 50 caracteres",
            )
        tenant.formato_prerevision_version = version_clean or None

    tenant.updated_at = _now_naive()
    db.commit()
    db.refresh(tenant)
    return QualityTenantLogoResponse(
        logo_calidad_url=tenant.logo_calidad_url,
        logo_general_url=tenant.logo_url,
        formato_prerevision_version=(tenant.formato_prerevision_version or "").strip() or None,
    )


@router.delete("/logo-calidad", response_model=QualityTenantLogoResponse)
def clear_quality_logo_config(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_logo_calidad_admin(current_user)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    tenant.logo_calidad_url = None
    tenant.updated_at = _now_naive()
    db.commit()
    db.refresh(tenant)
    return QualityTenantLogoResponse(
        logo_calidad_url=tenant.logo_calidad_url,
        logo_general_url=tenant.logo_url,
        formato_prerevision_version=(tenant.formato_prerevision_version or "").strip() or None,
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
    sucursal_id: str | None = Query(default=None, description="Filtrar por sede (administrador/contador)"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    process_due_quality_invites(db, tenant_id=current_user.tenant_id, limit=100)

    sid = _parse_calidad_sucursal_id_param(sucursal_id) if _calidad_puede_elegir_sede(current_user) else None

    q_inv = (
        db.query(QualitySurveyInvite)
        .filter(QualitySurveyInvite.tenant_id == current_user.tenant_id)
        .order_by(QualitySurveyInvite.created_at.desc())
    )
    q_inv = _apply_calidad_sede_filter(q_inv, db, current_user, sid)
    invites = q_inv.all()
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
    average = round(mean([resp.experiencia_global for resp in responses]), 2) if responses else 0.0
    response_rate = round((response_count / len(invites)) * 100, 2) if invites else 0.0

    return QualitySummaryResponse(
        total_invitaciones=len(invites),
        total_respondidas=response_count,
        total_pendientes=pending_count,
        promedio_general=average,
        tasa_respuesta=response_rate,
    )


@router.get("/invites", response_model=QualityInviteListResponse)
def list_quality_invites(
    status_filter: str | None = None,
    sucursal_id: str | None = Query(default=None, description="Filtrar por sede (administrador/contador)"),
    search: str | None = Query(
        default=None,
        description="Buscar en cliente, placa, correo, celular o sede",
        max_length=120,
    ),
    skip: int = Query(default=0, ge=0, le=500_000),
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    process_due_quality_invites(db, tenant_id=current_user.tenant_id, limit=100)

    sid = _parse_calidad_sucursal_id_param(sucursal_id) if _calidad_puede_elegir_sede(current_user) else None

    query = db.query(QualitySurveyInvite).filter(QualitySurveyInvite.tenant_id == current_user.tenant_id)
    query = _apply_calidad_sede_filter(query, db, current_user, sid)
    if status_filter:
        query = query.filter(QualitySurveyInvite.status == status_filter.strip().lower())
    q_term = (search or "").strip()
    if q_term:
        like = f"%{q_term}%"
        query = query.filter(
            or_(
                QualitySurveyInvite.cliente_nombre.ilike(like),
                QualitySurveyInvite.placa.ilike(like),
                QualitySurveyInvite.cliente_email.ilike(like),
                QualitySurveyInvite.cliente_celular.ilike(like),
                QualitySurveyInvite.sucursal_nombre.ilike(like),
            )
        )

    total = query.count()
    invites = (
        query.order_by(QualitySurveyInvite.created_at.desc()).offset(skip).limit(limit).all()
    )
    invite_ids = [invite.id for invite in invites]
    vehiculo_ids = [invite.vehiculo_id for invite in invites if invite.vehiculo_id is not None]
    responses = (
        db.query(QualitySurveyResponse)
        .filter(QualitySurveyResponse.invite_id.in_(invite_ids))
        .all()
        if invite_ids
        else []
    )
    vehiculos = (
        db.query(VehiculoProceso)
        .filter(VehiculoProceso.tenant_id == current_user.tenant_id, VehiculoProceso.id.in_(vehiculo_ids))
        .all()
        if vehiculo_ids
        else []
    )
    response_map = {str(resp.invite_id): resp for resp in responses}
    vehiculo_map = {str(v.id): v for v in vehiculos}
    entregador_ids = {
        v.certificado_entregado_por
        for v in vehiculos
        if getattr(v, "certificado_entregado_por", None) is not None
    }
    entregador_map: dict[str, str] = {}
    if entregador_ids:
        users = db.query(Usuario).filter(Usuario.id.in_(list(entregador_ids))).all()
        entregador_map = {str(u.id): u.nombre_completo for u in users}

    items = [
        _invite_to_item(
            invite,
            response_map.get(str(invite.id)),
            vehiculo_map.get(str(invite.vehiculo_id)) if invite.vehiculo_id else None,
            entregador_map.get(str(vehiculo_map.get(str(invite.vehiculo_id)).certificado_entregado_por))
            if invite.vehiculo_id and vehiculo_map.get(str(invite.vehiculo_id))
            and vehiculo_map.get(str(invite.vehiculo_id)).certificado_entregado_por
            else None,
            _correccion_cierre_disponible(
                db,
                tenant_id=current_user.tenant_id,
                vehiculo=vehiculo_map.get(str(invite.vehiculo_id)) if invite.vehiculo_id else None,
            ),
        )
        for invite in invites
    ]
    return QualityInviteListResponse(items=items, total=total)


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

    if not _calidad_invite_visible_for_user(invite, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")

    response = db.query(QualitySurveyResponse).filter(QualitySurveyResponse.invite_id == invite.id).first()
    vehiculo = None
    entregador_nombre = None
    if invite.vehiculo_id:
        vehiculo = (
            db.query(VehiculoProceso)
            .filter(
                VehiculoProceso.id == invite.vehiculo_id,
                VehiculoProceso.tenant_id == current_user.tenant_id,
            )
            .first()
        )
        if vehiculo and vehiculo.certificado_entregado_por:
            entregador = db.query(Usuario).filter(Usuario.id == vehiculo.certificado_entregado_por).first()
            entregador_nombre = entregador.nombre_completo if entregador else None

    base = _invite_to_item(
        invite,
        response,
        vehiculo,
        entregador_nombre,
        _correccion_cierre_disponible(db, tenant_id=current_user.tenant_id, vehiculo=vehiculo),
    )
    return QualityInviteDetailResponse(
        **base.model_dump(),
        facilidad_agendar_cita=response.facilidad_agendar_cita if response else None,
        tiempo_espera_revision=response.tiempo_espera_revision if response else None,
        amabilidad_recepcion_caja=response.amabilidad_recepcion_caja if response else None,
        limpieza_instalaciones=response.limpieza_instalaciones if response else None,
        amenidades_cda=response.amenidades_cda if response else None,
        claridad_resultados_revision=response.claridad_resultados_revision if response else None,
        confianza_diagnostico_tecnico=response.confianza_diagnostico_tecnico if response else None,
        recomendar_cda=response.recomendar_cda if response else None,
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

    _persist_quality_survey_response(db, invite, payload, now)
    db.commit()
    return {"success": True, "message": "Gracias por compartir tu experiencia."}


@router.post("/invites/{invite_id}/submit-in-person")
def submit_in_person_quality_survey(
    invite_id: str,
    payload: QualityPublicSurveySubmitRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Registra la encuesta en el CDA; anula el envío automático por correo si aún no se había enviado."""
    try:
        invite_uuid = uuid.UUID(invite_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador inválido") from exc

    invite = (
        db.query(QualitySurveyInvite)
        .filter(QualitySurveyInvite.id == invite_uuid, QualitySurveyInvite.tenant_id == current_user.tenant_id)
        .first()
    )
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")

    if not _calidad_invite_visible_for_user(invite, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")

    now = _now_naive()
    if now > invite.expires_at:
        invite.status = "expired"
        invite.updated_at = now
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El plazo de esta encuesta ha vencido")

    if invite.status == "responded":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esta encuesta ya fue respondida")

    if invite.status not in _IN_PERSON_SUBMIT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede registrar la encuesta en este estado",
        )

    existing = db.query(QualitySurveyResponse).filter(QualitySurveyResponse.invite_id == invite.id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esta encuesta ya fue respondida")

    _persist_quality_survey_response(db, invite, payload, now)
    db.commit()
    return {"success": True, "message": "Encuesta registrada. No se enviará correo si aún estaba pendiente."}


@router.post("/invites/{invite_id}/mark-certificate-delivered", response_model=MarkCertificateDeliveredResponse)
def mark_certificate_delivered(
    invite_id: str,
    payload: MarkCertificateDeliveredRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    try:
        invite_uuid = uuid.UUID(invite_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador inválido") from exc

    invite = (
        db.query(QualitySurveyInvite)
        .filter(QualitySurveyInvite.id == invite_uuid, QualitySurveyInvite.tenant_id == current_user.tenant_id)
        .first()
    )
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")
    if not _calidad_invite_visible_for_user(invite, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")
    if not invite.vehiculo_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitación sin vehículo asociado")

    vehiculo = (
        db.query(VehiculoProceso)
        .filter(
            VehiculoProceso.id == invite.vehiculo_id,
            VehiculoProceso.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    if vehiculo.revision_cierre_resultado in {"aprobado", "rechazado"}:
        entregador_nombre = "Usuario"
        if vehiculo.certificado_entregado_por:
            entregador = db.query(Usuario).filter(Usuario.id == vehiculo.certificado_entregado_por).first()
            if entregador and entregador.nombre_completo:
                entregador_nombre = entregador.nombre_completo
        return MarkCertificateDeliveredResponse(
            success=True,
            vehiculo_id=str(vehiculo.id),
            resultado=vehiculo.revision_cierre_resultado,
            certificado_entregado_at=vehiculo.certificado_entregado_at,
            certificado_entregado_por=entregador_nombre if vehiculo.certificado_entregado_at else None,
            observacion=vehiculo.revision_cierre_observacion,
            message="Este servicio ya tiene un cierre de resultado registrado.",
        )

    if vehiculo.estado == EstadoVehiculo.REGISTRADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El vehículo aún no está cobrado; no se puede marcar entrega de certificado.",
        )

    now = _now_naive()
    resultado = payload.resultado
    observacion = (payload.observacion or "").strip() or None
    if resultado == "rechazado" and not observacion:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La observación es obligatoria cuando el resultado es rechazado.",
        )

    vehiculo.revision_cierre_resultado = resultado
    vehiculo.revision_cierre_observacion = observacion
    vehiculo.revision_cierre_at = now
    vehiculo.revision_cierre_por = current_user.id
    if resultado == "aprobado":
        vehiculo.estado = EstadoVehiculo.APROBADO
        vehiculo.certificado_entregado_at = now
        vehiculo.certificado_entregado_por = current_user.id
    else:
        vehiculo.estado = EstadoVehiculo.RECHAZADO
        vehiculo.certificado_entregado_at = None
        vehiculo.certificado_entregado_por = None
    db.commit()
    db.refresh(vehiculo)

    if resultado == "rechazado":
        cliente_email = (vehiculo.cliente_email or "").strip().lower()
        if cliente_email:
            try:
                tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
                nombre_cda = (
                    tenant.nombre_comercial
                    if tenant and tenant.nombre_comercial
                    else (tenant.nombre if tenant else "CDASOFT")
                )
                asunto = f"Resultado de inspección RTM - {vehiculo.placa} - {nombre_cda}"
                cuerpo_html = generar_email_rechazo_reinspeccion_cliente(
                    nombre_cda=nombre_cda,
                    nombre_cliente=vehiculo.cliente_nombre or "Cliente",
                    placa=vehiculo.placa or "",
                    observacion_rechazo=observacion or "",
                    correo_contacto_cda=(tenant.correo_electronico if tenant else None),
                    telefono_contacto_cda=(tenant.celular if tenant else None),
                )
                sent = enviar_email(cliente_email, asunto, cuerpo_html)
                if not sent:
                    print("[WARN] Correo de rechazo/reinspección no enviado (SMTP retornó false).")
            except Exception as email_exc:
                print(f"[WARN] No se pudo enviar correo de rechazo/reinspección: {email_exc}")

    return MarkCertificateDeliveredResponse(
        success=True,
        vehiculo_id=str(vehiculo.id),
        resultado=resultado,
        certificado_entregado_at=vehiculo.certificado_entregado_at,
        certificado_entregado_por=current_user.nombre_completo if resultado == "aprobado" else None,
        observacion=observacion,
        message=(
            "Resultado registrado: aprobado y certificado entregado."
            if resultado == "aprobado"
            else "Resultado registrado: rechazado (sin entrega de certificado)."
        ),
    )


@router.post(
    "/invites/{invite_id}/corregir-cierre-resultado",
    response_model=CorrectInspectionResultResponse,
)
def corregir_cierre_resultado(
    invite_id: str,
    payload: CorrectInspectionResultRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden corregir el resultado de inspección.",
        )

    try:
        invite_uuid = uuid.UUID(invite_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador inválido") from exc

    invite = (
        db.query(QualitySurveyInvite)
        .filter(QualitySurveyInvite.id == invite_uuid, QualitySurveyInvite.tenant_id == current_user.tenant_id)
        .first()
    )
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")
    if not _calidad_invite_visible_for_user(invite, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")
    if not invite.vehiculo_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitación sin vehículo asociado")

    vehiculo = (
        db.query(VehiculoProceso)
        .filter(
            VehiculoProceso.id == invite.vehiculo_id,
            VehiculoProceso.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    if not _vehiculo_cerrado_como_aprobado(vehiculo):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede corregir un cierre registrado como aprobado.",
        )

    if vehiculo.estado == EstadoVehiculo.REGISTRADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El vehículo aún no está cobrado; use el cierre normal de inspección.",
        )

    motivo = payload.motivo.strip()
    resultado_anterior = (vehiculo.revision_cierre_resultado or "aprobado").strip().lower()
    origen = _resolve_reinspeccion_origen(db, tenant_id=current_user.tenant_id, vehiculo=vehiculo)
    now = _now_naive()
    vence_correccion = origen.fecha_registro + timedelta(days=REINSPECCION_VENTANA_DIAS)
    if now > vence_correccion:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La ventana de corrección venció ({REINSPECCION_VENTANA_DIAS} días "
                "desde el primer intento de reinspección)."
            ),
        )

    before_snapshot = {
        "estado": vehiculo.estado.value if hasattr(vehiculo.estado, "value") else str(vehiculo.estado),
        "revision_cierre_resultado": vehiculo.revision_cierre_resultado,
        "revision_cierre_observacion": vehiculo.revision_cierre_observacion,
        "certificado_entregado_at": vehiculo.certificado_entregado_at.isoformat()
        if vehiculo.certificado_entregado_at
        else None,
    }

    vehiculo.revision_cierre_resultado = "rechazado"
    vehiculo.revision_cierre_observacion = motivo
    vehiculo.revision_cierre_at = now
    vehiculo.revision_cierre_por = current_user.id
    vehiculo.estado = EstadoVehiculo.RECHAZADO
    vehiculo.certificado_entregado_at = None
    vehiculo.certificado_entregado_por = None

    synced_pending = None
    if payload.sincronizar_reintento_pendiente:
        synced_pending = _sync_pending_reinspeccion_registro(
            db,
            tenant_id=current_user.tenant_id,
            origen=vehiculo,
        )

    _audit_inspection_correction(
        db,
        current_user=current_user,
        request=request,
        vehiculo=vehiculo,
        resultado_anterior=resultado_anterior,
        motivo=motivo,
        synced_pending=synced_pending,
        before_snapshot=before_snapshot,
    )
    db.commit()
    db.refresh(vehiculo)

    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if cliente_email:
        try:
            tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
            nombre_cda = (
                tenant.nombre_comercial
                if tenant and tenant.nombre_comercial
                else (tenant.nombre if tenant else "CDASOFT")
            )
            asunto = f"Corrección resultado RTM - {vehiculo.placa} - {nombre_cda}"
            cuerpo_html = generar_email_rechazo_reinspeccion_cliente(
                nombre_cda=nombre_cda,
                nombre_cliente=vehiculo.cliente_nombre or "Cliente",
                placa=vehiculo.placa or "",
                observacion_rechazo=motivo,
                correo_contacto_cda=(tenant.correo_electronico if tenant else None),
                telefono_contacto_cda=(tenant.celular if tenant else None),
            )
            enviar_email(cliente_email, asunto, cuerpo_html)
        except Exception as email_exc:
            print(f"[WARN] No se pudo enviar correo tras corrección de inspección: {email_exc}")

    if synced_pending:
        message = (
            f"Resultado corregido a rechazado. Se actualizó el reintento pendiente en Caja "
            f"({synced_pending.placa}) a $0."
        )
    else:
        message = (
            "Resultado corregido a rechazado. No se encontró un registro pendiente en Caja para sincronizar."
        )

    return CorrectInspectionResultResponse(
        success=True,
        vehiculo_id=str(vehiculo.id),
        placa=vehiculo.placa or "",
        resultado_anterior=resultado_anterior,
        resultado_nuevo="rechazado",
        reintento_sincronizado=synced_pending is not None,
        reintento_vehiculo_id=str(synced_pending.id) if synced_pending else None,
        message=message,
    )


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

