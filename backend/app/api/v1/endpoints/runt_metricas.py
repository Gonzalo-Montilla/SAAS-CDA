"""
Métricas de consultas RUNT por proveedor (admin/contador).
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, case
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_saas_role
from app.models.saas_user import SaaSUser
from app.models.tenant import Tenant
from app.models.runt_metrica import RuntConsultaMetrica

router = APIRouter()


def _window(days: int) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc).replace(tzinfo=None)
    if int(days) == 0:
        start = end.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = end - timedelta(days=days)
    return start, end


@router.get("/summary")
def resumen_metricas_runt(
    days: int = Query(default=30, ge=0, le=365),
    tenant_id: Optional[UUID] = Query(default=None),
    sucursal_id: Optional[UUID] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(require_saas_role(["owner", "finanzas", "comercial", "soporte"])),
):
    start_dt, end_dt = _window(days)
    base = [
        RuntConsultaMetrica.created_at >= start_dt,
        RuntConsultaMetrica.created_at <= end_dt,
    ]
    if tenant_id is not None:
        base.append(RuntConsultaMetrica.tenant_id == tenant_id)
    if sucursal_id is not None:
        base.append(RuntConsultaMetrica.sucursal_id == sucursal_id)

    # Regla de negocio vigente:
    # si PlacaAPI no resuelve y entra fallback a Verifik, no hay costo extra de PlacaAPI.
    # Esta normalización también corrige métricas históricas guardadas con lógica anterior.
    placaapi_fallback_to_verifik = and_(
        RuntConsultaMetrica.provider_configured == "placaapi",
        RuntConsultaMetrica.fallback_used == True,
        RuntConsultaMetrica.provider_resolved == "verifik",
    )
    fallback_extra_cost_cop_effective = case(
        (placaapi_fallback_to_verifik, 0),
        else_=RuntConsultaMetrica.fallback_extra_cost_cop,
    )
    fallback_extra_cost_usd_effective = case(
        (placaapi_fallback_to_verifik, 0),
        else_=RuntConsultaMetrica.fallback_extra_cost_usd,
    )
    estimated_cost_cop_effective = case(
        (
            placaapi_fallback_to_verifik,
            func.greatest(
                RuntConsultaMetrica.estimated_cost_cop - RuntConsultaMetrica.fallback_extra_cost_cop,
                0,
            ),
        ),
        else_=RuntConsultaMetrica.estimated_cost_cop,
    )
    estimated_cost_usd_effective = case(
        (
            placaapi_fallback_to_verifik,
            func.greatest(
                RuntConsultaMetrica.estimated_cost_usd - RuntConsultaMetrica.fallback_extra_cost_usd,
                0,
            ),
        ),
        else_=RuntConsultaMetrica.estimated_cost_usd,
    )
    # "Resuelto" siempre debe reflejar el costo del proveedor que resolvió.
    # No se descuenta fallback aquí.
    resolved_cost_cop_effective = RuntConsultaMetrica.resolved_cost_cop
    resolved_cost_usd_effective = RuntConsultaMetrica.resolved_cost_usd

    total = db.query(func.count(RuntConsultaMetrica.id)).filter(and_(*base)).scalar() or 0
    success = (
        db.query(func.count(RuntConsultaMetrica.id))
        .filter(and_(*base, RuntConsultaMetrica.status == "success"))
        .scalar()
        or 0
    )
    empty = (
        db.query(func.count(RuntConsultaMetrica.id))
        .filter(and_(*base, RuntConsultaMetrica.status == "empty"))
        .scalar()
        or 0
    )
    error = (
        db.query(func.count(RuntConsultaMetrica.id))
        .filter(and_(*base, RuntConsultaMetrica.status == "error"))
        .scalar()
        or 0
    )
    fallback_count = (
        db.query(func.count(RuntConsultaMetrica.id))
        .filter(and_(*base, RuntConsultaMetrica.fallback_used == True))
        .scalar()
        or 0
    )
    total_cost = (
        db.query(func.coalesce(func.sum(estimated_cost_cop_effective), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    total_cost_usd = (
        db.query(func.coalesce(func.sum(estimated_cost_usd_effective), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    total_resolved_cost = (
        db.query(func.coalesce(func.sum(resolved_cost_cop_effective), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    total_resolved_cost_usd = (
        db.query(func.coalesce(func.sum(resolved_cost_usd_effective), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    total_fallback_extra_cost = (
        db.query(func.coalesce(func.sum(fallback_extra_cost_cop_effective), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    total_fallback_extra_cost_usd = (
        db.query(func.coalesce(func.sum(fallback_extra_cost_usd_effective), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )
    avg_fx = (
        db.query(func.coalesce(func.avg(RuntConsultaMetrica.fx_rate_usd_cop_applied), 0))
        .filter(and_(*base))
        .scalar()
        or Decimal("0")
    )

    provider_rows = (
        db.query(
            RuntConsultaMetrica.provider_resolved,
            func.count(RuntConsultaMetrica.id),
            func.coalesce(func.sum(estimated_cost_cop_effective), 0),
            func.coalesce(func.sum(estimated_cost_usd_effective), 0),
            func.coalesce(func.sum(resolved_cost_cop_effective), 0),
            func.coalesce(func.sum(resolved_cost_usd_effective), 0),
            func.coalesce(func.sum(fallback_extra_cost_cop_effective), 0),
            func.coalesce(func.sum(fallback_extra_cost_usd_effective), 0),
        )
        .filter(and_(*base))
        .group_by(RuntConsultaMetrica.provider_resolved)
        .all()
    )
    by_provider = [
        {
            "provider": (r[0] or "unknown"),
            "consultas": int(r[1] or 0),
            "costo_estimado_cop": float(r[2] or 0),
            "costo_estimado_usd": float(r[3] or 0),
            "costo_resuelto_cop": float(r[4] or 0),
            "costo_resuelto_usd": float(r[5] or 0),
            "costo_fallback_extra_cop": float(r[6] or 0),
            "costo_fallback_extra_usd": float(r[7] or 0),
        }
        for r in provider_rows
    ]

    tenant_rows = (
        db.query(
            Tenant.slug,
            Tenant.nombre_comercial,
            func.count(RuntConsultaMetrica.id),
            func.coalesce(func.sum(estimated_cost_cop_effective), 0),
            func.coalesce(func.sum(estimated_cost_usd_effective), 0),
            func.coalesce(func.sum(resolved_cost_cop_effective), 0),
            func.coalesce(func.sum(resolved_cost_usd_effective), 0),
            func.coalesce(
                func.sum(
                    case(
                        (
                            RuntConsultaMetrica.status == "success",
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            RuntConsultaMetrica.status == "empty",
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            RuntConsultaMetrica.status == "error",
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                RuntConsultaMetrica.provider_resolved == "placaapi",
                                RuntConsultaMetrica.status == "success",
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                RuntConsultaMetrica.provider_resolved == "placaapi",
                                RuntConsultaMetrica.status == "success",
                            ),
                            resolved_cost_cop_effective,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                RuntConsultaMetrica.provider_resolved == "placaapi",
                                RuntConsultaMetrica.status == "success",
                            ),
                            resolved_cost_usd_effective,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                RuntConsultaMetrica.provider_resolved == "verifik",
                                RuntConsultaMetrica.status == "success",
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                RuntConsultaMetrica.provider_resolved == "verifik",
                                RuntConsultaMetrica.status == "success",
                            ),
                            resolved_cost_cop_effective,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                RuntConsultaMetrica.provider_resolved == "verifik",
                                RuntConsultaMetrica.status == "success",
                            ),
                            resolved_cost_usd_effective,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .join(Tenant, Tenant.id == RuntConsultaMetrica.tenant_id)
        .filter(and_(*base))
        .group_by(Tenant.slug, Tenant.nombre_comercial)
        .order_by(func.count(RuntConsultaMetrica.id).desc())
        .limit(10)
        .all()
    )
    by_tenant = [
        {
            "tenant_slug": str(r[0] or ""),
            "tenant_nombre": str(r[1] or ""),
            "consultas": int(r[2] or 0),
            "costo_estimado_cop": float(r[3] or 0),
            "costo_estimado_usd": float(r[4] or 0),
            "costo_resuelto_cop": float(r[5] or 0),
            "costo_resuelto_usd": float(r[6] or 0),
            "resueltas": int(r[7] or 0),
            "empty_count": int(r[8] or 0),
            "error_count": int(r[9] or 0),
            "no_resueltas": max(int(r[2] or 0) - int(r[7] or 0), 0),
            "placaapi_resueltas": int(r[10] or 0),
            "placaapi_costo_resuelto_cop": float(r[11] or 0),
            "placaapi_costo_resuelto_usd": float(r[12] or 0),
            "verifik_resueltas": int(r[13] or 0),
            "verifik_costo_resuelto_cop": float(r[14] or 0),
            "verifik_costo_resuelto_usd": float(r[15] or 0),
        }
        for r in tenant_rows
    ]

    return {
        "periodo_dias": days,
        "total_consultas": int(total),
        "success_count": int(success),
        "empty_count": int(empty),
        "error_count": int(error),
        "fallback_count": int(fallback_count),
        "success_rate_pct": round((success / total) * 100, 2) if total else 0.0,
        "fallback_rate_pct": round((fallback_count / total) * 100, 2) if total else 0.0,
        "costo_estimado_total_cop": float(total_cost or 0),
        "costo_estimado_total_usd": float(total_cost_usd or 0),
        "costo_resuelto_total_cop": float(total_resolved_cost or 0),
        "costo_resuelto_total_usd": float(total_resolved_cost_usd or 0),
        "costo_fallback_extra_total_cop": float(total_fallback_extra_cost or 0),
        "costo_fallback_extra_total_usd": float(total_fallback_extra_cost_usd or 0),
        "costo_promedio_cop": round(float(total_cost or 0) / total, 2) if total else 0.0,
        "costo_promedio_usd": round(float(total_cost_usd or 0) / total, 6) if total else 0.0,
        "fx_rate_avg_usd_cop": float(avg_fx or 0),
        "by_provider": by_provider,
        "by_tenant": by_tenant,
        "tenant_id_filter": str(tenant_id) if tenant_id else None,
        "generated_by": current_user.email,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

