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
from app.models.tesoreria import MovimientoTesoreria, TipoMovimientoTesoreria
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo
from app.models.tarifa import Tarifa
from app.models.sucursal import Sucursal
from app.models.factus import DocumentoSoporteElectronico, FacturaElectronica
from app.models.iva_provision import IvaProvisionRegistro
from app.models.appointment import Appointment

router = APIRouter()


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
        .filter(
            _mc_scope(
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

    movimientos_tesoreria = (
        db.query(MovimientoTesoreria)
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

    lista_caja = []
    for mov in movimientos_caja:
        # Obtener nombre de usuario
        usuario_nombre = mov.usuario.nombre_completo if mov.usuario else "Sistema"
        
        # Obtener información de la caja
        turno = mov.caja.turno.value if mov.caja else "N/A"
        
        # Determinar si es ingreso o egreso
        tipo_mov = "Ingreso" if mov.monto > 0 else "Egreso"
        
        sede_nombre = None
        if mov.caja and mov.caja.sucursal_id:
            s = db.query(Sucursal).filter(Sucursal.id == mov.caja.sucursal_id).first()
            sede_nombre = s.nombre if s else None
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
        lista_caja.append({
            "id": str(mov.id),
            "hora": mov.created_at.strftime("%H:%M:%S"),
            "_sort_ts": mov.created_at.isoformat(),
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
            "factura_emitida_en": fe_v.created_at.isoformat() if fe_v else None,
            "factura_pdf_archivado": bool(fe_v and (fe_v.pdf_storage_relpath or "").strip()),
            "beneficiario": getattr(mov, "beneficiario", None),
            "beneficiario_tipo_identificacion": getattr(mov, "beneficiario_tipo_identificacion", None),
            "beneficiario_numero_identificacion": getattr(mov, "beneficiario_numero_identificacion", None),
            "beneficiario_direccion": getattr(mov, "beneficiario_direccion", None),
            "beneficiario_email": getattr(mov, "beneficiario_email", None),
            "beneficiario_telefono": getattr(mov, "beneficiario_telefono", None),
            "beneficiario_factus_municipality_id": getattr(mov, "beneficiario_factus_municipality_id", None),
            "documento_soporte_numero": ds_row_caja.numero_documento if ds_row_caja else None,
            "documento_soporte_public_url": ds_row_caja.public_url if ds_row_caja else None,
            "documento_soporte_emitido_por": (
                unames.get(ds_row_caja.emitido_por_usuario_id)
                if ds_row_caja and ds_row_caja.emitido_por_usuario_id
                else None
            ),
            "documento_soporte_emitido_en": (
                ds_row_caja.created_at.isoformat() if ds_row_caja else None
            ),
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
        
        sede_t = None
        if mov.sucursal_id:
            s = db.query(Sucursal).filter(Sucursal.id == mov.sucursal_id).first()
            sede_t = s.nombre if s else None
        ds_row_tes = ds_map.get(("tesoreria", mov.id))
        lista_tesoreria.append({
            "id": str(mov.id),
            "hora": mov.fecha_movimiento.strftime("%H:%M:%S"),
            "_sort_ts": mov.fecha_movimiento.isoformat(),
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
            "vehiculo_id": None,
            "numero_factura_dian": None,
            "factura_public_url": None,
            "factura_emitida_por": None,
            "factura_emitida_en": None,
            "factura_pdf_archivado": False,
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
            "documento_soporte_emitido_en": (
                ds_row_tes.created_at.isoformat() if ds_row_tes else None
            ),
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
                "fecha_pago": v.fecha_pago.isoformat() if v.fecha_pago else None,
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
                "provisionado_en": mark.provisionado_en.isoformat() if mark else None,
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

    lista_tramites = []
    for veh in vehiculos:
        sede_n = None
        if veh.sucursal_id:
            s = db.query(Sucursal).filter(Sucursal.id == veh.sucursal_id).first()
            sede_n = s.nombre if s else None
        lista_tramites.append(
            {
                "id": str(veh.id),
                "hora_registro": veh.fecha_registro.strftime("%H:%M:%S"),
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
                fecha_apertura=caja.fecha_apertura,
                fecha_cierre=caja.fecha_cierre,
                turno=turno_val,
                monto_inicial=caja.monto_inicial,
                monto_final_sistema=caja.monto_final_sistema,
                monto_final_fisico=caja.monto_final_fisico,
                diferencia=caja.diferencia,
                observaciones_cierre=caja.observaciones_cierre,
            )
        )
    return out
