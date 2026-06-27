"""
Endpoints de Reportes - Dashboard General y Consolidados
"""
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_, cast, Date, String
from datetime import datetime, timedelta, date, time, timezone
from decimal import Decimal
from typing import Optional
from calendar import monthrange
from uuid import UUID
import uuid
from app.core.config import settings
from app.core.timezone_utils import get_app_timezone, zoneinfo_from_name
from app.core.deps import get_db, get_contador_or_admin
from app.core.sucursal_scope import resolve_reporte_sucursal_id, get_principal_sucursal_id
from app.models.usuario import Usuario
from app.models.caja import MovimientoCaja, Caja, EstadoCaja
from app.models.tesoreria import MovimientoTesoreria, TipoMovimientoTesoreria, CategoriaEgresoTesoreria
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo
from app.models.tarifa import Tarifa
from app.models.sucursal import Sucursal
from app.models.proveedor_catalogo import ProveedorCatalogo
from app.models.factus import DocumentoSoporteElectronico, FacturaElectronica, FacturaCorreccion
from app.models.iva_provision import IvaProvisionRegistro
from app.models.appointment import Appointment

router = APIRouter()
REPORT_TZ = get_app_timezone()


def _as_utc_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _as_report_tz(dt: Optional[datetime]) -> Optional[datetime]:
    utc_dt = _as_utc_aware(dt)
    if utc_dt is None:
        return None
    return utc_dt.astimezone(REPORT_TZ)


def _format_hms_report_tz(dt: Optional[datetime]) -> str:
    local_dt = _as_report_tz(dt)
    if local_dt is None:
        return "—"
    return local_dt.strftime("%H:%M:%S")


def _iso_utc(dt: Optional[datetime]) -> Optional[str]:
    utc_dt = _as_utc_aware(dt)
    if utc_dt is None:
        return None
    return utc_dt.isoformat()


def _vp_scope(tenant_id, scope_sid: Optional[UUID], *extra):
    cond = [VehiculoProceso.tenant_id == tenant_id, *extra]
    if scope_sid is not None:
        cond.append(VehiculoProceso.sucursal_id == scope_sid)
    return and_(*cond)


def _no_reinspeccion_exenta_clause():
    return or_(
        VehiculoProceso.reinspeccion_exenta.is_(False),
        VehiculoProceso.reinspeccion_exenta.is_(None),
    )


def _no_pruebas_auditoria_clause():
    return or_(
        VehiculoProceso.tipo_vehiculo.is_(None),
        VehiculoProceso.tipo_vehiculo != "pruebas_auditoria",
    )


def _mt_scope(tenant_id, scope_sid: Optional[UUID], *extra):
    cond = [
        MovimientoTesoreria.tenant_id == tenant_id,
        or_(MovimientoTesoreria.anulado == False, MovimientoTesoreria.anulado.is_(None)),
        *extra,
    ]
    if scope_sid is not None:
        cond.append(MovimientoTesoreria.sucursal_id == scope_sid)
    return and_(*cond)


def _mt_scope_incluye_anulados(tenant_id, scope_sid: Optional[UUID], *extra):
    """Listados donde conviene ver también movimientos anulados."""
    cond = [MovimientoTesoreria.tenant_id == tenant_id, *extra]
    if scope_sid is not None:
        cond.append(MovimientoTesoreria.sucursal_id == scope_sid)
    return and_(*cond)


def _mc_scope(db: Session, tenant_id, scope_sid: Optional[UUID], *extra):
    """
    Movimientos de caja visibles según sede del reporte.
    Coherente con el PDF de comprobante de egreso de caja: si el tenant tiene una sola
    sede activa, incluye cajas con sucursal_id NULL (datos previos a asignar sede).
    """
    cond = [
        MovimientoCaja.tenant_id == tenant_id,
        or_(MovimientoCaja.anulado == False, MovimientoCaja.anulado.is_(None)),
        *extra,
    ]
    if scope_sid is not None:
        n_sedes = (
            db.query(Sucursal)
            .filter(Sucursal.tenant_id == tenant_id, Sucursal.activa.is_(True))
            .count()
        )
        if n_sedes <= 1:
            caja_sede_clause = or_(Caja.sucursal_id == scope_sid, Caja.sucursal_id.is_(None))
        else:
            caja_sede_clause = Caja.sucursal_id == scope_sid
        cond.append(
            MovimientoCaja.caja_id.in_(
                db.query(Caja.id).filter(Caja.tenant_id == tenant_id, caja_sede_clause)
            )
        )
    return and_(*cond)


def _mc_scope_incluye_anulados(db: Session, tenant_id, scope_sid: Optional[UUID], *extra):
    """
    Movimientos de caja visibles según sede del reporte, incluyendo anulados.
    Útil para trazabilidad en reportes detallados de auditoría.
    """
    cond = [MovimientoCaja.tenant_id == tenant_id, *extra]
    if scope_sid is not None:
        n_sedes = (
            db.query(Sucursal)
            .filter(Sucursal.tenant_id == tenant_id, Sucursal.activa.is_(True))
            .count()
        )
        if n_sedes <= 1:
            caja_sede_clause = or_(Caja.sucursal_id == scope_sid, Caja.sucursal_id.is_(None))
        else:
            caja_sede_clause = Caja.sucursal_id == scope_sid
        cond.append(
            MovimientoCaja.caja_id.in_(
                db.query(Caja.id).filter(Caja.tenant_id == tenant_id, caja_sede_clause)
            )
        )
    return and_(*cond)


def resolve_report_date_window(
    *,
    fecha: Optional[date],
    fecha_inicio: Optional[date],
    fecha_fin: Optional[date],
) -> tuple[datetime, datetime, str]:
    """
    Resuelve ventana de fechas para reportes.
    Los límites del día calendario se interpretan en ``settings.TIMEZONE`` (p. ej. America/Bogota)
    y se convierten a UTC para comparar con ``created_at`` / timestamps almacenados en UTC.
    """
    if (fecha_inicio is None) != (fecha_fin is None):
        raise ValueError("Debes enviar fecha_inicio y fecha_fin juntos para usar modo rango")

    tz = get_app_timezone()

    def _local_day_to_utc_range(d: date) -> tuple[datetime, datetime]:
        start_local = datetime.combine(d, datetime.min.time(), tzinfo=tz)
        end_local = datetime.combine(d, datetime.max.time(), tzinfo=tz)
        start_utc = start_local.astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = end_local.astimezone(timezone.utc).replace(tzinfo=None)
        return start_utc, end_utc

    if fecha_inicio and fecha_fin:
        if fecha_inicio > fecha_fin:
            raise ValueError("fecha_inicio no puede ser mayor que fecha_fin")
        inicio_dt, _ = _local_day_to_utc_range(fecha_inicio)
        _, fin_dt = _local_day_to_utc_range(fecha_fin)
        label = f"{fecha_inicio.strftime('%Y-%m-%d')} a {fecha_fin.strftime('%Y-%m-%d')}"
        return inicio_dt, fin_dt, label

    fecha_base = fecha if fecha is not None else datetime.now(tz).date()
    inicio_dt, fin_dt = _local_day_to_utc_range(fecha_base)
    label = fecha_base.strftime("%Y-%m-%d")
    return inicio_dt, fin_dt, label


def _obtener_tarifa_referencia_para_vehiculo(
    db: Session,
    *,
    vehiculo: VehiculoProceso,
) -> Tarifa | None:
    if (vehiculo.tipo_vehiculo or "").strip().lower() == "preventiva":
        return None
    fecha_ref = (vehiculo.fecha_pago or vehiculo.fecha_registro or datetime.utcnow()).date()
    ano_ref = (vehiculo.fecha_pago or vehiculo.fecha_registro or datetime.utcnow()).year
    antiguedad = max(0, ano_ref - int(vehiculo.ano_modelo or ano_ref))

    def _buscar(ant: int) -> Tarifa | None:
        return (
            db.query(Tarifa)
            .filter(
                and_(
                    Tarifa.tenant_id == vehiculo.tenant_id,
                    Tarifa.tipo_vehiculo == vehiculo.tipo_vehiculo,
                    Tarifa.activa == True,
                    Tarifa.vigencia_inicio <= fecha_ref,
                    or_(Tarifa.vigencia_fin >= fecha_ref, Tarifa.vigencia_fin == None),
                    Tarifa.antiguedad_min <= ant,
                    or_(Tarifa.antiguedad_max == None, Tarifa.antiguedad_max >= ant),
                )
            )
            .first()
        )

    tarifa = _buscar(antiguedad)
    if tarifa is None and antiguedad == 0:
        tarifa = _buscar(1)
    return tarifa


def _calcular_iva_causado_vehiculo(
    db: Session,
    *,
    vehiculo: VehiculoProceso,
) -> tuple[Decimal, Decimal, Decimal, str]:
    base_snap = getattr(vehiculo, "iva_base_gravable_servicio", None)
    iva_snap = getattr(vehiculo, "iva_valor_servicio", None)
    excl_snap = getattr(vehiculo, "valor_excluido_servicio", None)
    if base_snap is not None and iva_snap is not None:
        return (
            Decimal(str(base_snap or 0)),
            Decimal(str(iva_snap or 0)),
            Decimal(str(excl_snap or 0)),
            "snapshot_venta",
        )

    monto_servicio = Decimal(str(vehiculo.valor_rtm or 0))
    if monto_servicio <= 0:
        return (Decimal("0"), Decimal("0"), Decimal("0"), "sin_servicio")

    if (vehiculo.tipo_vehiculo or "").strip().lower() == "preventiva":
        return (Decimal("0"), Decimal("0"), monto_servicio, "preventiva")

    tarifa = _obtener_tarifa_referencia_para_vehiculo(db, vehiculo=vehiculo)
    if tarifa is not None:
        suma_t = Decimal(str(tarifa.valor_rtm or 0)) + Decimal(str(tarifa.valor_terceros or 0))
        if abs(suma_t - monto_servicio) <= Decimal("1"):
            gravado = Decimal(str(tarifa.valor_rtm or 0))
            excluido = Decimal(str(tarifa.valor_terceros or 0))
            fuente = "tarifa_historica"
        else:
            gravado = monto_servicio
            excluido = Decimal("0")
            fuente = "estimado_total_gravado"
    else:
        gravado = monto_servicio
        excluido = Decimal("0")
        fuente = "estimado_total_gravado"

    iva_rate = Decimal(str(settings.FACTUS_IVA_PORCENTAJE_GENERAL or 19)) / Decimal("100")
    if gravado <= 0:
        return (Decimal("0"), Decimal("0"), excluido, fuente)
    base = (gravado / (Decimal("1") + iva_rate)).quantize(Decimal("0.01"))
    iva = (gravado - base).quantize(Decimal("0.01"))
    return (base, iva, excluido.quantize(Decimal("0.01")), fuente)


