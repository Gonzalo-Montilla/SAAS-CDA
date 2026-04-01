"""
Endpoints de calidad (encuestas de satisfacción por tenant).
"""
from datetime import datetime, timezone
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.quality import QualitySurveyInvite, QualitySurveyResponse
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.utils.quality import process_due_quality_invites, utcnow_naive

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

