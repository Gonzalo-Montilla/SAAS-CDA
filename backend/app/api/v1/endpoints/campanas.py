"""Campañas WhatsApp del CDA (módulo Comunicaciones)."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_active_sucursal_id, get_comunicaciones, get_db
from app.core.sucursal_scope import assigned_sucursal_ids, roles_ambito_marca, user_may_operate_sucursal
from app.models.campana import CampanaWhatsApp, CampanaWhatsAppDestinatario
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.models.whatsapp import TenantWhatsAppSettings
from app.schemas.campana import (
    CampanaCorreoGrokIn,
    CampanaCorreoGrokOut,
    CampanaCorreoRenderIn,
    CampanaCorreoRenderOut,
    CampanaCrearIn,
    CampanaDestinatarioOut,
    CampanaEnviarOut,
    CampanaFiltrosIn,
    CampanaGrokIn,
    CampanaGrokOut,
    CampanaListItemOut,
    CampanaOut,
    CampanaPreviewOut,
)
from app.services.campana_audiencias import (
    TOPE_ENVIO,
    armar_preview,
    canal_campana_listo,
    celulares_marketing_hoy,
    ventana_ley_2300,
)
from app.services.campana_envio import (
    campana_puede_enviarse,
    cuerpo_plantilla_campana,
    destinatario_tiene_correo,
    preview_canales_campana,
    procesar_envio_campana,
    utcnow_naive,
)
from app.services.whatsapp_tenant import enlace_agendar_publico
from app.utils.nombres import formatear_nombre_comercial
from app.utils.whatsapp_phone import normalizar_celular_co
from app.services.grok_tarjeta_metricas import guardar_metrica_grok_tarjeta
from app.services.whatsapp_pack import plantilla_por_evento
from app.integrations.xai_client import grok_disponible, redactar_campana, redactar_correo_campana

router = APIRouter()


def _sucursales_filtro(db: Session, user: Usuario) -> list[UUID] | None:
    if user.rol in roles_ambito_marca():
        return None
    ids = assigned_sucursal_ids(db, user)
    if ids:
        return ids
    if user.sucursal_id:
        return [user.sucursal_id]
    return []


def _assert_sede(db: Session, user: Usuario, sucursal_id: UUID | None) -> None:
    if sucursal_id is None:
        return
    if not user_may_operate_sucursal(db, user, sucursal_id):
        raise HTTPException(status_code=403, detail="No tienes permiso para esa sede.")


def _campana_out(row: CampanaWhatsApp, dests: list) -> CampanaOut:
    return CampanaOut(
        id=row.id,
        nombre=row.nombre,
        tipo=row.tipo,
        etiqueta=row.etiqueta,
        estado=row.estado,
        plantilla=row.plantilla,
        categoria_meta=row.categoria_meta,
        filtros_json=row.filtros_json,
        texto_propuesto=row.texto_propuesto,
        email_asunto=getattr(row, "email_asunto", None),
        email_cuerpo=getattr(row, "email_cuerpo", None),
        total_destinatarios=int(row.total_destinatarios or 0),
        enviados_ok=int(row.enviados_ok or 0),
        enviados_fail=int(row.enviados_fail or 0),
        error=row.error,
        created_at=row.created_at,
        sent_at=row.sent_at,
        finished_at=row.finished_at,
        destinatarios=[_dest_out(d) for d in dests],
    )


def _dest_out(item) -> CampanaDestinatarioOut:
    return CampanaDestinatarioOut(
        id=getattr(item, "id", None),
        vehiculo_id=item.vehiculo_id,
        destino_e164=item.destino_e164,
        cliente_nombre=item.cliente_nombre,
        placa=item.placa,
        opt_in_tipo=item.opt_in_tipo,
        motivo=item.motivo,
        estado=getattr(item, "estado", "pendiente") or "pendiente",
        error=getattr(item, "error", None),
        estado_whatsapp=getattr(item, "estado_whatsapp", None),
        estado_correo=getattr(item, "estado_correo", None),
        error_whatsapp=getattr(item, "error_whatsapp", None),
        error_correo=getattr(item, "error_correo", None),
        cliente_email=getattr(item, "cliente_email", None),
    )


def _preview_payload(
    db: Session,
    user: Usuario,
    filtros: CampanaFiltrosIn,
) -> CampanaPreviewOut:
    _assert_sede(db, user, filtros.sucursal_id)
    permitidas = _sucursales_filtro(db, user)
    if permitidas is not None and len(permitidas) == 0:
        raise HTTPException(status_code=403, detail="No tienes sedes asignadas.")
    try:
        dests, omitidos, plantilla, categoria = armar_preview(
            db,
            tenant_id=user.tenant_id,
            filtros=filtros,
            sucursales_permitidas=permitidas,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    recortados = dests[:TOPE_ENVIO]
    omitidos += max(0, len(dests) - TOPE_ENVIO)
    settings_row = (
        db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == user.tenant_id).first()
    )
    canal_ok, canal_motivo = canal_campana_listo(settings_row)
    ventana_ok, ventana_motivo = ventana_ley_2300()
    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    nombre_cda = formatear_nombre_comercial(
        (tenant.nombre_comercial if tenant else None) or (tenant.nombre if tenant else None),
        "CDA",
    )
    agendar_url = enlace_agendar_publico((tenant.slug if tenant else "") or "")
    muestra = recortados[0] if recortados else None
    whatsapp_preview, email_asunto, email_html, email_cuerpo = preview_canales_campana(
        tipo=filtros.tipo,
        etiqueta=filtros.etiqueta,
        dest=muestra,
        nombre_cda=nombre_cda,
        agendar_url=agendar_url,
        plantilla=plantilla,
        asunto_libre=filtros.email_asunto,
        cuerpo_libre=filtros.email_cuerpo,
    )
    marketing_hoy = (
        set()
        if filtros.tipo == "por_vencer"
        else celulares_marketing_hoy(db, user.tenant_id)
    )
    whatsapp_hoy = sum(
        1
        for d in recortados
        if (m := normalizar_celular_co(getattr(d, "destino_e164", None))) and m in marketing_hoy
    )
    return CampanaPreviewOut(
        tipo=filtros.tipo,
        categoria_meta=categoria,
        plantilla=plantilla,
        plantilla_cuerpo=cuerpo_plantilla_campana(filtros.tipo, plantilla),
        total=len(recortados),
        omitidos=omitidos,
        tope=TOPE_ENVIO,
        destinatarios=[_dest_out(d) for d in recortados[:80]],
        ventana_ok=ventana_ok,
        ventana_motivo=ventana_motivo,
        canal_listo=canal_ok,
        canal_motivo=canal_motivo,
        con_correo=sum(1 for d in recortados if destinatario_tiene_correo(d)),
        whatsapp_hoy=whatsapp_hoy,
        whatsapp_preview=whatsapp_preview,
        email_asunto=email_asunto,
        email_html=email_html,
        email_cuerpo=email_cuerpo,
    )


@router.post("/preview", response_model=CampanaPreviewOut)
def preview_campana(
    body: CampanaFiltrosIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
):
    return _preview_payload(db, current_user, body)


@router.get("", response_model=list[CampanaListItemOut])
def listar_campanas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
    limit: int = Query(default=30, ge=1, le=100),
):
    rows = (
        db.query(CampanaWhatsApp)
        .filter(CampanaWhatsApp.tenant_id == current_user.tenant_id)
        .order_by(CampanaWhatsApp.created_at.desc())
        .limit(limit)
        .all()
    )
    return rows


@router.get("/{campana_id}", response_model=CampanaOut)
def get_campana(
    campana_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
):
    row = (
        db.query(CampanaWhatsApp)
        .filter(CampanaWhatsApp.id == campana_id, CampanaWhatsApp.tenant_id == current_user.tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Campaña no encontrada.")
    dests = (
        db.query(CampanaWhatsAppDestinatario)
        .filter(CampanaWhatsAppDestinatario.campana_id == row.id)
        .order_by(CampanaWhatsAppDestinatario.cliente_nombre.asc())
        .limit(TOPE_ENVIO)
        .all()
    )
    return _campana_out(row, dests)


@router.post("", response_model=CampanaOut, status_code=status.HTTP_201_CREATED)
def crear_campana(
    body: CampanaCrearIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    preview = _preview_payload(db, current_user, body)
    dests, omitidos, plantilla, categoria = armar_preview(
        db,
        tenant_id=current_user.tenant_id,
        filtros=body,
        sucursales_permitidas=_sucursales_filtro(db, current_user),
    )
    recortados = dests[:TOPE_ENVIO]
    if not recortados:
        raise HTTPException(
            status_code=400,
            detail="No hay destinatarios con habeas y un celular o correo válido. Ajuste filtros o el Excel.",
        )
    campana = CampanaWhatsApp(
        tenant_id=current_user.tenant_id,
        sucursal_id=body.sucursal_id or active_sucursal_id,
        creada_por=current_user.id,
        nombre=body.nombre.strip(),
        tipo=body.tipo,
        etiqueta=(body.etiqueta or "").strip() or None,
        estado="borrador",
        plantilla=plantilla,
        categoria_meta=categoria,
        filtros_json={
            "tipo": body.tipo,
            "sucursal_id": str(body.sucursal_id) if body.sucursal_id else None,
            "tipo_vehiculo": body.tipo_vehiculo,
            "dias_desde": body.dias_desde,
            "dias_hasta": body.dias_hasta,
            "meses_inactivo": body.meses_inactivo,
            "etiqueta": body.etiqueta,
            "omitidos": omitidos + preview.omitidos,
        },
        email_asunto=(body.email_asunto or "").strip() or preview.email_asunto or None,
        email_cuerpo=(body.email_cuerpo or "").strip() or preview.email_cuerpo or None,
        total_destinatarios=len(recortados),
    )
    db.add(campana)
    db.flush()
    for item in recortados:
        db.add(
            CampanaWhatsAppDestinatario(
                campana_id=campana.id,
                tenant_id=current_user.tenant_id,
                vehiculo_id=item.vehiculo_id,
                destino_e164=item.destino_e164,
                cliente_nombre=item.cliente_nombre,
                placa=item.placa,
                cliente_email=getattr(item, "cliente_email", None),
                opt_in_tipo=item.opt_in_tipo,
                motivo=item.motivo,
                estado="pendiente",
            )
        )
    db.commit()
    db.refresh(campana)
    dests = (
        db.query(CampanaWhatsAppDestinatario)
        .filter(CampanaWhatsAppDestinatario.campana_id == campana.id)
        .order_by(CampanaWhatsAppDestinatario.cliente_nombre.asc())
        .limit(TOPE_ENVIO)
        .all()
    )
    return _campana_out(campana, dests)


@router.post("/{campana_id}/enviar", response_model=CampanaEnviarOut)
def enviar_campana(
    campana_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
):
    campana = (
        db.query(CampanaWhatsApp)
        .filter(CampanaWhatsApp.id == campana_id, CampanaWhatsApp.tenant_id == current_user.tenant_id)
        .first()
    )
    if campana is None:
        raise HTTPException(status_code=404, detail="Campaña no encontrada.")
    if campana.estado == "enviada" and int(campana.enviados_ok or 0) > 0:
        raise HTTPException(status_code=400, detail="Esta campaña ya se envió.")
    if campana.estado == "enviando" and (int(campana.enviados_ok or 0) + int(campana.enviados_fail or 0)) > 0:
        raise HTTPException(status_code=400, detail="Esta campaña ya se está enviando.")
    if int(campana.total_destinatarios or 0) > TOPE_ENVIO:
        raise HTTPException(status_code=400, detail=f"Tope de {TOPE_ENVIO} mensajes por envío.")
    settings_row = (
        db.query(TenantWhatsAppSettings).filter(TenantWhatsAppSettings.tenant_id == current_user.tenant_id).first()
    )
    canal_ok, _canal_motivo = canal_campana_listo(settings_row)
    dests_envio = (
        db.query(CampanaWhatsAppDestinatario)
        .filter(CampanaWhatsAppDestinatario.campana_id == campana.id)
        .all()
    )
    con_correo = sum(1 for d in dests_envio if destinatario_tiene_correo(d))
    puede, motivo_envio = campana_puede_enviarse(whatsapp_listo=canal_ok, con_correo=con_correo)
    if not puede:
        raise HTTPException(status_code=400, detail=motivo_envio or "No hay canal para enviar.")
    ventana_ok, ventana_motivo = ventana_ley_2300()
    if not ventana_ok:
        raise HTTPException(status_code=400, detail=ventana_motivo or "Fuera de horario.")
    db.query(CampanaWhatsAppDestinatario).filter(
        CampanaWhatsAppDestinatario.campana_id == campana.id,
        CampanaWhatsAppDestinatario.estado.in_(("pendiente", "fail")),
    ).update(
        {
            "estado": "pendiente",
            "error": None,
            "estado_whatsapp": "pendiente",
            "estado_correo": "pendiente",
            "error_whatsapp": None,
            "error_correo": None,
        },
        synchronize_session=False,
    )
    campana.enviados_ok = 0
    campana.enviados_fail = 0
    campana.estado = "enviando"
    campana.sent_at = utcnow_naive()
    campana.error = None
    db.commit()

    total = int(campana.total_destinatarios or 0)
    if total <= 20:
        try:
            procesar_envio_campana(db, campana.id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"No se pudo enviar: {exc}") from exc
        db.refresh(campana)
        if int(campana.enviados_ok or 0) == 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    campana.error
                    or (
                        "WhatsApp rechazó el envío. Revise Activity en 360dialog."
                        if canal_ok
                        else "El correo no salió. Revise que los destinatarios tengan email."
                    )
                )[:500],
            )
        if canal_ok:
            mensaje = (
                f"Enviados {campana.enviados_ok} de {total} por WhatsApp "
                "(y correo si el destinatario tenía email). "
                + (f"Fallaron {campana.enviados_fail}." if int(campana.enviados_fail or 0) else "Meta cobra el WhatsApp.")
            )
        else:
            fallos = int(campana.enviados_fail or 0)
            mensaje = (
                f"Enviados {campana.enviados_ok} de {total} por correo. "
                "WhatsApp no está conectado en este CDA."
                + (f" {fallos} sin correo o no salieron." if fallos else "")
            )
        return CampanaEnviarOut(
            id=campana.id,
            estado=campana.estado,
            total_destinatarios=total,
            message=mensaje,
        )

    def _job(cid: UUID = campana.id) -> None:
        from app.db.database import SessionLocal

        session = SessionLocal()
        try:
            procesar_envio_campana(session, cid)
        finally:
            session.close()

    background_tasks.add_task(_job)
    return CampanaEnviarOut(
        id=campana.id,
        estado="enviando",
        total_destinatarios=int(campana.total_destinatarios or 0),
        message=(
            f"Se van a enviar {campana.total_destinatarios} mensajes. Meta los cobra al WhatsApp de este CDA."
            if canal_ok
            else (
                f"Se van a enviar {campana.total_destinatarios} correos. "
                "WhatsApp no está conectado en este CDA."
            )
        ),
    )


@router.post("/grok-texto", response_model=CampanaGrokOut)
def proponer_texto_campana(
    body: CampanaGrokIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    from app.models.tenant import Tenant

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (tenant.nombre_comercial if tenant else None) or (tenant.nombre if tenant else None) or "CDA"
    cuerpo = (body.plantilla_cuerpo or "").strip() or cuerpo_plantilla_campana(body.tipo)
    pack = plantilla_por_evento(
        "rtm" if body.tipo == "por_vencer" else ("campana_inactivos" if body.tipo == "inactivos" else "campana_temporada")
    )
    if not grok_disponible():
        raise HTTPException(status_code=400, detail="El Asistente CDASoft no está configurado en el servidor.")
    texto, uso = redactar_campana(
        nombre_cda=nombre_cda,
        tipo=body.tipo,
        etiqueta=body.etiqueta,
        cuerpo_plantilla=cuerpo or (pack["cuerpo"] if pack else ""),
    )
    billed = bool(texto)
    guardar_metrica_grok_tarjeta(
        db,
        tenant_id=current_user.tenant_id,
        sucursal_id=active_sucursal_id,
        usuario_id=current_user.id,
        status="success" if texto else "error",
        encontrado=bool(texto),
        billed=billed,
        origen="campana",
        modelo=(uso or {}).get("modelo"),
        prompt_tokens=int((uso or {}).get("prompt_tokens") or 0),
        completion_tokens=int((uso or {}).get("completion_tokens") or 0),
        error_detail=None if texto else "El Asistente CDASoft no devolvió texto",
    )
    if not texto:
        raise HTTPException(status_code=502, detail="No se pudo proponer el texto. Use la plantilla Meta.")
    return CampanaGrokOut(texto=texto, origen="campana")


@router.post("/preview-correo", response_model=CampanaCorreoRenderOut)
def preview_correo_campana(
    body: CampanaCorreoRenderIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = formatear_nombre_comercial(
        (tenant.nombre_comercial if tenant else None) or (tenant.nombre if tenant else None),
        "CDA",
    )
    agendar_url = enlace_agendar_publico((tenant.slug if tenant else "") or "")
    from types import SimpleNamespace

    dest = SimpleNamespace(
        cliente_nombre=(body.nombre_muestra or "").strip() or "Cliente",
        placa=(body.placa_muestra or "").strip() or None,
        motivo=(body.motivo_muestra or "").strip() or (body.etiqueta or ""),
    )
    _wa, asunto, html_cuerpo, cuerpo = preview_canales_campana(
        tipo=body.tipo,
        etiqueta=body.etiqueta,
        dest=dest,
        nombre_cda=nombre_cda,
        agendar_url=agendar_url,
        asunto_libre=body.email_asunto,
        cuerpo_libre=body.email_cuerpo,
    )
    return CampanaCorreoRenderOut(email_asunto=asunto, email_html=html_cuerpo, email_cuerpo=cuerpo)


@router.post("/grok-correo", response_model=CampanaCorreoGrokOut)
def proponer_correo_campana(
    body: CampanaCorreoGrokIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_comunicaciones),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    if not grok_disponible():
        raise HTTPException(status_code=400, detail="El Asistente CDASoft no está configurado en el servidor.")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (tenant.nombre_comercial if tenant else None) or (tenant.nombre if tenant else None) or "CDA"
    parsed, uso = redactar_correo_campana(
        nombre_cda=nombre_cda,
        tipo=body.tipo,
        etiqueta=body.etiqueta,
        notas=body.notas,
        cuerpo_actual=body.cuerpo_actual,
    )
    billed = bool(parsed)
    guardar_metrica_grok_tarjeta(
        db,
        tenant_id=current_user.tenant_id,
        sucursal_id=active_sucursal_id,
        usuario_id=current_user.id,
        status="success" if parsed else "error",
        encontrado=bool(parsed),
        billed=billed,
        origen="campana",
        modelo=(uso or {}).get("modelo"),
        prompt_tokens=int((uso or {}).get("prompt_tokens") or 0),
        completion_tokens=int((uso or {}).get("completion_tokens") or 0),
        error_detail=None if parsed else "El Asistente CDASoft no devolvió el correo",
    )
    if not parsed:
        raise HTTPException(status_code=502, detail="No se pudo redactar el correo. Escríbalo usted y use Ver carta.")
    asunto, cuerpo = parsed
    return CampanaCorreoGrokOut(asunto=asunto, cuerpo=cuerpo, origen="campana")