@router.get("/dashboard-general")
def obtener_dashboard_general(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    sucursal_id: Optional[UUID] = Query(None, description="Filtrar por sede (admin/contador)"),
    consolidar_todas: bool = Query(False, description="Incluir todas las sedes"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Dashboard General del CDA - Consolidado de todos los módulos
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    fecha_inicio, fecha_fin, etiqueta_fecha = resolve_report_date_window(
        fecha=fecha,
        fecha_inicio=None,
        fecha_fin=None,
    )
    fecha_base = datetime.strptime(etiqueta_fecha, "%Y-%m-%d").date()

    ingresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        _mc_scope(
            db,
            tid,
            scope_sid,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto > 0,
        )
    ).scalar() or Decimal(0)

    ingresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        _mt_scope(
            tid,
            scope_sid,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto > 0,
        )
    ).scalar() or Decimal(0)

    total_ingresos_dia = float(ingresos_caja + ingresos_tesoreria)

    egresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        _mc_scope(
            db,
            tid,
            scope_sid,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto < 0,
        )
    ).scalar() or Decimal(0)

    egresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        _mt_scope(
            tid,
            scope_sid,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto < 0,
        )
    ).scalar() or Decimal(0)

    total_egresos_dia = float(abs(egresos_caja + egresos_tesoreria))

    saldo_cajas = db.query(func.sum(MovimientoCaja.monto)).filter(
        _mc_scope(db, tid, scope_sid)
    ).scalar() or Decimal(0)

    saldo_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        _mt_scope(tid, scope_sid)
    ).scalar() or Decimal(0)

    saldo_total = float(saldo_cajas + saldo_tesoreria)

    tramites_dia = (
        db.query(func.count(VehiculoProceso.id))
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro >= fecha_inicio,
                VehiculoProceso.fecha_registro <= fecha_fin,
            )
        )
        .scalar()
        or 0
    )

    ingresos_7_dias = []
    for i in range(6, -1, -1):
        dia = fecha_base - timedelta(days=i)
        dia_inicio, dia_fin, _ = resolve_report_date_window(
            fecha=dia,
            fecha_inicio=None,
            fecha_fin=None,
        )

        ing_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= dia_inicio,
                MovimientoCaja.created_at <= dia_fin,
                MovimientoCaja.monto > 0,
            )
        ).scalar() or Decimal(0)

        ing_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= dia_inicio,
                MovimientoTesoreria.fecha_movimiento <= dia_fin,
                MovimientoTesoreria.monto > 0,
            )
        ).scalar() or Decimal(0)

        total_dia = float(ing_caja + ing_tesoreria)

        ingresos_7_dias.append(
            {
                "fecha": dia.strftime("%Y-%m-%d"),
                "dia_semana": dia.strftime("%a"),
                "ingresos": total_dia,
            }
        )

    desglose_modulos = {
        "caja": {
            "ingresos": float(ingresos_caja),
            "egresos": float(abs(egresos_caja)),
            "saldo": float(saldo_cajas),
        },
        "tesoreria": {
            "ingresos": float(ingresos_tesoreria),
            "egresos": float(abs(egresos_tesoreria)),
            "saldo": float(saldo_tesoreria),
        },
    }

    return {
        "fecha": fecha_base.strftime("%Y-%m-%d"),
        "resumen": {
            "total_ingresos_dia": total_ingresos_dia,
            "total_egresos_dia": total_egresos_dia,
            "utilidad_dia": total_ingresos_dia - total_egresos_dia,
            "saldo_total": saldo_total,
            "tramites_atendidos": tramites_dia,
        },
        "desglose_modulos": desglose_modulos,
        "grafica_ingresos_7_dias": ingresos_7_dias,
        "fecha_generacion": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/comparativo-sedes")
def comparativo_sedes(
    fecha: Optional[date] = Query(None, description="Día de referencia (default: hoy)"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Ranking simple por sede: trámites registrados e ingresos (caja+tesorería) en el día.
    """
    d0, d1, etiqueta_fecha = resolve_report_date_window(
        fecha=fecha,
        fecha_inicio=None,
        fecha_fin=None,
    )
    fecha_base = datetime.strptime(etiqueta_fecha, "%Y-%m-%d").date()
    tid = current_user.tenant_id

    sedes = db.query(Sucursal).filter(Sucursal.tenant_id == tid, Sucursal.activa.is_(True)).all()
    filas = []
    for s in sedes:
        sid = s.id
        tramites = (
            db.query(func.count(VehiculoProceso.id))
            .filter(
                VehiculoProceso.tenant_id == tid,
                VehiculoProceso.sucursal_id == sid,
                VehiculoProceso.fecha_registro >= d0,
                VehiculoProceso.fecha_registro <= d1,
            )
            .scalar()
            or 0
        )
        ing_caja = (
            db.query(func.sum(MovimientoCaja.monto))
            .filter(
                _mc_scope(
                    db,
                    tid,
                    sid,
                    MovimientoCaja.created_at >= d0,
                    MovimientoCaja.created_at <= d1,
                    MovimientoCaja.monto > 0,
                )
            )
            .scalar()
            or Decimal(0)
        )
        ing_teso = (
            db.query(func.sum(MovimientoTesoreria.monto))
            .filter(
                _mt_scope(
                    tid,
                    sid,
                    MovimientoTesoreria.fecha_movimiento >= d0,
                    MovimientoTesoreria.fecha_movimiento <= d1,
                    MovimientoTesoreria.monto > 0,
                )
            )
            .scalar()
            or Decimal(0)
        )
        filas.append(
            {
                "sucursal_id": str(s.id),
                "nombre": s.nombre,
                "tramites_registrados": int(tramites),
                "ingresos_caja": float(ing_caja),
                "ingresos_tesoreria": float(ing_teso),
                "ingresos_total": float(ing_caja + ing_teso),
            }
        )
    filas.sort(key=lambda x: x["ingresos_total"], reverse=True)
    return {"fecha": etiqueta_fecha, "sedes": filas}


@router.get("/dashboard-operativo")
def obtener_dashboard_operativo(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Dashboard operativo:
    - Colas actuales por estado de operación.
    - SLA de atención (registro -> pago).
    - Casos más antiguos para priorización.
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)

    base_periodo_q = db.query(VehiculoProceso).filter(
        _vp_scope(
            tid,
            scope_sid,
            VehiculoProceso.fecha_registro >= fecha_inicio_dt,
            VehiculoProceso.fecha_registro <= fecha_fin_dt,
        )
    )

    total_ingresados = base_periodo_q.count()

    pagados_periodo_all = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
            )
        )
        .all()
    )
    pagados_periodo = [
        v
        for v in pagados_periodo_all
        if not bool(getattr(v, "reinspeccion_exenta", False))
        and str(getattr(v, "tipo_vehiculo", "") or "").strip().lower() != "pruebas_auditoria"
    ]
    reintentos_validados_periodo = [v for v in pagados_periodo_all if bool(getattr(v, "reinspeccion_exenta", False))]

    # SLA registro -> pago (minutos).
    tiempos_minutos = []
    for row in pagados_periodo:
        if row.fecha_registro and row.fecha_pago and row.fecha_pago >= row.fecha_registro:
            delta_min = (row.fecha_pago - row.fecha_registro).total_seconds() / 60
            tiempos_minutos.append(delta_min)
    tiempos_minutos.sort()

    def percentile(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        idx = int((len(values) - 1) * p)
        return round(values[idx], 2)

    promedio_min = round(sum(tiempos_minutos) / len(tiempos_minutos), 2) if tiempos_minutos else 0.0
    p50_min = percentile(tiempos_minutos, 0.5)
    p90_min = percentile(tiempos_minutos, 0.9)
    cumplimiento_objetivo_30m = (
        round((sum(1 for t in tiempos_minutos if t <= 30) / len(tiempos_minutos)) * 100, 2)
        if tiempos_minutos
        else 0.0
    )

    cola_registrado_q = db.query(VehiculoProceso).filter(
        _vp_scope(tid, scope_sid, VehiculoProceso.estado == EstadoVehiculo.REGISTRADO)
    )
    cola_pagado_q = db.query(VehiculoProceso).filter(
        _vp_scope(
            tid,
            scope_sid,
            VehiculoProceso.estado == EstadoVehiculo.PAGADO,
            VehiculoProceso.certificado_entregado_at.is_(None),
        )
    )
    cola_en_pista_q = db.query(VehiculoProceso).filter(
        _vp_scope(
            tid,
            scope_sid,
            VehiculoProceso.estado == EstadoVehiculo.EN_PISTA,
            VehiculoProceso.certificado_entregado_at.is_(None),
        )
    )

    pendientes_caja = cola_registrado_q.count()
    pendientes_pista = cola_pagado_q.count()
    en_pista = cola_en_pista_q.count()

    # Casos en riesgo por antigüedad en cola de caja.
    oldest_registrados = (
        cola_registrado_q.order_by(VehiculoProceso.fecha_registro.asc()).limit(8).all()
    )
    casos_en_riesgo = []
    for row in oldest_registrados:
        wait_min = max(int((now_ts - row.fecha_registro.replace(tzinfo=None)).total_seconds() // 60), 0)
        casos_en_riesgo.append(
            {
                "id": str(row.id),
                "placa": row.placa,
                "cliente": row.cliente_nombre,
                "estado": row.estado.value,
                "minutos_espera": wait_min,
            }
        )

    max_espera_caja_min = max((c["minutos_espera"] for c in casos_en_riesgo), default=0)

    terminados_periodo = base_periodo_q.filter(
        VehiculoProceso.estado.in_(
            [EstadoVehiculo.APROBADO, EstadoVehiculo.RECHAZADO, EstadoVehiculo.COMPLETADO]
        )
    ).count()

    return {
        "periodo": etiqueta_fecha,
        "resumen_operativo": {
            "ingresados_periodo": total_ingresados,
            "pagados_periodo": len(pagados_periodo),
            "reintentos_validados_periodo": len(reintentos_validados_periodo),
            "terminados_periodo": terminados_periodo,
            "pendientes_caja": pendientes_caja,
            "pendientes_pista": pendientes_pista,
            "en_pista": en_pista,
            "max_espera_caja_min": max_espera_caja_min,
        },
        "sla": {
            "objetivo_minutos": 30,
            "promedio_minutos": promedio_min,
            "p50_minutos": p50_min,
            "p90_minutos": p90_min,
            "cumplimiento_objetivo_pct": cumplimiento_objetivo_30m,
            "muestra": len(tiempos_minutos),
        },
        "casos_en_riesgo": casos_en_riesgo,
        "fecha_generacion": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/movimientos-detallados")
def obtener_movimientos_detallados(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Lista detallada de todos los movimientos del día o rango (Caja + Tesorería)
    Para auditoría y revisión contable
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    movimientos_caja = (
        db.query(MovimientoCaja)
        .options(
            joinedload(MovimientoCaja.usuario),
            joinedload(MovimientoCaja.caja),
            joinedload(MovimientoCaja.usuario_anulacion),
        )
        .filter(
            _mc_scope_incluye_anulados(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
            )
        )
        .order_by(MovimientoCaja.created_at.asc())
        .all()
    )

    vids = list({mov.vehiculo_id for mov in movimientos_caja if mov.vehiculo_id})
    vmap: dict = {}
    fe_by_vid: dict = {}
    corr_by_vid: dict = {}
    if vids:
        for v in db.query(VehiculoProceso).filter(VehiculoProceso.id.in_(vids)).all():
            vmap[v.id] = v
        for fe in (
            db.query(FacturaElectronica)
            .filter(FacturaElectronica.vehiculo_proceso_id.in_(vids))
            .order_by(FacturaElectronica.created_at.desc())
            .all()
        ):
            if fe.vehiculo_proceso_id not in fe_by_vid:
                fe_by_vid[fe.vehiculo_proceso_id] = fe
        for corr in (
            db.query(FacturaCorreccion)
            .filter(
                FacturaCorreccion.tenant_id == tid,
                FacturaCorreccion.vehiculo_proceso_id.in_(vids),
            )
            .order_by(FacturaCorreccion.created_at.desc())
            .all()
        ):
            if corr.vehiculo_proceso_id not in corr_by_vid:
                corr_by_vid[corr.vehiculo_proceso_id] = corr

    movimientos_tesoreria = (
        db.query(MovimientoTesoreria)
        .options(
            joinedload(MovimientoTesoreria.usuario),
        )
        .filter(
            _mt_scope_incluye_anulados(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
            )
        )
        .order_by(MovimientoTesoreria.fecha_movimiento.asc())
        .all()
    )

    caja_egreso_ids = [mov.id for mov in movimientos_caja if mov.monto < 0]
    tes_egreso_ids = [
        mov.id for mov in movimientos_tesoreria if mov.tipo == TipoMovimientoTesoreria.EGRESO
    ]
    ds_conditions = []
    if caja_egreso_ids:
        ds_conditions.append(
            and_(
                DocumentoSoporteElectronico.source_module == "caja",
                DocumentoSoporteElectronico.movimiento_id.in_(caja_egreso_ids),
            )
        )
    if tes_egreso_ids:
        ds_conditions.append(
            and_(
                DocumentoSoporteElectronico.source_module == "tesoreria",
                DocumentoSoporteElectronico.movimiento_id.in_(tes_egreso_ids),
            )
        )
    ds_map: dict = {}
    if ds_conditions:
        for r in (
            db.query(DocumentoSoporteElectronico)
            .filter(DocumentoSoporteElectronico.tenant_id == tid, or_(*ds_conditions))
            .all()
        ):
            ds_map[(r.source_module, r.movimiento_id)] = r

    uids_emit: set = set()
    for r in ds_map.values():
        uid = getattr(r, "emitido_por_usuario_id", None)
        if uid is not None:
            uids_emit.add(uid)
    for fe in fe_by_vid.values():
        uid = getattr(fe, "emitido_por_usuario_id", None)
        if uid is not None:
            uids_emit.add(uid)
    unames: dict = {}
    if uids_emit:
        for u in db.query(Usuario).filter(Usuario.id.in_(uids_emit)).all():
            unames[u.id] = u.nombre_completo

    sucursal_ids: set[UUID] = set()
    for mov in movimientos_caja:
        if mov.caja and mov.caja.sucursal_id:
            sucursal_ids.add(mov.caja.sucursal_id)
    for mov in movimientos_tesoreria:
        if mov.sucursal_id:
            sucursal_ids.add(mov.sucursal_id)
    sucursal_names: dict[UUID, str] = {}
    if sucursal_ids:
        for sid, sname in db.query(Sucursal.id, Sucursal.nombre).filter(Sucursal.id.in_(list(sucursal_ids))).all():
            sucursal_names[sid] = sname

    lista_caja = []
    for mov in movimientos_caja:
        # Obtener nombre de usuario
        usuario_nombre = mov.usuario.nombre_completo if mov.usuario else "Sistema"
        
        # Obtener información de la caja
        turno = mov.caja.turno.value if mov.caja else "N/A"
        
        # Determinar si es ingreso o egreso
        tipo_mov = "Ingreso" if mov.monto > 0 else "Egreso"
        
        sede_nombre = sucursal_names.get(mov.caja.sucursal_id) if (mov.caja and mov.caja.sucursal_id) else None
        vid = mov.vehiculo_id
        doc_vehiculo_id = str(vid) if vid else None
        doc_numero_factura = None
        doc_factura_url = None
        if vid:
            vp = vmap.get(vid)
            doc_numero_factura = vp.numero_factura_dian if vp else None
            fe = fe_by_vid.get(vid)
            doc_factura_url = fe.public_url if fe else None
        ds_row_caja = ds_map.get(("caja", mov.id))
        fe_v = fe_by_vid.get(vid) if vid else None
        corr_v = corr_by_vid.get(vid) if vid else None
        lista_caja.append({
            "id": str(mov.id),
            "hora": _format_hms_report_tz(mov.created_at),
            "_sort_ts": _iso_utc(mov.created_at),
            "modulo": "Caja",
            "sede": sede_nombre,
            "turno": turno,
            "tipo_movimiento": tipo_mov,
            "concepto": mov.concepto,
            "categoria": mov.tipo.value,  # rtm, comision_soat, gasto, etc.
            "monto": float(abs(mov.monto)),
            "es_ingreso": mov.monto > 0,
            "metodo_pago": mov.metodo_pago or "N/A",
            "usuario": usuario_nombre,
            "ingresa_efectivo": mov.ingresa_efectivo,
            "vehiculo_id": doc_vehiculo_id,
            "numero_factura_dian": doc_numero_factura,
            "factura_public_url": doc_factura_url,
            "factura_emitida_por": (
                unames.get(fe_v.emitido_por_usuario_id)
                if fe_v and fe_v.emitido_por_usuario_id
                else None
            ),
            "factura_emitida_en": _iso_utc(fe_v.created_at) if fe_v else None,
            "factura_pdf_archivado": bool(fe_v and (fe_v.pdf_storage_relpath or "").strip()),
            "factura_corregida": bool(corr_v and str(corr_v.estado or "").lower() == "completed"),
            "factura_correccion_estado": (corr_v.estado if corr_v else None),
            "factura_correccion_motivo": (corr_v.motivo if corr_v else None),
            "factura_correccion_at": (_iso_utc(corr_v.created_at) if corr_v else None),
            "factura_correccion_factura_original": (corr_v.factura_original_numero if corr_v else None),
            "factura_correccion_nota_credito": (corr_v.nota_credito_numero if corr_v else None),
            "factura_correccion_factura_nueva": (corr_v.factura_nueva_numero if corr_v else None),
            "beneficiario": getattr(mov, "beneficiario", None),
            "beneficiario_tipo_identificacion": getattr(mov, "beneficiario_tipo_identificacion", None),
            "beneficiario_numero_identificacion": getattr(mov, "beneficiario_numero_identificacion", None),
            "beneficiario_direccion": getattr(mov, "beneficiario_direccion", None),
            "beneficiario_email": getattr(mov, "beneficiario_email", None),
            "beneficiario_telefono": getattr(mov, "beneficiario_telefono", None),
            "beneficiario_factus_municipality_id": getattr(mov, "beneficiario_factus_municipality_id", None),
            "anulado": bool(getattr(mov, "anulado", False)),
            "motivo_anulacion": getattr(mov, "motivo_anulacion", None),
            "fecha_anulacion": _iso_utc(getattr(mov, "fecha_anulacion", None)),
            "anulado_por": (
                mov.usuario_anulacion.nombre_completo
                if getattr(mov, "usuario_anulacion", None) is not None
                else None
            ),
            "documento_soporte_numero": ds_row_caja.numero_documento if ds_row_caja else None,
            "documento_soporte_public_url": ds_row_caja.public_url if ds_row_caja else None,
            "documento_soporte_emitido_por": (
                unames.get(ds_row_caja.emitido_por_usuario_id)
                if ds_row_caja and ds_row_caja.emitido_por_usuario_id
                else None
            ),
            "documento_soporte_emitido_en": (_iso_utc(ds_row_caja.created_at) if ds_row_caja else None),
            "documento_soporte_pdf_archivado": bool(
                ds_row_caja and (ds_row_caja.pdf_storage_relpath or "").strip()
            ),
            "documento_soporte_concepto_retencion": (
                getattr(ds_row_caja, "concepto_retencion_dse", None) if ds_row_caja else None
            ),
            "documento_soporte_retencion_calculada": (
                float(ds_row_caja.retencion_calculada_cop)
                if ds_row_caja is not None
                and getattr(ds_row_caja, "retencion_calculada_cop", None) is not None
                else None
            ),
            "documento_soporte_retencion_anio": (
                getattr(ds_row_caja, "retencion_calculo_anio", None) if ds_row_caja else None
            ),
        })
    
    # ==================== MOVIMIENTOS DE TESORERÍA ====================
    lista_tesoreria = []
    for mov in movimientos_tesoreria:
        # Obtener nombre de usuario
        usuario_nombre = mov.usuario.nombre_completo if mov.usuario else "Sistema"
        
        # Determinar categoría
        if mov.tipo.value == "ingreso":
            categoria = mov.categoria_ingreso.value if mov.categoria_ingreso else "N/A"
            tipo_mov = "Ingreso"
        else:
            categoria = mov.categoria_egreso.value if mov.categoria_egreso else "N/A"
            tipo_mov = "Egreso"
        
        sede_t = sucursal_names.get(mov.sucursal_id) if mov.sucursal_id else None
        ds_row_tes = ds_map.get(("tesoreria", mov.id))
        lista_tesoreria.append({
            "id": str(mov.id),
            "hora": _format_hms_report_tz(mov.fecha_movimiento),
            "_sort_ts": _iso_utc(mov.fecha_movimiento),
            "modulo": "Tesorería",
            "sede": sede_t,
            "turno": "N/A",
            "tipo_movimiento": tipo_mov,
            "concepto": mov.concepto,
            "categoria": categoria,
            "monto": float(abs(mov.monto)),
            "es_ingreso": mov.monto > 0,
            "metodo_pago": mov.metodo_pago.value,
            "usuario": usuario_nombre,
            "numero_comprobante": mov.numero_comprobante or "N/A",
            "anulado": bool(getattr(mov, "anulado", False)),
            "motivo_anulacion": getattr(mov, "motivo_anulacion", None),
            "fecha_anulacion": _iso_utc(getattr(mov, "fecha_anulacion", None)),
            "anulado_por": (
                mov.usuario_anulacion.nombre_completo
                if getattr(mov, "usuario_anulacion", None) is not None
                else None
            ),
            "vehiculo_id": None,
            "numero_factura_dian": None,
            "factura_public_url": None,
            "factura_emitida_por": None,
            "factura_emitida_en": None,
            "factura_pdf_archivado": False,
            "factura_corregida": False,
            "factura_correccion_estado": None,
            "factura_correccion_motivo": None,
            "factura_correccion_at": None,
            "factura_correccion_factura_original": None,
            "factura_correccion_nota_credito": None,
            "factura_correccion_factura_nueva": None,
            "beneficiario": getattr(mov, "beneficiario", None),
            "beneficiario_tipo_identificacion": getattr(mov, "beneficiario_tipo_identificacion", None),
            "beneficiario_numero_identificacion": getattr(mov, "beneficiario_numero_identificacion", None),
            "beneficiario_direccion": getattr(mov, "beneficiario_direccion", None),
            "beneficiario_email": getattr(mov, "beneficiario_email", None),
            "beneficiario_telefono": getattr(mov, "beneficiario_telefono", None),
            "beneficiario_factus_municipality_id": getattr(mov, "beneficiario_factus_municipality_id", None),
            "documento_soporte_numero": ds_row_tes.numero_documento if ds_row_tes else None,
            "documento_soporte_public_url": ds_row_tes.public_url if ds_row_tes else None,
            "documento_soporte_emitido_por": (
                unames.get(ds_row_tes.emitido_por_usuario_id)
                if ds_row_tes and ds_row_tes.emitido_por_usuario_id
                else None
            ),
            "documento_soporte_emitido_en": (_iso_utc(ds_row_tes.created_at) if ds_row_tes else None),
            "documento_soporte_pdf_archivado": bool(
                ds_row_tes and (ds_row_tes.pdf_storage_relpath or "").strip()
            ),
            "documento_soporte_concepto_retencion": (
                getattr(ds_row_tes, "concepto_retencion_dse", None) if ds_row_tes else None
            ),
            "documento_soporte_retencion_calculada": (
                float(ds_row_tes.retencion_calculada_cop)
                if ds_row_tes is not None
                and getattr(ds_row_tes, "retencion_calculada_cop", None) is not None
                else None
            ),
            "documento_soporte_retencion_anio": (
                getattr(ds_row_tes, "retencion_calculo_anio", None) if ds_row_tes else None
            ),
        })
    
    # Combinar y ordenar por hora
    todos_movimientos = lista_caja + lista_tesoreria
    todos_movimientos.sort(key=lambda x: x["_sort_ts"])
    for mov in todos_movimientos:
        mov.pop("_sort_ts", None)
    
    return {
        "fecha": etiqueta_fecha,
        "total_movimientos": len(todos_movimientos),
        "movimientos": todos_movimientos
    }


class ProvisionIvaMarcarRangoIn(BaseModel):
    fecha_inicio: date
    fecha_fin: date
    sucursal_id: Optional[UUID] = None
    consolidar_todas: bool = False


@router.get("/provisiones-iva")
def obtener_provisiones_iva(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Reporte de provisión de IVA causado por ventas en el periodo.
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha, fecha_inicio=fecha_inicio, fecha_fin=fecha_fin
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    ventas = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                _no_reinspeccion_exenta_clause(),
                _no_pruebas_auditoria_clause(),
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
            )
        )
        .order_by(VehiculoProceso.fecha_pago.asc())
        .all()
    )

    vids = [v.id for v in ventas]
    marks_map: dict[UUID, IvaProvisionRegistro] = {}
    if vids:
        for mk in (
            db.query(IvaProvisionRegistro)
            .filter(
                IvaProvisionRegistro.tenant_id == tid,
                IvaProvisionRegistro.vehiculo_id.in_(vids),
            )
            .all()
        ):
            marks_map[mk.vehiculo_id] = mk

    resumen = {
        "ventas_total": len(ventas),
        "base_gravable_total": 0.0,
        "iva_causado_total": 0.0,
        "valor_excluido_total": 0.0,
        "iva_provisionado_total": 0.0,
        "iva_pendiente_total": 0.0,
    }
    filas = []
    for v in ventas:
        base, iva, excl, fuente = _calcular_iva_causado_vehiculo(db, vehiculo=v)
        mark = marks_map.get(v.id)
        provisionado = mark is not None
        resumen["base_gravable_total"] += float(base)
        resumen["iva_causado_total"] += float(iva)
        resumen["valor_excluido_total"] += float(excl)
        if provisionado:
            resumen["iva_provisionado_total"] += float(iva)
        else:
            resumen["iva_pendiente_total"] += float(iva)
        filas.append(
            {
                "vehiculo_id": str(v.id),
                "fecha_pago": _iso_utc(v.fecha_pago),
                "sucursal_id": str(v.sucursal_id) if v.sucursal_id else None,
                "placa": v.placa,
                "cliente_nombre": v.cliente_nombre,
                "cliente_documento": v.cliente_documento,
                "numero_factura_dian": v.numero_factura_dian,
                "metodo_pago": str(v.metodo_pago or "N/A"),
                "base_gravable": float(base),
                "iva_causado": float(iva),
                "valor_excluido": float(excl),
                "total_servicio": float(Decimal(str(v.valor_rtm or 0))),
                "fuente_calculo": fuente,
                "provisionado": provisionado,
                "provisionado_lote_id": str(mark.lote_id) if mark else None,
                "provisionado_en": _iso_utc(mark.provisionado_en) if mark else None,
            }
        )

    return {
        "periodo": etiqueta_fecha,
        "resumen": resumen,
        "ventas": filas,
    }


@router.post("/provisiones-iva/marcar-rango")
def marcar_provisiones_iva_rango(
    request: Request,
    body: ProvisionIvaMarcarRangoIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Marca como provisionadas las ventas del rango consultado.
    No duplica marcas ya existentes.
    """
    if body.fecha_inicio > body.fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_inicio no puede ser mayor que fecha_fin",
        )
    fecha_inicio_dt, _, _ = resolve_report_date_window(
        fecha=None, fecha_inicio=body.fecha_inicio, fecha_fin=body.fecha_fin
    )
    _, fecha_fin_dt, _ = resolve_report_date_window(
        fecha=None, fecha_inicio=body.fecha_inicio, fecha_fin=body.fecha_fin
    )

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=body.sucursal_id,
        consolidar_todas=body.consolidar_todas,
    )
    tid = current_user.tenant_id
    ventas = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                _no_reinspeccion_exenta_clause(),
                _no_pruebas_auditoria_clause(),
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
            )
        )
        .all()
    )
    if not ventas:
        return {
            "lote_id": None,
            "ventas_en_rango": 0,
            "ventas_marcadas": 0,
            "ventas_ya_provisionadas": 0,
            "iva_marcado_total": 0.0,
        }

    vids = [v.id for v in ventas]
    ya_provisionadas = set(
        r[0]
        for r in (
            db.query(IvaProvisionRegistro.vehiculo_id)
            .filter(
                IvaProvisionRegistro.tenant_id == tid,
                IvaProvisionRegistro.vehiculo_id.in_(vids),
            )
            .all()
        )
    )

    lote_id = uuid.uuid4()
    marcadas = 0
    iva_marcado_total = Decimal("0")
    for v in ventas:
        if v.id in ya_provisionadas:
            continue
        _base, iva, _excl, _fuente = _calcular_iva_causado_vehiculo(db, vehiculo=v)
        iva_marcado_total += iva
        row = IvaProvisionRegistro(
            tenant_id=tid,
            lote_id=lote_id,
            vehiculo_id=v.id,
            sucursal_id=v.sucursal_id,
            periodo_desde=body.fecha_inicio,
            periodo_hasta=body.fecha_fin,
            iva_causado_cop=iva,
            provisionado_por=current_user.id,
        )
        db.add(row)
        marcadas += 1

    db.commit()
    return {
        "lote_id": str(lote_id),
        "ventas_en_rango": len(ventas),
        "ventas_marcadas": marcadas,
        "ventas_ya_provisionadas": len(ventas) - marcadas,
        "iva_marcado_total": float(iva_marcado_total.quantize(Decimal("0.01"))),
    }


