"""Métricas Grok (xAI, pago CDASoft) y volumen de WhatsApp enviados (no factura Meta)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from app.api.v1.endpoints.runt_metricas import _as_naive_utc, _iso_utc_z, _window
from app.core.deps import get_db, require_saas_role
from app.models.grok_tarjeta_metrica import GrokTarjetaMetrica
from app.models.saas_user import SaaSUser
from app.models.tenant import Tenant
from app.models.whatsapp import TenantWhatsAppEnvio, TenantWhatsAppMensaje

router = APIRouter()

ORIGENES_GROK = {"tarjeta", "whatsapp"}
EVENTO_LABEL = {
    "bienvenida": "Bienvenida",
    "caja": "Pase a caja",
    "recibo": "Recibo",
    "recibo_fe": "Factura electrónica",
    "cita": "Cita confirmada",
    "cita_recordatorio": "Recordatorio de cita",
    "rtm": "RTM por vencer",
    "rtm_vencida": "RTM vencida",
    "preventiva": "Preventiva",
    "preventiva_vencida": "Preventiva vencida",
    "reinspeccion": "Reinspección",
    "aprobado": "Aprobado",
    "calidad": "Encuesta de calidad",
    "asistente": "Asistente (respuesta)",
}


def _rango(days: int, from_date: datetime | None, to_date: datetime | None) -> tuple[datetime, datetime, bool]:
    custom_range = from_date is not None or to_date is not None
    if custom_range:
        end_dt = _as_naive_utc(to_date) or datetime.now(timezone.utc).replace(tzinfo=None)
        start_dt = _as_naive_utc(from_date) or (end_dt - timedelta(days=30))
        if start_dt > end_dt:
            raise HTTPException(status_code=400, detail="from_date no puede ser mayor que to_date")
        return start_dt, end_dt, True
    start_dt, end_dt = _window(days)
    return start_dt, end_dt, False


@router.get("/summary")
def resumen_metricas_grok_tarjeta(
    days: int = Query(default=30, ge=0, le=365),
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    tenant_id: Optional[UUID] = Query(default=None),
    origen: Optional[str] = Query(default=None, description="tarjeta | whatsapp; vacío = todos"),
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    _ = current_user
    start_dt, end_dt, custom_range = _rango(days, from_date, to_date)
    origen_n = (origen or "").strip().lower() or None
    if origen_n and origen_n not in ORIGENES_GROK:
        raise HTTPException(status_code=400, detail="origen debe ser tarjeta o whatsapp")

    periodo = [
        GrokTarjetaMetrica.created_at >= start_dt,
        GrokTarjetaMetrica.created_at <= end_dt,
    ]
    if tenant_id is not None:
        periodo.append(GrokTarjetaMetrica.tenant_id == tenant_id)
    base = list(periodo)
    if origen_n:
        base.append(GrokTarjetaMetrica.origen == origen_n)

    total = db.query(func.count(GrokTarjetaMetrica.id)).filter(and_(*base)).scalar() or 0
    success = (
        db.query(func.count(GrokTarjetaMetrica.id))
        .filter(and_(*base, GrokTarjetaMetrica.status == "success"))
        .scalar()
        or 0
    )
    empty = (
        db.query(func.count(GrokTarjetaMetrica.id))
        .filter(and_(*base, GrokTarjetaMetrica.status == "empty"))
        .scalar()
        or 0
    )
    error = (
        db.query(func.count(GrokTarjetaMetrica.id))
        .filter(and_(*base, GrokTarjetaMetrica.status == "error"))
        .scalar()
        or 0
    )
    billed_count = (
        db.query(func.count(GrokTarjetaMetrica.id))
        .filter(and_(*base, GrokTarjetaMetrica.billed == True))  # noqa: E712
        .scalar()
        or 0
    )
    total_cost = (
        db.query(func.coalesce(func.sum(GrokTarjetaMetrica.estimated_cost_cop), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    total_cost_usd = (
        db.query(func.coalesce(func.sum(GrokTarjetaMetrica.estimated_cost_usd), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    prompt_tokens = (
        db.query(func.coalesce(func.sum(GrokTarjetaMetrica.prompt_tokens), 0))
        .filter(and_(*base))
        .scalar()
        or 0
    )
    completion_tokens = (
        db.query(func.coalesce(func.sum(GrokTarjetaMetrica.completion_tokens), 0))
        .filter(and_(*base))
        .scalar()
        or 0
    )
    avg_fx = (
        db.query(func.coalesce(func.avg(GrokTarjetaMetrica.fx_rate_usd_cop_applied), 0))
        .filter(and_(*base, GrokTarjetaMetrica.fx_rate_usd_cop_applied > 0))
        .scalar()
        or Decimal("0")
    )
    billed_n = int(billed_count)
    avg_cop = (Decimal(str(total_cost)) / billed_n).quantize(Decimal("0.01")) if billed_n else Decimal("0")
    avg_usd = (
        (Decimal(str(total_cost_usd)) / billed_n).quantize(Decimal("0.000001")) if billed_n else Decimal("0")
    )
    leidas_pct = round((int(success) * 100.0 / int(total)), 1) if int(total) else 0.0

    fotos_count = (
        db.query(func.count(GrokTarjetaMetrica.id))
        .filter(and_(*base, GrokTarjetaMetrica.origen == "tarjeta"))
        .scalar()
        or 0
    )
    whatsapp_count = (
        db.query(func.count(GrokTarjetaMetrica.id))
        .filter(and_(*base, GrokTarjetaMetrica.origen == "whatsapp"))
        .scalar()
        or 0
    )

    origen_agg = (
        db.query(
            GrokTarjetaMetrica.origen,
            func.count(GrokTarjetaMetrica.id).label("usos"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.status == "success", 1), else_=0)), 0).label("exito"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.status == "empty", 1), else_=0)), 0).label("vacios"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.status == "error", 1), else_=0)), 0).label("errores"),
            func.coalesce(func.sum(GrokTarjetaMetrica.estimated_cost_cop), 0).label("costo_cop"),
            func.coalesce(func.sum(GrokTarjetaMetrica.estimated_cost_usd), 0).label("costo_usd"),
        )
        .filter(and_(*base))
        .group_by(GrokTarjetaMetrica.origen)
        .all()
    )
    by_origen = [
        {
            "origen": r.origen or "tarjeta",
            "usos": int(r.usos or 0),
            "exito": int(r.exito or 0),
            "vacios": int(r.vacios or 0),
            "errores": int(r.errores or 0),
            "costo_estimado_cop": float(r.costo_cop or 0),
            "costo_estimado_usd": float(r.costo_usd or 0),
        }
        for r in origen_agg
    ]

    tenant_agg = (
        db.query(
            Tenant.slug,
            Tenant.nombre_comercial,
            func.count(GrokTarjetaMetrica.id).label("usos"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.origen == "tarjeta", 1), else_=0)), 0).label("fotos"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.origen == "whatsapp", 1), else_=0)), 0).label("whatsapp"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.status == "success", 1), else_=0)), 0).label("leidas"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.status == "empty", 1), else_=0)), 0).label("no_leidas"),
            func.coalesce(func.sum(case((GrokTarjetaMetrica.status == "error", 1), else_=0)), 0).label("errores"),
            func.coalesce(func.sum(GrokTarjetaMetrica.estimated_cost_cop), 0).label("costo_cop"),
            func.coalesce(func.sum(GrokTarjetaMetrica.estimated_cost_usd), 0).label("costo_usd"),
        )
        .select_from(GrokTarjetaMetrica)
        .join(Tenant, Tenant.id == GrokTarjetaMetrica.tenant_id)
        .filter(and_(*base))
        .group_by(Tenant.slug, Tenant.nombre_comercial)
        .order_by(func.count(GrokTarjetaMetrica.id).desc())
        .all()
    )

    by_tenant = [
        {
            "tenant_slug": r.slug,
            "tenant_nombre": r.nombre_comercial or r.slug,
            "usos": int(r.usos or 0),
            "fotos": int(r.fotos or 0),
            "whatsapp": int(r.whatsapp or 0),
            "leidas": int(r.leidas or 0),
            "no_leidas": int(r.no_leidas or 0),
            "errores": int(r.errores or 0),
            "costo_estimado_cop": float(r.costo_cop or 0),
            "costo_estimado_usd": float(r.costo_usd or 0),
        }
        for r in tenant_agg
    ]

    return {
        "periodo_dias": int(days) if not custom_range else None,
        "from_date": _iso_utc_z(start_dt),
        "to_date": _iso_utc_z(end_dt),
        "origen_filter": origen_n,
        "total_usos": int(total),
        "total_fotos": int(fotos_count),
        "whatsapp_count": int(whatsapp_count),
        "leidas_count": int(success),
        "no_leidas_count": int(empty),
        "error_count": int(error),
        "billed_count": billed_n,
        "leidas_pct": leidas_pct,
        "costo_estimado_total_cop": float(total_cost),
        "costo_estimado_total_usd": float(total_cost_usd),
        "costo_promedio_cop": float(avg_cop),
        "costo_promedio_usd": float(avg_usd),
        "prompt_tokens": int(prompt_tokens or 0),
        "completion_tokens": int(completion_tokens or 0),
        "fx_rate_avg_usd_cop": float(avg_fx),
        "tenant_id_filter": str(tenant_id) if tenant_id else None,
        "by_origen": by_origen,
        "by_tenant": by_tenant,
        "generated_at": _iso_utc_z(datetime.now(timezone.utc).replace(tzinfo=None)),
        "nota": "Estimado con tarifas xAI y TRM de CDASoft. No es la factura de xAI ni de Meta.",
    }


@router.get("/whatsapp-envios")
def resumen_whatsapp_envios(
    days: int = Query(default=30, ge=0, le=365),
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    tenant_id: Optional[UUID] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    """Volumen de WhatsApp enviados. No incluye costo Meta (lo paga el CDA)."""
    _ = current_user
    start_dt, end_dt, custom_range = _rango(days, from_date, to_date)
    env_base = [
        TenantWhatsAppEnvio.created_at >= start_dt,
        TenantWhatsAppEnvio.created_at <= end_dt,
    ]
    msg_base = [
        TenantWhatsAppMensaje.created_at >= start_dt,
        TenantWhatsAppMensaje.created_at <= end_dt,
        TenantWhatsAppMensaje.direccion == "out",
    ]
    if tenant_id is not None:
        env_base.append(TenantWhatsAppEnvio.tenant_id == tenant_id)
        msg_base.append(TenantWhatsAppMensaje.tenant_id == tenant_id)

    enviados_ok = (
        db.query(func.count(TenantWhatsAppEnvio.id))
        .filter(and_(*env_base, TenantWhatsAppEnvio.estado == "ok"))
        .scalar()
        or 0
    )
    fallidos = (
        db.query(func.count(TenantWhatsAppEnvio.id))
        .filter(and_(*env_base, TenantWhatsAppEnvio.estado != "ok"))
        .scalar()
        or 0
    )
    asistente = db.query(func.count(TenantWhatsAppMensaje.id)).filter(and_(*msg_base)).scalar() or 0

    evento_agg = (
        db.query(
            TenantWhatsAppEnvio.evento,
            func.coalesce(func.sum(case((TenantWhatsAppEnvio.estado == "ok", 1), else_=0)), 0).label("ok"),
            func.coalesce(func.sum(case((TenantWhatsAppEnvio.estado != "ok", 1), else_=0)), 0).label("fail"),
        )
        .filter(and_(*env_base))
        .group_by(TenantWhatsAppEnvio.evento)
        .order_by(func.count(TenantWhatsAppEnvio.id).desc())
        .all()
    )
    by_evento = [
        {
            "evento": r.evento,
            "label": EVENTO_LABEL.get(r.evento or "", r.evento or "otro"),
            "enviados_ok": int(r.ok or 0),
            "fallidos": int(r.fail or 0),
        }
        for r in evento_agg
    ]
    if int(asistente):
        by_evento.append(
            {
                "evento": "asistente",
                "label": EVENTO_LABEL["asistente"],
                "enviados_ok": int(asistente),
                "fallidos": 0,
            }
        )
        by_evento.sort(key=lambda row: row["enviados_ok"], reverse=True)

    tenant_env = (
        db.query(
            Tenant.slug,
            Tenant.nombre_comercial,
            func.coalesce(func.sum(case((TenantWhatsAppEnvio.estado == "ok", 1), else_=0)), 0).label("ok"),
            func.coalesce(func.sum(case((TenantWhatsAppEnvio.estado != "ok", 1), else_=0)), 0).label("fail"),
        )
        .select_from(TenantWhatsAppEnvio)
        .join(Tenant, Tenant.id == TenantWhatsAppEnvio.tenant_id)
        .filter(and_(*env_base))
        .group_by(Tenant.slug, Tenant.nombre_comercial)
        .all()
    )
    tenant_msg = (
        db.query(
            Tenant.slug,
            Tenant.nombre_comercial,
            func.count(TenantWhatsAppMensaje.id).label("asistente"),
        )
        .select_from(TenantWhatsAppMensaje)
        .join(Tenant, Tenant.id == TenantWhatsAppMensaje.tenant_id)
        .filter(and_(*msg_base))
        .group_by(Tenant.slug, Tenant.nombre_comercial)
        .all()
    )
    merged: dict[str, dict] = {}
    for r in tenant_env:
        merged[r.slug] = {
            "tenant_slug": r.slug,
            "tenant_nombre": r.nombre_comercial or r.slug,
            "enviados_ok": int(r.ok or 0),
            "fallidos": int(r.fail or 0),
            "asistente": 0,
        }
    for r in tenant_msg:
        row = merged.setdefault(
            r.slug,
            {
                "tenant_slug": r.slug,
                "tenant_nombre": r.nombre_comercial or r.slug,
                "enviados_ok": 0,
                "fallidos": 0,
                "asistente": 0,
            },
        )
        row["asistente"] = int(r.asistente or 0)
        if r.nombre_comercial:
            row["tenant_nombre"] = r.nombre_comercial
    by_tenant = []
    for row in merged.values():
        row["total_enviados"] = int(row["enviados_ok"]) + int(row["asistente"])
        by_tenant.append(row)
    by_tenant.sort(key=lambda x: x["total_enviados"], reverse=True)

    return {
        "periodo_dias": int(days) if not custom_range else None,
        "from_date": _iso_utc_z(start_dt),
        "to_date": _iso_utc_z(end_dt),
        "enviados_ok": int(enviados_ok),
        "fallidos": int(fallidos),
        "asistente": int(asistente),
        "total_enviados": int(enviados_ok) + int(asistente),
        "tenant_id_filter": str(tenant_id) if tenant_id else None,
        "by_evento": by_evento,
        "by_tenant": by_tenant,
        "generated_at": _iso_utc_z(datetime.now(timezone.utc).replace(tzinfo=None)),
        "nota": "Plantillas + respuestas del asistente. El CDA paga Meta; aquí solo se cuenta volumen.",
    }
