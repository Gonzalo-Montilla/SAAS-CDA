"""
WhatsApp Business del CDA. El gerente pega las credenciales de su API (como Factus).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.deps import get_db, get_gerente
from app.models.usuario import Usuario
from app.schemas.whatsapp import (
    WhatsAppPackItem,
    WhatsAppSettingsOut,
    WhatsAppSettingsUpdate,
    WhatsAppTestConnectionResult,
    WhatsAppTestSendIn,
    WhatsAppTestSendResult,
)
from app.services.whatsapp_asistente import procesar_inbound
from app.services.whatsapp_pack import PACK
from app.services.whatsapp_tenant import (
    apply_settings_update,
    enviar_prueba_calidad,
    get_or_create_settings_row,
    row_to_out,
    run_test_connection,
)

router = APIRouter()


@router.get("/pack", response_model=list[WhatsAppPackItem])
def get_whatsapp_pack(
    current_user: Usuario = Depends(get_gerente),
):
    return PACK


@router.get("/settings", response_model=WhatsAppSettingsOut)
def get_whatsapp_settings(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_gerente),
):
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return row_to_out(row)


@router.put("/settings", response_model=WhatsAppSettingsOut)
def put_whatsapp_settings(
    body: WhatsAppSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_gerente),
):
    row = get_or_create_settings_row(db, current_user.tenant_id)
    apply_settings_update(db, row, body)
    return row_to_out(row)


@router.post("/test-connection", response_model=WhatsAppTestConnectionResult)
def post_whatsapp_test_connection(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_gerente),
):
    row = get_or_create_settings_row(db, current_user.tenant_id)
    result = run_test_connection(row)
    if result.ok:
        from app.services.whatsapp_tenant import utcnow_naive

        row.last_ok_at = utcnow_naive()
        row.last_error = None
        if result.display_phone and not row.display_phone_e164:
            row.display_phone_e164 = result.display_phone
        db.commit()
    else:
        row.last_error = (result.message or "")[:1000]
        db.commit()
    return result


@router.post("/test-send", response_model=WhatsAppTestSendResult)
def post_whatsapp_test_send(
    body: WhatsAppTestSendIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_gerente),
):
    return enviar_prueba_calidad(
        db, tenant_id=current_user.tenant_id, celular=body.celular, evento=body.evento
    )


@router.post("/webhook")
@router.post("/webhook/{tenant_id}")
async def post_whatsapp_webhook(
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: UUID | None = None,
):
    """360dialog / Meta entregan aquí el mensaje del cliente. Sin JWT."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return procesar_inbound(db, payload, tenant_id=tenant_id)