@router.get("/desglose-conceptos")
def obtener_desglose_conceptos(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Desglose de ingresos y egresos por concepto/categoría
    Soporta modo día único o rango de fechas
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    # ==================== INGRESOS POR CONCEPTO ====================
    ingresos_por_concepto = {}

    # Ingresos de Caja (agrupar por tipo)
    from app.models.caja import TipoMovimiento

    for tipo in TipoMovimiento:
        total = db.query(func.sum(MovimientoCaja.monto)).filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.tipo == tipo,
                MovimientoCaja.monto > 0,
            )
        ).scalar() or Decimal(0)

        if total > 0:
            ingresos_por_concepto[f"Caja - {tipo.value}"] = float(total)

    # Ingresos de Tesorería (agrupar por categoría)
    from app.models.tesoreria import CategoriaIngresoTesoreria

    for cat in CategoriaIngresoTesoreria:
        # PostgreSQL puede tener la etiqueta como nombre de miembro (TRASLADO_CAJA) o,
        # en el caso de ajustes, solo ``ajuste_correccion`` añadida por un script antiguo.
        cat_labels = {cat.name, cat.value}
        total = db.query(func.sum(MovimientoTesoreria.monto)).filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                cast(MovimientoTesoreria.categoria_ingreso, String).in_(cat_labels),
                MovimientoTesoreria.monto > 0,
            )
        ).scalar() or Decimal(0)

        if total > 0:
            ingresos_por_concepto[f"Tesorería - {cat.value}"] = float(total)

    # ==================== EGRESOS POR CONCEPTO ====================
    egresos_por_concepto = {}

    # Egresos de Caja
    for tipo in TipoMovimiento:
        total = db.query(func.sum(MovimientoCaja.monto)).filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.tipo == tipo,
                MovimientoCaja.monto < 0,
            )
        ).scalar() or Decimal(0)

        if total < 0:
            egresos_por_concepto[f"Caja - {tipo.value}"] = float(abs(total))

    # Egresos de Tesorería
    from app.models.tesoreria import CategoriaEgresoTesoreria

    for cat in CategoriaEgresoTesoreria:
        cat_labels = {cat.name, cat.value}
        total = db.query(func.sum(MovimientoTesoreria.monto)).filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                cast(MovimientoTesoreria.categoria_egreso, String).in_(cat_labels),
                MovimientoTesoreria.monto < 0,
            )
        ).scalar() or Decimal(0)

        if total < 0:
            egresos_por_concepto[f"Tesorería - {cat.value}"] = float(abs(total))

    return {
        "fecha": etiqueta_fecha,
        "ingresos_por_concepto": ingresos_por_concepto,
        "egresos_por_concepto": egresos_por_concepto,
    }


@router.get("/desglose-medios-pago")
def obtener_desglose_medios_pago(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Desglose de movimientos por medio de pago
    Soporta modo día único o rango de fechas
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    desglose = {}

    # ==================== MEDIOS DE PAGO EN CAJA ====================
    # Agrupar por metodo_pago
    medios_caja = (
        db.query(MovimientoCaja.metodo_pago, func.sum(MovimientoCaja.monto).label("total"))
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.metodo_pago.isnot(None),
            )
        )
        .group_by(MovimientoCaja.metodo_pago)
        .all()
    )

    for metodo, total in medios_caja:
        if metodo not in desglose:
            desglose[metodo] = {"ingresos": 0, "egresos": 0, "total": 0}

        if total > 0:
            desglose[metodo]["ingresos"] += float(total)
        else:
            desglose[metodo]["egresos"] += float(abs(total))
        desglose[metodo]["total"] += float(total)

    # ==================== MEDIOS DE PAGO EN TESORERÍA ====================
    medios_tesoreria = (
        db.query(MovimientoTesoreria.metodo_pago, func.sum(MovimientoTesoreria.monto).label("total"))
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
            )
        )
        .group_by(MovimientoTesoreria.metodo_pago)
        .all()
    )

    for metodo_enum, total in medios_tesoreria:
        metodo = metodo_enum.value
        if metodo not in desglose:
            desglose[metodo] = {"ingresos": 0, "egresos": 0, "total": 0}

        if total > 0:
            desglose[metodo]["ingresos"] += float(total)
        else:
            desglose[metodo]["egresos"] += float(abs(total))
        desglose[metodo]["total"] += float(total)

    return {
        "fecha": etiqueta_fecha,
        "medios_pago": desglose,
    }


@router.get("/tramites-detallados")
def obtener_tramites_detallados(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Lista detallada de todos los trámites del día o rango con valores
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    # Obtener vehículos del rango
    vehiculos = (
        db.query(VehiculoProceso)
        .options(joinedload(VehiculoProceso.registrador))
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro >= fecha_inicio_dt,
                VehiculoProceso.fecha_registro <= fecha_fin_dt,
            )
        )
        .order_by(VehiculoProceso.fecha_registro.asc())
        .all()
    )

    corrections_map: dict[UUID, FacturaCorreccion] = {}
    veh_ids = [v.id for v in vehiculos if v and v.id]
    if veh_ids:
        corr_rows = (
            db.query(FacturaCorreccion)
            .filter(
                FacturaCorreccion.tenant_id == tid,
                FacturaCorreccion.vehiculo_proceso_id.in_(veh_ids),
            )
            .order_by(FacturaCorreccion.vehiculo_proceso_id.asc(), FacturaCorreccion.created_at.desc())
            .all()
        )
        for row in corr_rows:
            if row.vehiculo_proceso_id not in corrections_map:
                corrections_map[row.vehiculo_proceso_id] = row

    sucursal_ids: set[UUID] = {v.sucursal_id for v in vehiculos if v.sucursal_id}
    sucursal_names: dict[UUID, str] = {}
    if sucursal_ids:
        for sid, sname in db.query(Sucursal.id, Sucursal.nombre).filter(Sucursal.id.in_(list(sucursal_ids))).all():
            sucursal_names[sid] = sname

    lista_tramites = []
    for veh in vehiculos:
        corr = corrections_map.get(veh.id)
        sede_n = sucursal_names.get(veh.sucursal_id) if veh.sucursal_id else None
        lista_tramites.append(
            {
                "id": str(veh.id),
                "hora_registro": _format_hms_report_tz(veh.fecha_registro),
                "placa": veh.placa,
                "tipo_vehiculo": veh.tipo_vehiculo,
                "cliente": veh.cliente_nombre,
                "documento": veh.cliente_documento,
                "valor_rtm": float(veh.valor_rtm),
                "comision_soat": float(veh.comision_soat),
                "total_cobrado": float(veh.total_cobrado),
                "metodo_pago": veh.metodo_pago or "Pendiente",
                "estado": veh.estado.value,
                "pagado": veh.estado.value
                in ["pagado", "en_pista", "aprobado", "rechazado", "completado"],
                "registrado_por": veh.registrador.nombre_completo if veh.registrador else "N/A",
                "sede": sede_n,
                "factura_corregida": corr is not None,
                "factura_correccion_estado": (corr.estado if corr else None),
                "factura_correccion_motivo": (corr.motivo if corr else None),
                "factura_correccion_at": (_iso_utc(corr.created_at) if corr else None),
                "factura_original_numero": (corr.factura_original_numero if corr else None),
                "nota_credito_numero": (corr.nota_credito_numero if corr else None),
                "factura_nueva_numero": (corr.factura_nueva_numero if corr else None),
            }
        )
    
    # Calcular totales
    total_rtm = sum(t["valor_rtm"] for t in lista_tramites)
    total_soat = sum(t["comision_soat"] for t in lista_tramites)
    total_cobrado = sum(t["total_cobrado"] for t in lista_tramites if t["pagado"])
    total_pendiente = sum(t["total_cobrado"] for t in lista_tramites if not t["pagado"])
    
    return {
        "fecha": etiqueta_fecha,
        "total_tramites": len(lista_tramites),
        "resumen": {
            "total_rtm": total_rtm,
            "total_soat": total_soat,
            "total_cobrado": total_cobrado,
            "total_pendiente": total_pendiente
        },
        "tramites": lista_tramites
    }


