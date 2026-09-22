"""
Utilidades para invitaciones y envío de encuestas de calidad.
"""
from datetime import datetime, timedelta, timezone
import secrets

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.quality import QualitySurveyInvite, QualitySurveyResponse
from app.models.tenant import Tenant
from app.utils.email import enviar_email, generar_email_encuesta_calidad_cliente
from app.utils.nombres import formatear_nombre_comercial
from app.services.whatsapp_tenant import enviar_aviso_calidad


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def build_quality_survey_link(token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/calidad/encuesta/{token}"


def create_quality_survey_invite(
    db: Session,
    *,
    tenant_id,
    vehiculo_id,
    sucursal_id=None,
    sucursal_nombre: str | None = None,
    cliente_nombre: str,
    cliente_email: str | None,
    cliente_celular: str | None,
    placa: str,
    tipo_vehiculo: str,
    cajero_nombre: str | None,
    recepcionista_nombre: str | None,
    send_delay_hours: int = 3,
    expires_in_days: int = 7,
) -> QualitySurveyInvite:
    now = utcnow_naive()
    normalized_email = (cliente_email or "").strip().lower() or None
    token = secrets.token_urlsafe(32)

    nombre_sede = (sucursal_nombre or "").strip() or None
    celular_norm = (cliente_celular or "").strip() or None
    tiene_canal = bool(normalized_email or celular_norm)
    invite = QualitySurveyInvite(
        tenant_id=tenant_id,
        vehiculo_id=vehiculo_id,
        sucursal_id=sucursal_id,
        sucursal_nombre=nombre_sede,
        cliente_nombre=(cliente_nombre or "").strip() or "Cliente",
        cliente_email=normalized_email,
        cliente_celular=celular_norm,
        placa=(placa or "").strip().upper(),
        tipo_vehiculo=(tipo_vehiculo or "").strip().lower(),
        cajero_nombre=(cajero_nombre or "").strip() or None,
        recepcionista_nombre=(recepcionista_nombre or "").strip() or None,
        status="pending" if tiene_canal else "no_email",
        response_token=token,
        scheduled_send_at=now + timedelta(hours=send_delay_hours),
        expires_at=now + timedelta(days=expires_in_days),
        created_at=now,
        updated_at=now,
    )
    db.add(invite)
    return invite


def process_due_quality_invites(
    db: Session,
    tenant_id=None,
    limit: int = 50,
    force_send: bool = False,
) -> int:
    now = utcnow_naive()
    filters = [
        QualitySurveyInvite.status == "pending",
        QualitySurveyInvite.sent_at.is_(None),
        QualitySurveyInvite.expires_at > now,
    ]
    if not force_send:
        filters.append(QualitySurveyInvite.scheduled_send_at <= now)

    query = db.query(QualitySurveyInvite).filter(*filters)
    if tenant_id is not None:
        query = query.filter(QualitySurveyInvite.tenant_id == tenant_id)
    query = query.order_by(QualitySurveyInvite.scheduled_send_at.asc()).limit(limit)

    invites = query.with_for_update(skip_locked=True).all()
    if not invites:
        return 0

    sent_count = 0
    tenant_ids = {invite.tenant_id for invite in invites}
    tenants = db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    tenant_map = {tenant.id: tenant for tenant in tenants}

    for invite in invites:
        if invite.status != "pending":
            continue
        existing_resp = (
            db.query(QualitySurveyResponse)
            .filter(QualitySurveyResponse.invite_id == invite.id)
            .first()
        )
        if existing_resp:
            invite.status = "responded"
            invite.responded_at = existing_resp.created_at
            invite.updated_at = now
            continue

        tenant = tenant_map.get(invite.tenant_id)
        raw_cda = (
            tenant.nombre_comercial
            if tenant and tenant.nombre_comercial
            else (tenant.nombre if tenant else "CDASOFT")
        )
        nombre_cda = formatear_nombre_comercial(raw_cda, "CDASOFT")
        link = build_quality_survey_link(invite.response_token)
        destinatario = (invite.cliente_email or "").strip() or None
        email_sent = False
        email_error = None
        if destinatario:
            html = generar_email_encuesta_calidad_cliente(
                nombre_cda=nombre_cda,
                nombre_cliente=invite.cliente_nombre,
                survey_link=link,
            )
            subject = f"{nombre_cda} - Queremos conocer tu experiencia"
            try:
                email_sent = bool(enviar_email(destinatario, subject, html))
                if not email_sent:
                    email_error = "No fue posible enviar email con el proveedor configurado"
            except Exception as exc:
                email_error = str(exc)[:1000]

        wa_sent = False
        try:
            wa_sent = bool(
                enviar_aviso_calidad(
                    db,
                    tenant_id=invite.tenant_id,
                    celular=invite.cliente_celular,
                    nombre_cliente=invite.cliente_nombre,
                    nombre_cda=nombre_cda,
                    survey_link=link,
                )
            )
        except Exception as exc:
            print(f"Error WhatsApp encuesta invite={invite.id}: {exc}")

        if email_sent or wa_sent:
            invite.status = "sent"
            invite.sent_at = now
            if email_sent or not destinatario:
                invite.send_error = None
            else:
                invite.send_error = "Enviado por WhatsApp; el correo no salió"
            sent_count += 1
        else:
            invite.status = "failed"
            invite.send_error = email_error or "No fue posible enviar correo ni WhatsApp"
        invite.updated_at = now

    db.commit()
    return sent_count