@router.get("/resumen-mensual")
def obtener_resumen_mensual(
    request: Request,
    mes: Optional[int] = Query(None, description="Mes (1-12)"),
    anio: Optional[int] = Query(None, description="Año"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Resumen mensual consolidado
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    # Si no se especifica, usar mes actual
    if not mes or not anio:
        hoy = date.today()
        mes = hoy.month
        anio = hoy.year

    # Primer y último día del mes
    fecha_inicio = datetime(anio, mes, 1)
    if mes == 12:
        fecha_fin = datetime(anio + 1, 1, 1) - timedelta(seconds=1)
    else:
        fecha_fin = datetime(anio, mes + 1, 1) - timedelta(seconds=1)
    dias_mes = monthrange(anio, mes)[1]

    # Ingresos del mes
    ingresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        _mc_scope(
            db,
            tid,
            scope_sid,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto > 0,
        )
    ).scalar() or Decimal(0)

    ingresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        _mt_scope(
            tid,
            scope_sid,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto > 0,
        )
    ).scalar() or Decimal(0)

    total_ingresos = float(ingresos_caja + ingresos_tesoreria)

    # Egresos del mes
    egresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        _mc_scope(
            db,
            tid,
            scope_sid,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto < 0,
        )
    ).scalar() or Decimal(0)

    egresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        _mt_scope(
            tid,
            scope_sid,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto < 0,
        )
    ).scalar() or Decimal(0)

    total_egresos = float(abs(egresos_caja + egresos_tesoreria))

    # Trámites del mes
    tramites_mes = (
        db.query(func.count(VehiculoProceso.id))
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro >= fecha_inicio,
                VehiculoProceso.fecha_registro <= fecha_fin,
            )
        )
        .scalar()
        or 0
    )

    return {
        "mes": mes,
        "anio": anio,
        "total_ingresos": total_ingresos,
        "total_egresos": total_egresos,
        "utilidad": total_ingresos - total_egresos,
        "tramites_atendidos": tramites_mes,
        "promedio_diario_ingresos": total_ingresos / dias_mes,
        "promedio_diario_egresos": total_egresos / dias_mes,
    }


# --- Métricas de agendamiento (tenant completo; las citas no llevan sede en el modelo actual) ---


class AgendamientoMetricasPorEstado(BaseModel):
    scheduled: int = 0
    confirmed: int = 0
    checked_in: int = 0
    cancelled: int = 0
    no_show: int = 0


class AgendamientoMetricasOrigen(BaseModel):
    public_link: int = 0
    manual: int = 0
    otros: int = 0


class AgendamientoSerieDia(BaseModel):
    fecha: str
    total: int
    checked_in: int
    canceladas: int
    no_show: int = 0


class AgendamientoMetricasResponse(BaseModel):
    periodo: str
    fecha_generacion: str
    total_citas: int
    por_estado: AgendamientoMetricasPorEstado
    por_origen: AgendamientoMetricasOrigen
    citas_con_email: int = Field(description="Citas con correo del cliente (elegibles para recordatorio)")
    citas_sin_email: int
    recordatorios_enviados: int
    recordatorios_pendientes: int
    recordatorios_fallidos: int
    recordatorios_omitidos: int
    tasa_check_in_pct: float = Field(
        description="Check-in / citas no canceladas en el periodo (0–100)"
    )
    serie_diaria: list[AgendamientoSerieDia] = Field(default_factory=list)


@router.get("/agendamiento-metricas", response_model=AgendamientoMetricasResponse)
def obtener_agendamiento_metricas(
    fecha: Optional[date] = Query(None, description="Día único (default hoy si no hay rango)"),
    fecha_inicio: Optional[date] = Query(None),
    fecha_fin: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    KPIs de citas del tenant para el panel de reportes (actualización periódica vía refetch en el cliente).
    Alcance: todo el tenant; el modelo de citas no discrimina por sede.
    """
    try:
        inicio_dt, fin_dt, etiqueta = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    tid = current_user.tenant_id
    rows = (
        db.query(Appointment)
        .filter(
            Appointment.tenant_id == tid,
            Appointment.scheduled_at >= inicio_dt,
            Appointment.scheduled_at <= fin_dt,
        )
        .all()
    )

    por_estado = AgendamientoMetricasPorEstado()
    origen_pub = 0
    origen_manual = 0
    origen_otros = 0
    con_email = 0
    sin_email = 0
    rec_enviados = 0
    rec_pendientes = 0
    rec_fallidos = 0
    rec_omitidos = 0

    serie: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "checked_in": 0, "canceladas": 0, "no_show": 0})

    for r in rows:
        st = (r.status or "").strip().lower()
        if st == "scheduled":
            por_estado.scheduled += 1
        elif st == "confirmed":
            por_estado.confirmed += 1
        elif st == "checked_in":
            por_estado.checked_in += 1
        elif st == "cancelled":
            por_estado.cancelled += 1
        elif st == "no_show":
            por_estado.no_show += 1

        src = (r.source or "").strip().lower()
        if src == "public_link":
            origen_pub += 1
        elif src == "manual":
            origen_manual += 1
        else:
            origen_otros += 1

        if (r.cliente_email or "").strip():
            con_email += 1
        else:
            sin_email += 1

        rs = (r.reminder_status or "pending").strip().lower()
        if r.reminder_sent_at is not None:
            rec_enviados += 1
        elif rs == "failed":
            rec_fallidos += 1
        elif rs == "skipped":
            rec_omitidos += 1
        elif rs == "pending" and (r.cliente_email or "").strip():
            rec_pendientes += 1

        day_key = r.scheduled_at.date().isoformat() if r.scheduled_at else None
        if day_key:
            serie[day_key]["total"] += 1
            if st == "checked_in":
                serie[day_key]["checked_in"] += 1
            if st == "cancelled":
                serie[day_key]["canceladas"] += 1
            if st == "no_show":
                serie[day_key]["no_show"] += 1

    total = len(rows)
    no_canceladas = total - por_estado.cancelled
    tasa_check_in = round(100.0 * por_estado.checked_in / no_canceladas, 1) if no_canceladas > 0 else 0.0

    serie_list = [
        AgendamientoSerieDia(
            fecha=k,
            total=v["total"],
            checked_in=v["checked_in"],
            canceladas=v["canceladas"],
            no_show=v["no_show"],
        )
        for k, v in sorted(serie.items())
    ]

    return AgendamientoMetricasResponse(
        periodo=etiqueta,
        fecha_generacion=datetime.now(timezone.utc).isoformat(),
        total_citas=total,
        por_estado=por_estado,
        por_origen=AgendamientoMetricasOrigen(
            public_link=origen_pub,
            manual=origen_manual,
            otros=origen_otros,
        ),
        citas_con_email=con_email,
        citas_sin_email=sin_email,
        recordatorios_enviados=rec_enviados,
        recordatorios_pendientes=rec_pendientes,
        recordatorios_fallidos=rec_fallidos,
        recordatorios_omitidos=rec_omitidos,
        tasa_check_in_pct=tasa_check_in,
        serie_diaria=serie_list,
    )


CIERRES_CAJA_REPORTE_MAX_DIAS = 366
CIERRES_CAJA_REPORTE_MAX_LIMIT = 500


class CierreCajaReporteItem(BaseModel):
    """Cierre de caja para auditoría en panel de reportes (admin/contador)."""

    id: UUID
    cajero_nombre: str
    sucursal_nombre: Optional[str] = None
    fecha_apertura: datetime
    fecha_cierre: Optional[datetime] = None
    turno: str
    monto_inicial: Decimal
    monto_final_sistema: Optional[Decimal] = None
    monto_final_fisico: Optional[Decimal] = None
    diferencia: Optional[Decimal] = None
    observaciones_cierre: Optional[str] = None


@router.get("/cierres-caja", response_model=list[CierreCajaReporteItem])
def listar_cierres_caja_reporte(
    request: Request,
    fecha_cierre_desde: date = Query(..., description="Inicio del rango por día de cierre (Colombia)"),
    fecha_cierre_hasta: date = Query(..., description="Fin del rango por día de cierre (Colombia)"),
    limit: int = Query(200, ge=1, le=CIERRES_CAJA_REPORTE_MAX_LIMIT),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Historial de cierres de caja por cajero para auditoría gerencial.
    Respeta el mismo alcance de sede que el resto de reportes (activa, sede elegida o todas).
    """
    if fecha_cierre_desde > fecha_cierre_hasta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha inicial no puede ser posterior a la final",
        )
    if (fecha_cierre_hasta - fecha_cierre_desde).days > CIERRES_CAJA_REPORTE_MAX_DIAS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El rango máximo permitido es de {CIERRES_CAJA_REPORTE_MAX_DIAS} días",
        )

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id
    principal_id = get_principal_sucursal_id(db, tid)

    query = (
        db.query(Caja)
        .options(joinedload(Caja.usuario), joinedload(Caja.sucursal))
        .filter(
            Caja.tenant_id == tid,
            Caja.estado == EstadoCaja.CERRADA,
            Caja.fecha_cierre.isnot(None),
        )
    )

    if scope_sid is not None:
        query = query.filter(
            or_(
                Caja.sucursal_id == scope_sid,
                and_(Caja.sucursal_id.is_(None), scope_sid == principal_id),
            )
        )

    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        utc_tstz = func.timezone("UTC", Caja.fecha_cierre)
        bogota_naive = func.timezone("America/Bogota", utc_tstz)
        dia_cierre = cast(bogota_naive, Date)
        query = query.filter(
            dia_cierre >= fecha_cierre_desde,
            dia_cierre <= fecha_cierre_hasta,
        )
    else:
        tz = zoneinfo_from_name("America/Bogota")
        start_local = datetime.combine(fecha_cierre_desde, time.min, tzinfo=tz)
        end_exclusive_local = datetime.combine(fecha_cierre_hasta + timedelta(days=1), time.min, tzinfo=tz)
        start_utc = start_local.astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = end_exclusive_local.astimezone(timezone.utc).replace(tzinfo=None)
        query = query.filter(
            Caja.fecha_cierre >= start_utc,
            Caja.fecha_cierre < end_utc,
        )

    cajas = query.order_by(Caja.fecha_cierre.desc()).limit(limit).all()

    out: list[CierreCajaReporteItem] = []
    for caja in cajas:
        u = caja.usuario
        cajero_nombre = (u.nombre_completo or "").strip() if u else ""
        if not cajero_nombre:
            cajero_nombre = "—"
        sede_nombre = None
        if caja.sucursal and getattr(caja.sucursal, "nombre", None):
            sede_nombre = caja.sucursal.nombre
        turno_val = caja.turno.value if hasattr(caja.turno, "value") else str(caja.turno)
        out.append(
            CierreCajaReporteItem(
                id=caja.id,
                cajero_nombre=cajero_nombre,
                sucursal_nombre=sede_nombre,
                fecha_apertura=_as_utc_aware(caja.fecha_apertura),
                fecha_cierre=_as_utc_aware(caja.fecha_cierre),
                turno=turno_val,
                monto_inicial=caja.monto_inicial,
                monto_final_sistema=caja.monto_final_sistema,
                monto_final_fisico=caja.monto_final_fisico,
                diferencia=caja.diferencia,
                observaciones_cierre=caja.observaciones_cierre,
            )
        )
    return out


class CxcClienteItem(BaseModel):
    cliente_nombre: str
    cliente_documento: str
    cliente_telefono: Optional[str] = None
    cliente_email: Optional[str] = None
    sucursal_nombre: Optional[str] = None
    tramites_pendientes: int
    monto_pendiente_total: Decimal
    antiguedad_max_dias: int
    fecha_registro_mas_antigua: Optional[datetime] = None
    placas: list[str] = Field(default_factory=list)


class CxcGeneralClienteResponse(BaseModel):
    fecha_corte: str
    resumen: dict
    clientes: list[CxcClienteItem]


@router.get("/cxc-general-cliente", response_model=CxcGeneralClienteResponse)
def cxc_general_por_cliente(
    request: Request,
    fecha_corte: Optional[date] = Query(None, description="Fecha de corte (default: hoy)."),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Cartera operativa por cliente: trámites registrados y aún no pagados al corte.
    Se agrupa por tercero para dar vista rápida de CxC en operación CDA.
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    corte_local = fecha_corte or datetime.now(REPORT_TZ).date()
    corte_dt_utc = (
        datetime.combine(corte_local, time.max, tzinfo=REPORT_TZ)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )

    pendientes = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro <= corte_dt_utc,
                VehiculoProceso.fecha_pago.is_(None),
                VehiculoProceso.total_cobrado > 0,
                _no_pruebas_auditoria_clause(),
            )
        )
        .order_by(VehiculoProceso.fecha_registro.asc())
        .all()
    )

    if not pendientes:
        return CxcGeneralClienteResponse(
            fecha_corte=corte_local.isoformat(),
            resumen={
                "total_clientes": 0,
                "total_tramites_pendientes": 0,
                "saldo_total_pendiente": Decimal("0"),
            },
            clientes=[],
        )

    sucursal_ids = {v.sucursal_id for v in pendientes if v.sucursal_id}
    sucursal_names: dict[UUID, str] = {}
    if sucursal_ids:
        for sid, sname in db.query(Sucursal.id, Sucursal.nombre).filter(Sucursal.id.in_(list(sucursal_ids))).all():
            sucursal_names[sid] = sname

    grouped: dict[tuple[str, str], dict] = {}
    for v in pendientes:
        doc = (v.cliente_documento or "").strip()
        nombre = (v.cliente_nombre or "").strip() or "Cliente sin nombre"
        key = (doc or "SIN_DOCUMENTO", nombre.upper())
        saldo = Decimal(str(v.total_cobrado or 0))
        fecha_reg = _as_utc_aware(v.fecha_registro)
        fecha_local = _as_report_tz(fecha_reg)
        antiguedad_dias = 0
        if fecha_local is not None:
            antiguedad_dias = max((corte_local - fecha_local.date()).days, 0)

        if key not in grouped:
            grouped[key] = {
                "cliente_nombre": nombre,
                "cliente_documento": doc or "SIN_DOCUMENTO",
                "cliente_telefono": (v.cliente_telefono or "").strip() or None,
                "cliente_email": (v.cliente_email or "").strip() or None,
                "sucursal_nombre": sucursal_names.get(v.sucursal_id) if v.sucursal_id else None,
                "tramites_pendientes": 0,
                "monto_pendiente_total": Decimal("0"),
                "antiguedad_max_dias": 0,
                "fecha_registro_mas_antigua": fecha_reg,
                "placas": [],
            }
        item = grouped[key]
        item["tramites_pendientes"] += 1
        item["monto_pendiente_total"] = Decimal(str(item["monto_pendiente_total"])) + saldo
        item["antiguedad_max_dias"] = max(int(item["antiguedad_max_dias"]), antiguedad_dias)
        prev_fecha = item.get("fecha_registro_mas_antigua")
        if prev_fecha is None or (fecha_reg is not None and fecha_reg < prev_fecha):
            item["fecha_registro_mas_antigua"] = fecha_reg
        if v.placa:
            placas = item["placas"]
            if v.placa not in placas and len(placas) < 5:
                placas.append(v.placa)

    clientes = [
        CxcClienteItem(
            cliente_nombre=item["cliente_nombre"],
            cliente_documento=item["cliente_documento"],
            cliente_telefono=item["cliente_telefono"],
            cliente_email=item["cliente_email"],
            sucursal_nombre=item["sucursal_nombre"],
            tramites_pendientes=int(item["tramites_pendientes"]),
            monto_pendiente_total=Decimal(str(item["monto_pendiente_total"])),
            antiguedad_max_dias=int(item["antiguedad_max_dias"]),
            fecha_registro_mas_antigua=_as_utc_aware(item["fecha_registro_mas_antigua"]),
            placas=item["placas"],
        )
        for item in grouped.values()
    ]
    clientes.sort(
        key=lambda c: (
            Decimal(str(c.monto_pendiente_total)),
            c.antiguedad_max_dias,
            c.tramites_pendientes,
        ),
        reverse=True,
    )
    if len(clientes) > limit:
        clientes = clientes[:limit]

    saldo_total = sum((Decimal(str(c.monto_pendiente_total)) for c in clientes), Decimal("0"))
    total_tramites = sum((int(c.tramites_pendientes) for c in clientes), 0)

    return CxcGeneralClienteResponse(
        fecha_corte=corte_local.isoformat(),
        resumen={
            "total_clientes": len(clientes),
            "total_tramites_pendientes": total_tramites,
            "saldo_total_pendiente": saldo_total,
        },
        clientes=clientes,
    )


class CxpProveedorItem(BaseModel):
    proveedor_nombre: str
    proveedor_documento: str
    proveedor_tipo_documento: Optional[str] = None
    proveedor_email: Optional[str] = None
    proveedor_telefono: Optional[str] = None
    proveedor_direccion: Optional[str] = None
    sucursal_nombre: Optional[str] = None
    desde_catalogo: bool = False
    proveedor_catalogo_id: Optional[UUID] = None
    concepto_retencion_dse: Optional[str] = None
    movimientos_egreso: int
    valor_egresado_total: Decimal
    fecha_ultimo_egreso: Optional[datetime] = None
    referencias_comprobante: list[str] = Field(default_factory=list)


class CxpGeneralProveedorResponse(BaseModel):
    periodo: str
    resumen: dict
    proveedores: list[CxpProveedorItem]


@router.get("/cxp-general-proveedor", response_model=CxpGeneralProveedorResponse)
def cxp_general_por_proveedor(
    request: Request,
    fecha_inicio: Optional[date] = Query(None),
    fecha_fin: Optional[date] = Query(None),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Reporte operativo de CxP por proveedor, basado en egresos de tesorería:
    prioriza datos del catálogo de proveedores cuando exista vínculo `proveedor_catalogo_id`.
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    if (fecha_inicio is None) != (fecha_fin is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe enviar fecha_inicio y fecha_fin juntas para filtro por rango.",
        )

    if fecha_inicio and fecha_fin:
        if fecha_inicio > fecha_fin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="fecha_inicio no puede ser mayor que fecha_fin.",
            )
        inicio_local = fecha_inicio
        fin_local = fecha_fin
    else:
        today_local = datetime.now(REPORT_TZ).date()
        inicio_local = today_local.replace(day=1)
        fin_local = today_local

    inicio_utc = (
        datetime.combine(inicio_local, time.min, tzinfo=REPORT_TZ)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )
    fin_utc = (
        datetime.combine(fin_local, time.max, tzinfo=REPORT_TZ)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )
    periodo_label = f"{inicio_local.isoformat()} a {fin_local.isoformat()}"

    rows = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.tipo == TipoMovimientoTesoreria.EGRESO,
                MovimientoTesoreria.fecha_movimiento >= inicio_utc,
                MovimientoTesoreria.fecha_movimiento <= fin_utc,
                or_(
                    MovimientoTesoreria.proveedor_catalogo_id.isnot(None),
                    MovimientoTesoreria.categoria_egreso == CategoriaEgresoTesoreria.PROVEEDORES,
                    MovimientoTesoreria.beneficiario.isnot(None),
                ),
            )
        )
        .order_by(MovimientoTesoreria.fecha_movimiento.desc())
        .all()
    )

    if not rows:
        return CxpGeneralProveedorResponse(
            periodo=periodo_label,
            resumen={
                "total_proveedores": 0,
                "total_movimientos": 0,
                "valor_egresado_total": Decimal("0"),
            },
            proveedores=[],
        )

    proveedor_ids = {r.proveedor_catalogo_id for r in rows if r.proveedor_catalogo_id}
    proveedores_catalogo: dict[UUID, ProveedorCatalogo] = {}
    if proveedor_ids:
        for p in (
            db.query(ProveedorCatalogo)
            .filter(
                ProveedorCatalogo.tenant_id == tid,
                ProveedorCatalogo.id.in_(list(proveedor_ids)),
            )
            .all()
        ):
            proveedores_catalogo[p.id] = p

    sucursal_ids = {r.sucursal_id for r in rows if r.sucursal_id}
    sucursal_names: dict[UUID, str] = {}
    if sucursal_ids:
        for sid, sname in db.query(Sucursal.id, Sucursal.nombre).filter(Sucursal.id.in_(list(sucursal_ids))).all():
            sucursal_names[sid] = sname

    grouped: dict[str, dict] = {}
    for r in rows:
        prov = proveedores_catalogo.get(r.proveedor_catalogo_id) if r.proveedor_catalogo_id else None
        if prov is not None:
            key = f"cat:{prov.id}"
            nombre = (prov.razon_social_rut or prov.alias or "").strip() or "Proveedor catalogado"
            doc = (prov.numero_identificacion or "").strip() or "SIN_DOCUMENTO"
            tipo_doc = (prov.tipo_identificacion or "").strip() or None
            email = (prov.email or "").strip() or None
            telefono = (prov.telefono or "").strip() or None
            direccion = (prov.direccion or "").strip() or None
            concepto_ret = (prov.concepto_retencion_dse or "").strip() or None
            desde_catalogo = True
            proveedor_catalogo_id = prov.id
        else:
            doc_manual = (r.beneficiario_numero_identificacion or "").strip()
            nombre_manual = (r.beneficiario or "").strip() or "Proveedor no catalogado"
            key = f"manual:{doc_manual or 'SIN_DOCUMENTO'}:{nombre_manual.upper()}"
            nombre = nombre_manual
            doc = doc_manual or "SIN_DOCUMENTO"
            tipo_doc = (r.beneficiario_tipo_identificacion or "").strip() or None
            email = (r.beneficiario_email or "").strip() or None
            telefono = (r.beneficiario_telefono or "").strip() or None
            direccion = (r.beneficiario_direccion or "").strip() or None
            concepto_ret = None
            desde_catalogo = False
            proveedor_catalogo_id = None

        if key not in grouped:
            grouped[key] = {
                "proveedor_nombre": nombre,
                "proveedor_documento": doc,
                "proveedor_tipo_documento": tipo_doc,
                "proveedor_email": email,
                "proveedor_telefono": telefono,
                "proveedor_direccion": direccion,
                "sucursal_nombre": sucursal_names.get(r.sucursal_id) if r.sucursal_id else None,
                "desde_catalogo": desde_catalogo,
                "proveedor_catalogo_id": proveedor_catalogo_id,
                "concepto_retencion_dse": concepto_ret,
                "movimientos_egreso": 0,
                "valor_egresado_total": Decimal("0"),
                "fecha_ultimo_egreso": _as_utc_aware(r.fecha_movimiento),
                "referencias_comprobante": [],
            }
        item = grouped[key]
        egreso_abs = abs(Decimal(str(r.monto or 0)))
        item["movimientos_egreso"] += 1
        item["valor_egresado_total"] = Decimal(str(item["valor_egresado_total"])) + egreso_abs
        if item["fecha_ultimo_egreso"] is None or (
            _as_utc_aware(r.fecha_movimiento) is not None
            and _as_utc_aware(r.fecha_movimiento) > item["fecha_ultimo_egreso"]
        ):
            item["fecha_ultimo_egreso"] = _as_utc_aware(r.fecha_movimiento)
        comp = (r.numero_comprobante or "").strip()
        if comp and comp not in item["referencias_comprobante"] and len(item["referencias_comprobante"]) < 5:
            item["referencias_comprobante"].append(comp)

    proveedores = [
        CxpProveedorItem(
            proveedor_nombre=i["proveedor_nombre"],
            proveedor_documento=i["proveedor_documento"],
            proveedor_tipo_documento=i["proveedor_tipo_documento"],
            proveedor_email=i["proveedor_email"],
            proveedor_telefono=i["proveedor_telefono"],
            proveedor_direccion=i["proveedor_direccion"],
            sucursal_nombre=i["sucursal_nombre"],
            desde_catalogo=bool(i["desde_catalogo"]),
            proveedor_catalogo_id=i["proveedor_catalogo_id"],
            concepto_retencion_dse=i["concepto_retencion_dse"],
            movimientos_egreso=int(i["movimientos_egreso"]),
            valor_egresado_total=Decimal(str(i["valor_egresado_total"])),
            fecha_ultimo_egreso=_as_utc_aware(i["fecha_ultimo_egreso"]),
            referencias_comprobante=i["referencias_comprobante"],
        )
        for i in grouped.values()
    ]
    proveedores.sort(
        key=lambda p: (
            Decimal(str(p.valor_egresado_total)),
            p.movimientos_egreso,
        ),
        reverse=True,
    )
    if len(proveedores) > limit:
        proveedores = proveedores[:limit]

    total_egresado = sum((Decimal(str(p.valor_egresado_total)) for p in proveedores), Decimal("0"))
    total_movs = sum((int(p.movimientos_egreso) for p in proveedores), 0)

    return CxpGeneralProveedorResponse(
        periodo=periodo_label,
        resumen={
            "total_proveedores": len(proveedores),
            "total_movimientos": total_movs,
            "valor_egresado_total": total_egresado,
        },
        proveedores=proveedores,
    )


class VentaVendedorItem(BaseModel):
    vendedor_id: Optional[UUID] = None
    vendedor_nombre: str
    sucursal_nombre: Optional[str] = None
    tramites_vendidos: int
    total_vendido: Decimal
    ticket_promedio: Decimal
    primera_venta_at: Optional[datetime] = None
    ultima_venta_at: Optional[datetime] = None
    placas: list[str] = Field(default_factory=list)
    metodos_pago: dict = Field(default_factory=dict)


class VentasVendedorResponse(BaseModel):
    periodo: str
    resumen: dict
    vendedores: list[VentaVendedorItem]


@router.get("/ventas-por-vendedor", response_model=VentasVendedorResponse)
def ventas_por_vendedor(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)."),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    limit: int = Query(300, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Ventas por vendedor/cajero, agrupadas por usuario de cobro.
    Si no existe `cobrado_por`, usa `registrado_por` como fallback operativo.
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    ventas = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.total_cobrado > 0,
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
                _no_pruebas_auditoria_clause(),
            )
        )
        .order_by(VehiculoProceso.fecha_pago.asc())
        .all()
    )

    if not ventas:
        return VentasVendedorResponse(
            periodo=etiqueta_fecha,
            resumen={
                "total_vendedores": 0,
                "total_tramites": 0,
                "total_vendido": Decimal("0"),
                "ticket_promedio_general": Decimal("0"),
            },
            vendedores=[],
        )

    user_ids: set[UUID] = set()
    sucursal_ids: set[UUID] = set()
    for v in ventas:
        if v.cobrado_por:
            user_ids.add(v.cobrado_por)
        if v.registrado_por:
            user_ids.add(v.registrado_por)
        if v.sucursal_id:
            sucursal_ids.add(v.sucursal_id)
    users_map: dict[UUID, str] = {}
    if user_ids:
        for u in db.query(Usuario).filter(Usuario.id.in_(list(user_ids))).all():
            users_map[u.id] = (u.nombre_completo or "").strip() or "Usuario"
    sucursal_names: dict[UUID, str] = {}
    if sucursal_ids:
        for sid, sname in db.query(Sucursal.id, Sucursal.nombre).filter(Sucursal.id.in_(list(sucursal_ids))).all():
            sucursal_names[sid] = sname

    grouped: dict[str, dict] = {}
    for v in ventas:
        vendedor_id = v.cobrado_por or v.registrado_por
        vendedor_nombre = users_map.get(vendedor_id, "Sin vendedor asignado") if vendedor_id else "Sin vendedor asignado"
        key = str(vendedor_id) if vendedor_id else "sin_vendedor"
        venta_total = Decimal(str(v.total_cobrado or 0))
        fecha_pago_utc = _as_utc_aware(v.fecha_pago)
        metodo = str(v.metodo_pago or "").strip() or "sin_metodo"

        if key not in grouped:
            grouped[key] = {
                "vendedor_id": vendedor_id,
                "vendedor_nombre": vendedor_nombre,
                "sucursal_nombre": sucursal_names.get(v.sucursal_id) if v.sucursal_id else None,
                "tramites_vendidos": 0,
                "total_vendido": Decimal("0"),
                "primera_venta_at": fecha_pago_utc,
                "ultima_venta_at": fecha_pago_utc,
                "placas": [],
                "metodos_pago": defaultdict(Decimal),
            }
        item = grouped[key]
        item["tramites_vendidos"] += 1
        item["total_vendido"] = Decimal(str(item["total_vendido"])) + venta_total
        if item["primera_venta_at"] is None or (fecha_pago_utc is not None and fecha_pago_utc < item["primera_venta_at"]):
            item["primera_venta_at"] = fecha_pago_utc
        if item["ultima_venta_at"] is None or (fecha_pago_utc is not None and fecha_pago_utc > item["ultima_venta_at"]):
            item["ultima_venta_at"] = fecha_pago_utc
        if v.placa and v.placa not in item["placas"] and len(item["placas"]) < 6:
            item["placas"].append(v.placa)
        item["metodos_pago"][metodo] += venta_total

    vendedores = []
    for i in grouped.values():
        tramites = int(i["tramites_vendidos"])
        total = Decimal(str(i["total_vendido"]))
        ticket = (total / Decimal(tramites)).quantize(Decimal("0.01")) if tramites > 0 else Decimal("0")
        metodos = {
            k: Decimal(str(v)).quantize(Decimal("0.01"))
            for k, v in sorted(i["metodos_pago"].items(), key=lambda kv: kv[1], reverse=True)
        }
        vendedores.append(
            VentaVendedorItem(
                vendedor_id=i["vendedor_id"],
                vendedor_nombre=i["vendedor_nombre"],
                sucursal_nombre=i["sucursal_nombre"],
                tramites_vendidos=tramites,
                total_vendido=total.quantize(Decimal("0.01")),
                ticket_promedio=ticket,
                primera_venta_at=_as_utc_aware(i["primera_venta_at"]),
                ultima_venta_at=_as_utc_aware(i["ultima_venta_at"]),
                placas=i["placas"],
                metodos_pago=metodos,
            )
        )

    vendedores.sort(
        key=lambda x: (Decimal(str(x.total_vendido)), x.tramites_vendidos),
        reverse=True,
    )
    if len(vendedores) > limit:
        vendedores = vendedores[:limit]

    total_vendido = sum((Decimal(str(v.total_vendido)) for v in vendedores), Decimal("0"))
    total_tramites = sum((int(v.tramites_vendidos) for v in vendedores), 0)
    ticket_general = (
        (total_vendido / Decimal(total_tramites)).quantize(Decimal("0.01"))
        if total_tramites > 0
        else Decimal("0")
    )

    return VentasVendedorResponse(
        periodo=etiqueta_fecha,
        resumen={
            "total_vendedores": len(vendedores),
            "total_tramites": total_tramites,
            "total_vendido": total_vendido.quantize(Decimal("0.01")),
            "ticket_promedio_general": ticket_general,
        },
        vendedores=vendedores,
    )


class VentaSucursalItem(BaseModel):
    sucursal_id: Optional[UUID] = None
    sucursal_nombre: str
    sucursal_codigo: Optional[str] = None
    tramites_vendidos: int
    total_vendido: Decimal
    ticket_promedio: Decimal
    vendedores_unicos: int
    primera_venta_at: Optional[datetime] = None
    ultima_venta_at: Optional[datetime] = None
    placas: list[str] = Field(default_factory=list)
    metodos_pago: dict = Field(default_factory=dict)


class VentasSucursalResponse(BaseModel):
    periodo: str
    resumen: dict
    sucursales: list[VentaSucursalItem]


@router.get("/ventas-por-sucursal", response_model=VentasSucursalResponse)
def ventas_por_sucursal(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)."),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Ventas por sucursal (centro operativo), con total vendido y ticket promedio.
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id
    principal_sid = get_principal_sucursal_id(db, tid)

    ventas = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.total_cobrado > 0,
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
                _no_pruebas_auditoria_clause(),
            )
        )
        .order_by(VehiculoProceso.fecha_pago.asc())
        .all()
    )

    if not ventas:
        return VentasSucursalResponse(
            periodo=etiqueta_fecha,
            resumen={
                "total_sucursales": 0,
                "total_tramites": 0,
                "total_vendido": Decimal("0"),
                "ticket_promedio_general": Decimal("0"),
            },
            sucursales=[],
        )

    sid_set = {v.sucursal_id for v in ventas if v.sucursal_id}
    if principal_sid is not None:
        sid_set.add(principal_sid)
    suc_map: dict[UUID, Sucursal] = {}
    if sid_set:
        for s in db.query(Sucursal).filter(Sucursal.id.in_(list(sid_set))).all():
            suc_map[s.id] = s

    grouped: dict[str, dict] = {}
    for v in ventas:
        sid = v.sucursal_id or principal_sid
        key = str(sid) if sid is not None else "sin_sede"
        suc = suc_map.get(sid) if sid is not None else None
        nombre = (getattr(suc, "nombre", None) or "").strip() or (
            "Sede principal" if v.sucursal_id is None else "Sin sede"
        )
        codigo = (getattr(suc, "codigo", None) or "").strip() or None
        venta_total = Decimal(str(v.total_cobrado or 0))
        fecha_pago_utc = _as_utc_aware(v.fecha_pago)
        metodo = str(v.metodo_pago or "").strip() or "sin_metodo"
        vendedor_id = v.cobrado_por or v.registrado_por

        if key not in grouped:
            grouped[key] = {
                "sucursal_id": sid,
                "sucursal_nombre": nombre,
                "sucursal_codigo": codigo,
                "tramites_vendidos": 0,
                "total_vendido": Decimal("0"),
                "primera_venta_at": fecha_pago_utc,
                "ultima_venta_at": fecha_pago_utc,
                "vendedores_ids": set(),
                "placas": [],
                "metodos_pago": defaultdict(Decimal),
            }
        item = grouped[key]
        item["tramites_vendidos"] += 1
        item["total_vendido"] = Decimal(str(item["total_vendido"])) + venta_total
        if item["primera_venta_at"] is None or (fecha_pago_utc is not None and fecha_pago_utc < item["primera_venta_at"]):
            item["primera_venta_at"] = fecha_pago_utc
        if item["ultima_venta_at"] is None or (fecha_pago_utc is not None and fecha_pago_utc > item["ultima_venta_at"]):
            item["ultima_venta_at"] = fecha_pago_utc
        if vendedor_id:
            item["vendedores_ids"].add(vendedor_id)
        if v.placa and v.placa not in item["placas"] and len(item["placas"]) < 8:
            item["placas"].append(v.placa)
        item["metodos_pago"][metodo] += venta_total

    sucursales = []
    for i in grouped.values():
        tramites = int(i["tramites_vendidos"])
        total = Decimal(str(i["total_vendido"]))
        ticket = (total / Decimal(tramites)).quantize(Decimal("0.01")) if tramites > 0 else Decimal("0")
        metodos = {
            k: Decimal(str(v)).quantize(Decimal("0.01"))
            for k, v in sorted(i["metodos_pago"].items(), key=lambda kv: kv[1], reverse=True)
        }
        sucursales.append(
            VentaSucursalItem(
                sucursal_id=i["sucursal_id"],
                sucursal_nombre=i["sucursal_nombre"],
                sucursal_codigo=i["sucursal_codigo"],
                tramites_vendidos=tramites,
                total_vendido=total.quantize(Decimal("0.01")),
                ticket_promedio=ticket,
                vendedores_unicos=len(i["vendedores_ids"]),
                primera_venta_at=_as_utc_aware(i["primera_venta_at"]),
                ultima_venta_at=_as_utc_aware(i["ultima_venta_at"]),
                placas=i["placas"],
                metodos_pago=metodos,
            )
        )

    sucursales.sort(
        key=lambda x: (Decimal(str(x.total_vendido)), x.tramites_vendidos),
        reverse=True,
    )
    if len(sucursales) > limit:
        sucursales = sucursales[:limit]

    total_vendido = sum((Decimal(str(s.total_vendido)) for s in sucursales), Decimal("0"))
    total_tramites = sum((int(s.tramites_vendidos) for s in sucursales), 0)
    ticket_general = (
        (total_vendido / Decimal(total_tramites)).quantize(Decimal("0.01"))
        if total_tramites > 0
        else Decimal("0")
    )

    return VentasSucursalResponse(
        periodo=etiqueta_fecha,
        resumen={
            "total_sucursales": len(sucursales),
            "total_tramites": total_tramites,
            "total_vendido": total_vendido.quantize(Decimal("0.01")),
            "ticket_promedio_general": ticket_general,
        },
        sucursales=sucursales,
    )


class EstadoSituacionGerencialResponse(BaseModel):
    fecha_corte: str
    alcance: str
    notas: list[str] = Field(default_factory=list)
    activos: dict
    pasivos: dict
    patrimonio: dict


@router.get("/estado-situacion-gerencial", response_model=EstadoSituacionGerencialResponse)
def estado_situacion_gerencial(
    request: Request,
    fecha_corte: Optional[date] = Query(None, description="Fecha de corte (default: hoy)."),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Estado de situación financiera gerencial preliminar (uso interno):
    - Activos: efectivo equivalente + CxC operativa.
    - Pasivos: CxP en cero mientras no exista módulo formal de obligaciones por pagar.
    - Patrimonio estimado: Activo - Pasivo.
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    corte_local = fecha_corte or datetime.now(REPORT_TZ).date()
    corte_utc = (
        datetime.combine(corte_local, time.max, tzinfo=REPORT_TZ)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )

    saldo_caja = (
        db.query(func.sum(MovimientoCaja.monto))
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at <= corte_utc,
            )
        )
        .scalar()
        or Decimal("0")
    )
    saldo_tesoreria = (
        db.query(func.sum(MovimientoTesoreria.monto))
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento <= corte_utc,
            )
        )
        .scalar()
        or Decimal("0")
    )
    efectivo_equivalente = Decimal(str(saldo_caja or 0)) + Decimal(str(saldo_tesoreria or 0))

    cxc_operativa = (
        db.query(func.sum(VehiculoProceso.total_cobrado))
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro <= corte_utc,
                VehiculoProceso.fecha_pago.is_(None),
                VehiculoProceso.total_cobrado > 0,
                _no_pruebas_auditoria_clause(),
            )
        )
        .scalar()
        or Decimal("0")
    )
    cxc_operativa = Decimal(str(cxc_operativa or 0))

    activo_total = efectivo_equivalente + cxc_operativa
    cxp_proveedores = Decimal("0")
    pasivo_total = cxp_proveedores
    patrimonio_estimado = activo_total - pasivo_total

    return EstadoSituacionGerencialResponse(
        fecha_corte=corte_local.isoformat(),
        alcance="gerencial_preliminar",
        notas=[
            "Este reporte es de uso gerencial interno y no reemplaza estados financieros oficiales NIIF.",
            "CxP proveedores se muestra en cero hasta implementar el módulo formal de obligaciones por pagar.",
            "Los saldos se calculan con base en movimientos de caja/tesorería y cartera operativa (vehículos sin pago).",
        ],
        activos={
            "efectivo_equivalente": efectivo_equivalente.quantize(Decimal("0.01")),
            "cxc_operativa": cxc_operativa.quantize(Decimal("0.01")),
            "total_activos": activo_total.quantize(Decimal("0.01")),
        },
        pasivos={
            "cxp_proveedores": cxp_proveedores.quantize(Decimal("0.01")),
            "total_pasivos": pasivo_total.quantize(Decimal("0.01")),
        },
        patrimonio={
            "patrimonio_estimado": patrimonio_estimado.quantize(Decimal("0.01")),
        },
    )


class BalancePruebaCuentaItem(BaseModel):
    codigo: str
    nombre: str
    naturaleza: str
    debito: Decimal
    credito: Decimal
    saldo: Decimal
    origenes: list[str] = Field(default_factory=list)


class BalancePruebaGerencialResponse(BaseModel):
    fecha_corte: str
    alcance: str
    notas: list[str] = Field(default_factory=list)
    resumen: dict
    cuentas: list[BalancePruebaCuentaItem]


@router.get("/balance-prueba-gerencial", response_model=BalancePruebaGerencialResponse)
def balance_prueba_gerencial(
    request: Request,
    fecha_corte: Optional[date] = Query(None, description="Fecha de corte (default: hoy)."),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Balance de prueba gerencial preliminar (interno), armado desde movimientos reales
    de Caja y Tesorería con reglas de mapeo contable explícitas.
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    corte_local = fecha_corte or datetime.now(REPORT_TZ).date()
    corte_utc = (
        datetime.combine(corte_local, time.max, tzinfo=REPORT_TZ)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )

    def _is_efectivo(metodo_raw: object) -> bool:
        m = str(getattr(metodo_raw, "value", metodo_raw) or "").strip().lower()
        return m == "efectivo"

    def _asset_account_for_move(*, metodo_raw: object, ingresa_efectivo: bool | None = None) -> tuple[str, str]:
        if ingresa_efectivo is False:
            return ("111005", "Bancos")
        return ("110505", "Caja general") if _is_efectivo(metodo_raw) else ("111005", "Bancos")

    def _gasto_cuenta_tesoreria(cat_raw: object) -> tuple[str, str]:
        cat = str(getattr(cat_raw, "value", cat_raw) or "").strip().lower()
        mapping = {
            "nomina": ("510506", "Gastos de personal"),
            "arriendo": ("512001", "Arrendamientos"),
            "servicios_publicos": ("513505", "Servicios publicos"),
            "mantenimiento": ("514595", "Mantenimiento y reparaciones"),
            "impuestos": ("511595", "Impuestos asumidos"),
            "compra_inventario": ("143505", "Inventarios de operacion"),
            "proveedores": ("519595", "Gastos operacionales varios"),
            "otros_gastos": ("519595", "Gastos operacionales varios"),
            "ajuste_correccion": ("539595", "Ajustes y correcciones"),
        }
        return mapping.get(cat, ("519595", "Gastos operacionales varios"))

    def _ingreso_cuenta_caja(tipo_raw: object) -> tuple[str, str]:
        t = str(getattr(tipo_raw, "value", tipo_raw) or "").strip().lower()
        if t in {"rtm", "comision_soat"}:
            return ("413595", "Ingresos de operacion CDA")
        return ("429595", "Ingresos diversos")

    cuentas: dict[str, dict] = {}

    def _acc(codigo: str, nombre: str, naturaleza: str, deb: Decimal, cred: Decimal, origen: str):
        if codigo not in cuentas:
            cuentas[codigo] = {
                "codigo": codigo,
                "nombre": nombre,
                "naturaleza": naturaleza,
                "debito": Decimal("0"),
                "credito": Decimal("0"),
                "origenes": set(),
            }
        cuentas[codigo]["debito"] += Decimal(str(deb or 0))
        cuentas[codigo]["credito"] += Decimal(str(cred or 0))
        if origen:
            cuentas[codigo]["origenes"].add(origen)

    movs_caja = (
        db.query(MovimientoCaja)
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at <= corte_utc,
            )
        )
        .all()
    )
    for m in movs_caja:
        amount = abs(Decimal(str(m.monto or 0)))
        if amount <= 0:
            continue
        asset_code, asset_name = _asset_account_for_move(
            metodo_raw=m.metodo_pago,
            ingresa_efectivo=bool(getattr(m, "ingresa_efectivo", True)),
        )
        if Decimal(str(m.monto or 0)) > 0:
            rev_code, rev_name = _ingreso_cuenta_caja(getattr(m, "tipo", ""))
            _acc(asset_code, asset_name, "debito", amount, Decimal("0"), "caja")
            _acc(rev_code, rev_name, "credito", Decimal("0"), amount, "caja")
        else:
            tipo_raw = str(getattr(getattr(m, "tipo", None), "value", getattr(m, "tipo", "")) or "").strip().lower()
            if tipo_raw == "devolucion":
                gasto_code, gasto_name = ("417595", "Devoluciones en ventas")
            elif tipo_raw == "ajuste":
                gasto_code, gasto_name = ("539595", "Ajustes y correcciones")
            else:
                gasto_code, gasto_name = ("519595", "Gastos operacionales varios")
            _acc(gasto_code, gasto_name, "debito", amount, Decimal("0"), "caja")
            _acc(asset_code, asset_name, "debito", Decimal("0"), amount, "caja")

    movs_tes = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento <= corte_utc,
            )
        )
        .all()
    )
    for m in movs_tes:
        amount = abs(Decimal(str(m.monto or 0)))
        if amount <= 0:
            continue
        asset_code, asset_name = _asset_account_for_move(metodo_raw=m.metodo_pago)
        if Decimal(str(m.monto or 0)) > 0:
            cat_ing = str(getattr(getattr(m, "categoria_ingreso", None), "value", getattr(m, "categoria_ingreso", "")) or "").strip().lower()
            if cat_ing == "traslado_caja":
                contra_code, contra_name = ("110505", "Caja general")
            else:
                contra_code, contra_name = ("429595", "Ingresos diversos")
            _acc(asset_code, asset_name, "debito", amount, Decimal("0"), "tesoreria")
            _acc(contra_code, contra_name, "credito", Decimal("0"), amount, "tesoreria")
        else:
            gasto_code, gasto_name = _gasto_cuenta_tesoreria(getattr(m, "categoria_egreso", ""))
            _acc(gasto_code, gasto_name, "debito", amount, Decimal("0"), "tesoreria")
            _acc(asset_code, asset_name, "debito", Decimal("0"), amount, "tesoreria")

    out: list[BalancePruebaCuentaItem] = []
    total_deb = Decimal("0")
    total_cred = Decimal("0")
    for code in sorted(cuentas.keys()):
        row = cuentas[code]
        deb = Decimal(str(row["debito"])).quantize(Decimal("0.01"))
        cred = Decimal(str(row["credito"])).quantize(Decimal("0.01"))
        naturaleza = row["naturaleza"]
        saldo = (deb - cred) if naturaleza == "debito" else (cred - deb)
        total_deb += deb
        total_cred += cred
        out.append(
            BalancePruebaCuentaItem(
                codigo=code,
                nombre=row["nombre"],
                naturaleza=naturaleza,
                debito=deb,
                credito=cred,
                saldo=saldo.quantize(Decimal("0.01")),
                origenes=sorted(list(row["origenes"])),
            )
        )

    diferencia = (total_deb - total_cred).quantize(Decimal("0.01"))
    return BalancePruebaGerencialResponse(
        fecha_corte=corte_local.isoformat(),
        alcance="gerencial_preliminar",
        notas=[
            "Este balance de prueba es gerencial preliminar para control interno, no estado oficial NIIF.",
            "Se construye desde movimientos reales de caja y tesoreria con mapeo de cuentas de control.",
            "No incluye aún devengos, depreciaciones ni obligaciones contables fuera de los módulos operativos.",
        ],
        resumen={
            "total_debitos": total_deb.quantize(Decimal("0.01")),
            "total_creditos": total_cred.quantize(Decimal("0.01")),
            "diferencia_debito_credito": diferencia,
            "cuadre_ok": bool(diferencia == Decimal("0.00")),
            "total_cuentas": len(out),
        },
        cuentas=out,
    )


class BalancePruebaTerceroItem(BaseModel):
    codigo_cuenta: str
    nombre_cuenta: str
    tercero_tipo_documento: str
    tercero_documento: str
    tercero_nombre: str
    debito: Decimal
    credito: Decimal
    saldo: Decimal
    origenes: list[str] = Field(default_factory=list)


class BalancePruebaTerceroGerencialResponse(BaseModel):
    fecha_corte: str
    alcance: str
    notas: list[str] = Field(default_factory=list)
    resumen: dict
    filas: list[BalancePruebaTerceroItem]


@router.get("/balance-prueba-tercero-gerencial", response_model=BalancePruebaTerceroGerencialResponse)
def balance_prueba_tercero_gerencial(
    request: Request,
    fecha_corte: Optional[date] = Query(None, description="Fecha de corte (default: hoy)."),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    limit: int = Query(2000, ge=1, le=20000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Balance de prueba por tercero (gerencial preliminar):
    agrupa por cuenta + tercero para trazabilidad operativa.
    """
    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    corte_local = fecha_corte or datetime.now(REPORT_TZ).date()
    corte_utc = (
        datetime.combine(corte_local, time.max, tzinfo=REPORT_TZ)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )

    def _is_efectivo(metodo_raw: object) -> bool:
        m = str(getattr(metodo_raw, "value", metodo_raw) or "").strip().lower()
        return m == "efectivo"

    def _asset_account_for_move(*, metodo_raw: object, ingresa_efectivo: bool | None = None) -> tuple[str, str]:
        if ingresa_efectivo is False:
            return ("111005", "Bancos")
        return ("110505", "Caja general") if _is_efectivo(metodo_raw) else ("111005", "Bancos")

    def _gasto_cuenta_tesoreria(cat_raw: object) -> tuple[str, str]:
        cat = str(getattr(cat_raw, "value", cat_raw) or "").strip().lower()
        mapping = {
            "nomina": ("510506", "Gastos de personal"),
            "arriendo": ("512001", "Arrendamientos"),
            "servicios_publicos": ("513505", "Servicios publicos"),
            "mantenimiento": ("514595", "Mantenimiento y reparaciones"),
            "impuestos": ("511595", "Impuestos asumidos"),
            "compra_inventario": ("143505", "Inventarios de operacion"),
            "proveedores": ("519595", "Gastos operacionales varios"),
            "otros_gastos": ("519595", "Gastos operacionales varios"),
            "ajuste_correccion": ("539595", "Ajustes y correcciones"),
        }
        return mapping.get(cat, ("519595", "Gastos operacionales varios"))

    def _ingreso_cuenta_caja(tipo_raw: object) -> tuple[str, str]:
        t = str(getattr(tipo_raw, "value", tipo_raw) or "").strip().lower()
        if t in {"rtm", "comision_soat"}:
            return ("413595", "Ingresos de operacion CDA")
        return ("429595", "Ingresos diversos")

    grouped: dict[tuple[str, str, str], dict] = {}

    def _acc(
        *,
        codigo: str,
        nombre: str,
        tercero_tipo_documento: str,
        tercero_documento: str,
        tercero_nombre: str,
        deb: Decimal,
        cred: Decimal,
        origen: str,
    ):
        third_key = (
            (tercero_tipo_documento or "NA").strip().upper()[:20] or "NA",
            (tercero_documento or "SIN_DOCUMENTO").strip().upper()[:80] or "SIN_DOCUMENTO",
            (tercero_nombre or "SIN TERCERO").strip().upper()[:300] or "SIN TERCERO",
        )
        key = (codigo, third_key[0], third_key[1] + "|" + third_key[2])
        if key not in grouped:
            grouped[key] = {
                "codigo_cuenta": codigo,
                "nombre_cuenta": nombre,
                "tercero_tipo_documento": third_key[0],
                "tercero_documento": third_key[1],
                "tercero_nombre": third_key[2],
                "debito": Decimal("0"),
                "credito": Decimal("0"),
                "origenes": set(),
            }
        grouped[key]["debito"] += Decimal(str(deb or 0))
        grouped[key]["credito"] += Decimal(str(cred or 0))
        grouped[key]["origenes"].add(origen)

    veh_by_id: dict[UUID, VehiculoProceso] = {}
    movs_caja = (
        db.query(MovimientoCaja)
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at <= corte_utc,
            )
        )
        .all()
    )
    veh_ids = {m.vehiculo_id for m in movs_caja if m.vehiculo_id}
    if veh_ids:
        for v in db.query(VehiculoProceso).filter(VehiculoProceso.id.in_(list(veh_ids))).all():
            veh_by_id[v.id] = v

    for m in movs_caja:
        amount = abs(Decimal(str(m.monto or 0)))
        if amount <= 0:
            continue
        asset_code, asset_name = _asset_account_for_move(
            metodo_raw=m.metodo_pago,
            ingresa_efectivo=bool(getattr(m, "ingresa_efectivo", True)),
        )

        veh = veh_by_id.get(m.vehiculo_id) if m.vehiculo_id else None
        if veh:
            td = (veh.cliente_tipo_documento or "NA").strip().upper()
            nd = (veh.cliente_documento or "SIN_DOCUMENTO").strip()
            nm = (veh.cliente_nombre or "SIN TERCERO").strip()
        else:
            td = (m.beneficiario_tipo_identificacion or "NA").strip().upper()
            nd = (m.beneficiario_numero_identificacion or "SIN_DOCUMENTO").strip()
            nm = (m.beneficiario or "SIN TERCERO").strip()

        if Decimal(str(m.monto or 0)) > 0:
            rev_code, rev_name = _ingreso_cuenta_caja(getattr(m, "tipo", ""))
            _acc(
                codigo=asset_code,
                nombre=asset_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=amount,
                cred=Decimal("0"),
                origen="caja",
            )
            _acc(
                codigo=rev_code,
                nombre=rev_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=Decimal("0"),
                cred=amount,
                origen="caja",
            )
        else:
            tipo_raw = str(getattr(getattr(m, "tipo", None), "value", getattr(m, "tipo", "")) or "").strip().lower()
            if tipo_raw == "devolucion":
                gasto_code, gasto_name = ("417595", "Devoluciones en ventas")
            elif tipo_raw == "ajuste":
                gasto_code, gasto_name = ("539595", "Ajustes y correcciones")
            else:
                gasto_code, gasto_name = ("519595", "Gastos operacionales varios")
            _acc(
                codigo=gasto_code,
                nombre=gasto_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=amount,
                cred=Decimal("0"),
                origen="caja",
            )
            _acc(
                codigo=asset_code,
                nombre=asset_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=Decimal("0"),
                cred=amount,
                origen="caja",
            )

    movs_tes = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento <= corte_utc,
            )
        )
        .all()
    )
    for m in movs_tes:
        amount = abs(Decimal(str(m.monto or 0)))
        if amount <= 0:
            continue
        asset_code, asset_name = _asset_account_for_move(metodo_raw=m.metodo_pago)
        td = (m.beneficiario_tipo_identificacion or "NA").strip().upper()
        nd = (m.beneficiario_numero_identificacion or "SIN_DOCUMENTO").strip()
        nm = (m.beneficiario or "SIN TERCERO").strip()
        if Decimal(str(m.monto or 0)) > 0:
            cat_ing = str(getattr(getattr(m, "categoria_ingreso", None), "value", getattr(m, "categoria_ingreso", "")) or "").strip().lower()
            if cat_ing == "traslado_caja":
                contra_code, contra_name = ("110505", "Caja general")
            else:
                contra_code, contra_name = ("429595", "Ingresos diversos")
            _acc(
                codigo=asset_code,
                nombre=asset_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=amount,
                cred=Decimal("0"),
                origen="tesoreria",
            )
            _acc(
                codigo=contra_code,
                nombre=contra_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=Decimal("0"),
                cred=amount,
                origen="tesoreria",
            )
        else:
            gasto_code, gasto_name = _gasto_cuenta_tesoreria(getattr(m, "categoria_egreso", ""))
            _acc(
                codigo=gasto_code,
                nombre=gasto_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=amount,
                cred=Decimal("0"),
                origen="tesoreria",
            )
            _acc(
                codigo=asset_code,
                nombre=asset_name,
                tercero_tipo_documento=td,
                tercero_documento=nd,
                tercero_nombre=nm,
                deb=Decimal("0"),
                cred=amount,
                origen="tesoreria",
            )

    rows: list[BalancePruebaTerceroItem] = []
    total_deb = Decimal("0")
    total_cred = Decimal("0")
    for k in sorted(grouped.keys(), key=lambda x: (x[0], x[1], x[2])):
        g = grouped[k]
        deb = Decimal(str(g["debito"])).quantize(Decimal("0.01"))
        cred = Decimal(str(g["credito"])).quantize(Decimal("0.01"))
        saldo = (deb - cred).quantize(Decimal("0.01"))
        total_deb += deb
        total_cred += cred
        rows.append(
            BalancePruebaTerceroItem(
                codigo_cuenta=g["codigo_cuenta"],
                nombre_cuenta=g["nombre_cuenta"],
                tercero_tipo_documento=g["tercero_tipo_documento"],
                tercero_documento=g["tercero_documento"],
                tercero_nombre=g["tercero_nombre"],
                debito=deb,
                credito=cred,
                saldo=saldo,
                origenes=sorted(list(g["origenes"])),
            )
        )

    if len(rows) > limit:
        rows = rows[:limit]

    diferencia = (total_deb - total_cred).quantize(Decimal("0.01"))
    return BalancePruebaTerceroGerencialResponse(
        fecha_corte=corte_local.isoformat(),
        alcance="gerencial_preliminar",
        notas=[
            "Reporte gerencial preliminar, no equivalente al auxiliar contable NIIF oficial.",
            "Agrupa por cuenta y tercero usando fuentes operativas de caja, tesoreria y ventas.",
            "Terceros sin dato tributario completo se consolidan como SIN_DOCUMENTO/SIN TERCERO.",
        ],
        resumen={
            "total_debitos": total_deb.quantize(Decimal("0.01")),
            "total_creditos": total_cred.quantize(Decimal("0.01")),
            "diferencia_debito_credito": diferencia,
            "cuadre_ok": bool(diferencia == Decimal("0.00")),
            "total_filas": len(rows),
        },
        filas=rows,
    )


class EstadoResultadoGerencialResponse(BaseModel):
    periodo: str
    alcance: str
    notas: list[str] = Field(default_factory=list)
    ingresos: dict
    gastos: dict
    resultado: dict


@router.get("/estado-resultado-gerencial", response_model=EstadoResultadoGerencialResponse)
def estado_resultado_gerencial(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)."),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Estado de resultado integral gerencial preliminar (uso interno).
    Basado en ventas cobradas + movimientos de caja/tesorería.
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id

    ventas = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.total_cobrado > 0,
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
                _no_pruebas_auditoria_clause(),
            )
        )
        .all()
    )
    ingresos_operacionales = sum((Decimal(str(v.total_cobrado or 0)) for v in ventas), Decimal("0"))

    caja_egresos = (
        db.query(MovimientoCaja)
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.monto < 0,
            )
        )
        .all()
    )
    contra_ingresos = Decimal("0")
    gastos_caja = Decimal("0")
    for m in caja_egresos:
        amount = abs(Decimal(str(m.monto or 0)))
        t = str(getattr(getattr(m, "tipo", None), "value", getattr(m, "tipo", "")) or "").strip().lower()
        if t == "devolucion":
            contra_ingresos += amount
        else:
            gastos_caja += amount

    tes_ingresos = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                MovimientoTesoreria.tipo == TipoMovimientoTesoreria.INGRESO,
            )
        )
        .all()
    )
    otros_ingresos = Decimal("0")
    otros_ingresos_detalle: dict[str, Decimal] = defaultdict(Decimal)
    for m in tes_ingresos:
        cat = str(getattr(getattr(m, "categoria_ingreso", None), "value", getattr(m, "categoria_ingreso", "")) or "").strip().lower()
        if cat == "traslado_caja":
            continue
        amt = Decimal(str(m.monto or 0))
        if amt > 0:
            otros_ingresos += amt
            key = cat or "sin_categoria"
            otros_ingresos_detalle[key] += amt

    tes_egresos = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                MovimientoTesoreria.tipo == TipoMovimientoTesoreria.EGRESO,
            )
        )
        .all()
    )
    gastos_tesoreria = Decimal("0")
    gastos_tesoreria_detalle: dict[str, Decimal] = defaultdict(Decimal)
    for m in tes_egresos:
        amt = abs(Decimal(str(m.monto or 0)))
        if amt <= 0:
            continue
        gastos_tesoreria += amt
        key = str(getattr(getattr(m, "categoria_egreso", None), "value", getattr(m, "categoria_egreso", "")) or "").strip().lower() or "sin_categoria"
        gastos_tesoreria_detalle[key] += amt

    ingresos_netos_operacionales = ingresos_operacionales - contra_ingresos
    gastos_operacionales = gastos_caja + gastos_tesoreria
    utilidad_operacional = ingresos_netos_operacionales - gastos_operacionales
    resultado_antes_impuestos = utilidad_operacional + otros_ingresos
    impuesto_estimado = Decimal("0")
    resultado_neto_estimado = resultado_antes_impuestos - impuesto_estimado
    base_margen = ingresos_netos_operacionales if ingresos_netos_operacionales != 0 else Decimal("1")
    margen_neto_pct = (resultado_neto_estimado / base_margen) * Decimal("100")

    return EstadoResultadoGerencialResponse(
        periodo=etiqueta_fecha,
        alcance="gerencial_preliminar",
        notas=[
            "Este reporte es de uso gerencial interno y no reemplaza estado de resultado NIIF oficial.",
            "Ingresos operacionales se calculan con trámites cobrados; traslados internos de tesorería no se cuentan como ingreso.",
            "Impuesto a la renta estimado se muestra en 0 hasta integrar módulo tributario/contable formal.",
        ],
        ingresos={
            "operacionales_brutos": ingresos_operacionales.quantize(Decimal("0.01")),
            "contra_ingresos": contra_ingresos.quantize(Decimal("0.01")),
            "operacionales_netos": ingresos_netos_operacionales.quantize(Decimal("0.01")),
            "otros_ingresos": otros_ingresos.quantize(Decimal("0.01")),
            "otros_ingresos_detalle": {
                k: Decimal(str(v)).quantize(Decimal("0.01"))
                for k, v in sorted(otros_ingresos_detalle.items(), key=lambda x: x[0])
            },
        },
        gastos={
            "gastos_caja": gastos_caja.quantize(Decimal("0.01")),
            "gastos_tesoreria": gastos_tesoreria.quantize(Decimal("0.01")),
            "gastos_tesoreria_detalle": {
                k: Decimal(str(v)).quantize(Decimal("0.01"))
                for k, v in sorted(gastos_tesoreria_detalle.items(), key=lambda x: x[0])
            },
            "gastos_operacionales_totales": gastos_operacionales.quantize(Decimal("0.01")),
        },
        resultado={
            "utilidad_operacional": utilidad_operacional.quantize(Decimal("0.01")),
            "resultado_antes_impuestos": resultado_antes_impuestos.quantize(Decimal("0.01")),
            "impuesto_estimado": impuesto_estimado.quantize(Decimal("0.01")),
            "resultado_neto_estimado": resultado_neto_estimado.quantize(Decimal("0.01")),
            "margen_neto_pct": margen_neto_pct.quantize(Decimal("0.01")),
        },
    )


class EstadoFlujoEfectivoGerencialResponse(BaseModel):
    periodo: str
    alcance: str
    notas: list[str] = Field(default_factory=list)
    saldos: dict
    operacion: dict
    inversion: dict
    financiacion: dict
    internos: dict
    conciliacion: dict


@router.get("/estado-flujo-efectivo-gerencial", response_model=EstadoFlujoEfectivoGerencialResponse)
def estado_flujo_efectivo_gerencial(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)."),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Estado de flujo de efectivo gerencial preliminar (método directo simplificado).
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id
    inicio_prev = fecha_inicio_dt - timedelta(microseconds=1)

    saldo_caja_ini = (
        db.query(func.sum(MovimientoCaja.monto))
        .filter(_mc_scope(db, tid, scope_sid, MovimientoCaja.created_at <= inicio_prev))
        .scalar()
        or Decimal("0")
    )
    saldo_tes_ini = (
        db.query(func.sum(MovimientoTesoreria.monto))
        .filter(_mt_scope(tid, scope_sid, MovimientoTesoreria.fecha_movimiento <= inicio_prev))
        .scalar()
        or Decimal("0")
    )
    saldo_inicial = Decimal(str(saldo_caja_ini or 0)) + Decimal(str(saldo_tes_ini or 0))

    saldo_caja_fin = (
        db.query(func.sum(MovimientoCaja.monto))
        .filter(_mc_scope(db, tid, scope_sid, MovimientoCaja.created_at <= fecha_fin_dt))
        .scalar()
        or Decimal("0")
    )
    saldo_tes_fin = (
        db.query(func.sum(MovimientoTesoreria.monto))
        .filter(_mt_scope(tid, scope_sid, MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt))
        .scalar()
        or Decimal("0")
    )
    saldo_final = Decimal(str(saldo_caja_fin or 0)) + Decimal(str(saldo_tes_fin or 0))

    operacion_entradas = Decimal("0")
    operacion_salidas = Decimal("0")
    inversion_entradas = Decimal("0")
    inversion_salidas = Decimal("0")
    financiacion_entradas = Decimal("0")
    financiacion_salidas = Decimal("0")
    internos_traslados = Decimal("0")

    movs_caja = (
        db.query(MovimientoCaja)
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
            )
        )
        .all()
    )
    for m in movs_caja:
        amt = Decimal(str(m.monto or 0))
        if amt > 0:
            operacion_entradas += amt
        elif amt < 0:
            operacion_salidas += abs(amt)

    movs_tes = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
            )
        )
        .all()
    )
    for m in movs_tes:
        amt = Decimal(str(m.monto or 0))
        if amt == 0:
            continue
        tipo = str(getattr(getattr(m, "tipo", None), "value", getattr(m, "tipo", "")) or "").strip().lower()
        cat_ing = str(getattr(getattr(m, "categoria_ingreso", None), "value", getattr(m, "categoria_ingreso", "")) or "").strip().lower()
        cat_egr = str(getattr(getattr(m, "categoria_egreso", None), "value", getattr(m, "categoria_egreso", "")) or "").strip().lower()

        if tipo == "ingreso":
            if cat_ing == "traslado_caja":
                internos_traslados += abs(amt)
            elif cat_ing in {"prestamo", "aporte_socio"}:
                financiacion_entradas += abs(amt)
            else:
                operacion_entradas += abs(amt)
        elif tipo == "egreso":
            if cat_egr in {"compra_inventario"}:
                inversion_salidas += abs(amt)
            else:
                operacion_salidas += abs(amt)

    flujo_operacion_neto = operacion_entradas - operacion_salidas
    flujo_inversion_neto = inversion_entradas - inversion_salidas
    flujo_financiacion_neto = financiacion_entradas - financiacion_salidas
    variacion_neta_periodo = flujo_operacion_neto + flujo_inversion_neto + flujo_financiacion_neto
    conciliacion_esperada = saldo_inicial + variacion_neta_periodo
    diferencia_conciliacion = saldo_final - conciliacion_esperada

    return EstadoFlujoEfectivoGerencialResponse(
        periodo=etiqueta_fecha,
        alcance="gerencial_preliminar",
        notas=[
            "Reporte gerencial preliminar (método directo simplificado), no reemplaza flujo NIIF oficial.",
            "Los traslados internos caja->tesorería se muestran por separado para control y no alteran el flujo neto consolidado.",
            "Clasificación de actividades se basa en categorías operativas actuales del sistema.",
        ],
        saldos={
            "saldo_inicial": saldo_inicial.quantize(Decimal("0.01")),
            "saldo_final": saldo_final.quantize(Decimal("0.01")),
            "variacion_neta": variacion_neta_periodo.quantize(Decimal("0.01")),
        },
        operacion={
            "entradas": operacion_entradas.quantize(Decimal("0.01")),
            "salidas": operacion_salidas.quantize(Decimal("0.01")),
            "neto": flujo_operacion_neto.quantize(Decimal("0.01")),
        },
        inversion={
            "entradas": inversion_entradas.quantize(Decimal("0.01")),
            "salidas": inversion_salidas.quantize(Decimal("0.01")),
            "neto": flujo_inversion_neto.quantize(Decimal("0.01")),
        },
        financiacion={
            "entradas": financiacion_entradas.quantize(Decimal("0.01")),
            "salidas": financiacion_salidas.quantize(Decimal("0.01")),
            "neto": flujo_financiacion_neto.quantize(Decimal("0.01")),
        },
        internos={
            "traslados_caja_tesoreria": internos_traslados.quantize(Decimal("0.01")),
        },
        conciliacion={
            "saldo_inicial_mas_flujos": conciliacion_esperada.quantize(Decimal("0.01")),
            "saldo_final_real": saldo_final.quantize(Decimal("0.01")),
            "diferencia_conciliacion": diferencia_conciliacion.quantize(Decimal("0.01")),
            "conciliacion_ok": bool(diferencia_conciliacion.quantize(Decimal("0.01")) == Decimal("0.00")),
        },
    )


class EstadoCambiosPatrimonioGerencialResponse(BaseModel):
    periodo: str
    alcance: str
    notas: list[str] = Field(default_factory=list)
    patrimonio: dict
    movimientos: dict
    conciliacion: dict


@router.get("/estado-cambios-patrimonio-gerencial", response_model=EstadoCambiosPatrimonioGerencialResponse)
def estado_cambios_patrimonio_gerencial(
    request: Request,
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)."),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    sucursal_id: Optional[UUID] = Query(None),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Estado de cambios en el patrimonio gerencial preliminar (uso interno).
    """
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    payload = getattr(request.state, "tenant_jwt_payload", None) or {}
    scope_sid = resolve_reporte_sucursal_id(
        db,
        current_user,
        payload if isinstance(payload, dict) else {},
        sucursal_id_param=sucursal_id,
        consolidar_todas=consolidar_todas,
    )
    tid = current_user.tenant_id
    inicio_prev = fecha_inicio_dt - timedelta(microseconds=1)

    # Patrimonio inicial/final estimado con la misma base del estado de situación gerencial.
    saldo_caja_ini = (
        db.query(func.sum(MovimientoCaja.monto))
        .filter(_mc_scope(db, tid, scope_sid, MovimientoCaja.created_at <= inicio_prev))
        .scalar()
        or Decimal("0")
    )
    saldo_tes_ini = (
        db.query(func.sum(MovimientoTesoreria.monto))
        .filter(_mt_scope(tid, scope_sid, MovimientoTesoreria.fecha_movimiento <= inicio_prev))
        .scalar()
        or Decimal("0")
    )
    cxc_ini = (
        db.query(func.sum(VehiculoProceso.total_cobrado))
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro <= inicio_prev,
                VehiculoProceso.fecha_pago.is_(None),
                VehiculoProceso.total_cobrado > 0,
                _no_pruebas_auditoria_clause(),
            )
        )
        .scalar()
        or Decimal("0")
    )
    patrimonio_inicial = Decimal(str(saldo_caja_ini or 0)) + Decimal(str(saldo_tes_ini or 0)) + Decimal(str(cxc_ini or 0))

    saldo_caja_fin = (
        db.query(func.sum(MovimientoCaja.monto))
        .filter(_mc_scope(db, tid, scope_sid, MovimientoCaja.created_at <= fecha_fin_dt))
        .scalar()
        or Decimal("0")
    )
    saldo_tes_fin = (
        db.query(func.sum(MovimientoTesoreria.monto))
        .filter(_mt_scope(tid, scope_sid, MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt))
        .scalar()
        or Decimal("0")
    )
    cxc_fin = (
        db.query(func.sum(VehiculoProceso.total_cobrado))
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_registro <= fecha_fin_dt,
                VehiculoProceso.fecha_pago.is_(None),
                VehiculoProceso.total_cobrado > 0,
                _no_pruebas_auditoria_clause(),
            )
        )
        .scalar()
        or Decimal("0")
    )
    patrimonio_final_real = Decimal(str(saldo_caja_fin or 0)) + Decimal(str(saldo_tes_fin or 0)) + Decimal(str(cxc_fin or 0))

    # Resultado neto estimado del periodo (misma base del estado de resultado gerencial).
    ventas = (
        db.query(VehiculoProceso)
        .filter(
            _vp_scope(
                tid,
                scope_sid,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.total_cobrado > 0,
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
                _no_pruebas_auditoria_clause(),
            )
        )
        .all()
    )
    ingresos_operacionales = sum((Decimal(str(v.total_cobrado or 0)) for v in ventas), Decimal("0"))

    caja_egresos = (
        db.query(MovimientoCaja)
        .filter(
            _mc_scope(
                db,
                tid,
                scope_sid,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.monto < 0,
            )
        )
        .all()
    )
    contra_ingresos = Decimal("0")
    gastos_caja = Decimal("0")
    for m in caja_egresos:
        amt = abs(Decimal(str(m.monto or 0)))
        tipo = str(getattr(getattr(m, "tipo", None), "value", getattr(m, "tipo", "")) or "").strip().lower()
        if tipo == "devolucion":
            contra_ingresos += amt
        else:
            gastos_caja += amt

    tes_ingresos = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                MovimientoTesoreria.tipo == TipoMovimientoTesoreria.INGRESO,
            )
        )
        .all()
    )
    otros_ingresos = Decimal("0")
    aportes_socios = Decimal("0")
    ajustes_patrimoniales_pos = Decimal("0")
    for m in tes_ingresos:
        cat = str(getattr(getattr(m, "categoria_ingreso", None), "value", getattr(m, "categoria_ingreso", "")) or "").strip().lower()
        amt = Decimal(str(m.monto or 0))
        if amt <= 0:
            continue
        if cat == "traslado_caja":
            continue
        if cat == "aporte_socio":
            aportes_socios += amt
            continue
        if cat == "ajuste_correccion":
            ajustes_patrimoniales_pos += amt
            continue
        otros_ingresos += amt

    tes_egresos = (
        db.query(MovimientoTesoreria)
        .filter(
            _mt_scope(
                tid,
                scope_sid,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                MovimientoTesoreria.tipo == TipoMovimientoTesoreria.EGRESO,
            )
        )
        .all()
    )
    gastos_tesoreria = Decimal("0")
    retiros_socios = Decimal("0")
    ajustes_patrimoniales_neg = Decimal("0")
    for m in tes_egresos:
        cat = str(getattr(getattr(m, "categoria_egreso", None), "value", getattr(m, "categoria_egreso", "")) or "").strip().lower()
        amt = abs(Decimal(str(m.monto or 0)))
        if amt <= 0:
            continue
        concepto = str(m.concepto or "").strip().lower()
        is_retiro_socio = any(token in concepto for token in ("retiro socio", "retiro socios", "dividendo", "distribucion utilidad", "utilidades socios"))
        if is_retiro_socio:
            retiros_socios += amt
            continue
        if cat == "ajuste_correccion":
            ajustes_patrimoniales_neg += amt
            continue
        gastos_tesoreria += amt

    ingresos_netos_operacionales = ingresos_operacionales - contra_ingresos
    gastos_operacionales = gastos_caja + gastos_tesoreria
    resultado_neto_estimado = ingresos_netos_operacionales + otros_ingresos - gastos_operacionales
    ajustes_patrimoniales_netos = ajustes_patrimoniales_pos - ajustes_patrimoniales_neg

    patrimonio_final_estimado = patrimonio_inicial + resultado_neto_estimado + aportes_socios - retiros_socios + ajustes_patrimoniales_netos
    diferencia_conciliacion = patrimonio_final_real - patrimonio_final_estimado

    return EstadoCambiosPatrimonioGerencialResponse(
        periodo=etiqueta_fecha,
        alcance="gerencial_preliminar",
        notas=[
            "Reporte gerencial preliminar de uso interno; no reemplaza estado de cambios en el patrimonio NIIF oficial.",
            "El patrimonio base se estima con efectivo (caja/tesorería) + CxC operativa, sin módulo formal de pasivos patrimoniales.",
            "Retiros de socios se detectan por texto del concepto en egresos; validar redacción operativa para mejor precisión.",
        ],
        patrimonio={
            "patrimonio_inicial_estimado": patrimonio_inicial.quantize(Decimal("0.01")),
            "patrimonio_final_estimado": patrimonio_final_estimado.quantize(Decimal("0.01")),
            "patrimonio_final_real": patrimonio_final_real.quantize(Decimal("0.01")),
        },
        movimientos={
            "resultado_neto_estimado_periodo": resultado_neto_estimado.quantize(Decimal("0.01")),
            "aportes_socios": aportes_socios.quantize(Decimal("0.01")),
            "retiros_socios": retiros_socios.quantize(Decimal("0.01")),
            "ajustes_patrimoniales_netos": ajustes_patrimoniales_netos.quantize(Decimal("0.01")),
        },
        conciliacion={
            "patrimonio_inicial_mas_cambios": patrimonio_final_estimado.quantize(Decimal("0.01")),
            "patrimonio_final_real": patrimonio_final_real.quantize(Decimal("0.01")),
            "diferencia_conciliacion": diferencia_conciliacion.quantize(Decimal("0.01")),
            "conciliacion_ok": bool(diferencia_conciliacion.quantize(Decimal("0.01")) == Decimal("0.00")),
        },
    )
