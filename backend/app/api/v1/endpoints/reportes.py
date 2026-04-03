"""
Endpoints de Reportes - Dashboard General y Consolidados
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, timedelta, date, timezone
from decimal import Decimal
from typing import Optional
from calendar import monthrange

from app.core.deps import get_db, get_contador_or_admin
from app.models.usuario import Usuario
from app.models.caja import MovimientoCaja
from app.models.tesoreria import MovimientoTesoreria
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo

router = APIRouter()


def resolve_report_date_window(
    *,
    fecha: Optional[date],
    fecha_inicio: Optional[date],
    fecha_fin: Optional[date],
) -> tuple[datetime, datetime, str]:
    """
    Resuelve y valida ventana de fechas para reportes.
    - Día: usa `fecha` o hoy.
    - Rango: requiere fecha_inicio y fecha_fin.
    """
    if (fecha_inicio is None) != (fecha_fin is None):
        raise ValueError("Debes enviar fecha_inicio y fecha_fin juntos para usar modo rango")

    if fecha_inicio and fecha_fin:
        if fecha_inicio > fecha_fin:
            raise ValueError("fecha_inicio no puede ser mayor que fecha_fin")
        inicio_dt = datetime.combine(fecha_inicio, datetime.min.time())
        fin_dt = datetime.combine(fecha_fin, datetime.max.time())
        label = f"{fecha_inicio.strftime('%Y-%m-%d')} a {fecha_fin.strftime('%Y-%m-%d')}"
        return inicio_dt, fin_dt, label

    fecha_base = fecha or date.today()
    inicio_dt = datetime.combine(fecha_base, datetime.min.time())
    fin_dt = datetime.combine(fecha_base, datetime.max.time())
    label = fecha_base.strftime("%Y-%m-%d")
    return inicio_dt, fin_dt, label


@router.get("/dashboard-general")
def obtener_dashboard_general(
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin)
):
    """
    Dashboard General del CDA - Consolidado de todos los módulos
    """
    fecha_base = fecha or date.today()
    fecha_inicio = datetime.combine(fecha_base, datetime.min.time())
    fecha_fin = datetime.combine(fecha_base, datetime.max.time())
    
    # ==================== INGRESOS DEL DÍA ====================
    
    # Ingresos de Caja (todos los montos positivos)
    ingresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        and_(
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto > 0
        )
    ).scalar() or Decimal(0)
    
    # Ingresos de Tesorería (todos los montos positivos)
    ingresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto > 0
        )
    ).scalar() or Decimal(0)
    
    total_ingresos_dia = float(ingresos_caja + ingresos_tesoreria)
    
    # ==================== EGRESOS DEL DÍA ====================
    
    # Egresos de Caja (todos los montos negativos)
    egresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        and_(
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto < 0
        )
    ).scalar() or Decimal(0)
    
    # Egresos de Tesorería (todos los montos negativos)
    egresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto < 0
        )
    ).scalar() or Decimal(0)
    
    total_egresos_dia = float(abs(egresos_caja + egresos_tesoreria))
    
    # ==================== SALDO TOTAL DISPONIBLE ====================
    
    # Saldo en todas las cajas
    saldo_cajas = db.query(func.sum(MovimientoCaja.monto)).filter(
        MovimientoCaja.tenant_id == current_user.tenant_id
    ).scalar() or Decimal(0)
    
    # Saldo en tesorería
    saldo_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).scalar() or Decimal(0)
    
    saldo_total = float(saldo_cajas + saldo_tesoreria)
    
    # ==================== TRÁMITES DEL DÍA ====================
    
    tramites_dia = db.query(func.count(VehiculoProceso.id)).filter(
        and_(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.fecha_registro >= fecha_inicio,
            VehiculoProceso.fecha_registro <= fecha_fin
        )
    ).scalar() or 0
    
    # ==================== GRÁFICA: INGRESOS ÚLTIMOS 7 DÍAS ====================
    
    ingresos_7_dias = []
    for i in range(6, -1, -1):  # De 6 días atrás hasta hoy
        dia = fecha_base - timedelta(days=i)
        dia_inicio = datetime.combine(dia, datetime.min.time())
        dia_fin = datetime.combine(dia, datetime.max.time())
        
        # Ingresos de caja del día
        ing_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
            and_(
                MovimientoCaja.tenant_id == current_user.tenant_id,
                MovimientoCaja.created_at >= dia_inicio,
                MovimientoCaja.created_at <= dia_fin,
                MovimientoCaja.monto > 0
            )
        ).scalar() or Decimal(0)
        
        # Ingresos de tesorería del día
        ing_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
            and_(
                MovimientoTesoreria.tenant_id == current_user.tenant_id,
                MovimientoTesoreria.fecha_movimiento >= dia_inicio,
                MovimientoTesoreria.fecha_movimiento <= dia_fin,
                MovimientoTesoreria.monto > 0
            )
        ).scalar() or Decimal(0)
        
        total_dia = float(ing_caja + ing_tesoreria)
        
        ingresos_7_dias.append({
            "fecha": dia.strftime("%Y-%m-%d"),
            "dia_semana": dia.strftime("%a"),  # Lun, Mar, Mié, etc.
            "ingresos": total_dia
        })
    
    # ==================== DESGLOSE POR MÓDULO ====================
    
    desglose_modulos = {
        "caja": {
            "ingresos": float(ingresos_caja),
            "egresos": float(abs(egresos_caja)),
            "saldo": float(saldo_cajas)
        },
        "tesoreria": {
            "ingresos": float(ingresos_tesoreria),
            "egresos": float(abs(egresos_tesoreria)),
            "saldo": float(saldo_tesoreria)
        }
    }
    
    return {
        "fecha": fecha_base.strftime("%Y-%m-%d"),
        "resumen": {
            "total_ingresos_dia": total_ingresos_dia,
            "total_egresos_dia": total_egresos_dia,
            "utilidad_dia": total_ingresos_dia - total_egresos_dia,
            "saldo_total": saldo_total,
            "tramites_atendidos": tramites_dia
        },
        "desglose_modulos": desglose_modulos,
        "grafica_ingresos_7_dias": ingresos_7_dias,
        "fecha_generacion": datetime.now(timezone.utc).isoformat()
    }


@router.get("/dashboard-operativo")
def obtener_dashboard_operativo(
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
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

    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)

    # Base de operación del periodo (ingresos a flujo por recepción).
    base_periodo_q = db.query(VehiculoProceso).filter(
        and_(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.fecha_registro >= fecha_inicio_dt,
            VehiculoProceso.fecha_registro <= fecha_fin_dt,
        )
    )

    total_ingresados = base_periodo_q.count()

    pagados_periodo = (
        db.query(VehiculoProceso)
        .filter(
            and_(
                VehiculoProceso.tenant_id == current_user.tenant_id,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.fecha_pago >= fecha_inicio_dt,
                VehiculoProceso.fecha_pago <= fecha_fin_dt,
            )
        )
        .all()
    )

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

    # Colas actuales (snapshot actual, no solo periodo).
    cola_registrado_q = db.query(VehiculoProceso).filter(
        VehiculoProceso.tenant_id == current_user.tenant_id,
        VehiculoProceso.estado == EstadoVehiculo.REGISTRADO,
    )
    cola_pagado_q = db.query(VehiculoProceso).filter(
        VehiculoProceso.tenant_id == current_user.tenant_id,
        VehiculoProceso.estado == EstadoVehiculo.PAGADO,
    )
    cola_en_pista_q = db.query(VehiculoProceso).filter(
        VehiculoProceso.tenant_id == current_user.tenant_id,
        VehiculoProceso.estado == EstadoVehiculo.EN_PISTA,
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
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin)
):
    """
    Lista detallada de todos los movimientos del día o rango (Caja + Tesorería)
    Para auditoría y revisión contable
    """
    from app.models.caja import Caja
    
    try:
        fecha_inicio_dt, fecha_fin_dt, etiqueta_fecha = resolve_report_date_window(
            fecha=fecha,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except ValueError as exc:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    # ==================== MOVIMIENTOS DE CAJA ====================
    movimientos_caja = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.created_at >= fecha_inicio_dt,
            MovimientoCaja.created_at <= fecha_fin_dt
        )
    ).order_by(MovimientoCaja.created_at.asc()).all()
    
    lista_caja = []
    for mov in movimientos_caja:
        # Obtener nombre de usuario
        usuario_nombre = mov.usuario.nombre_completo if mov.usuario else "Sistema"
        
        # Obtener información de la caja
        turno = mov.caja.turno.value if mov.caja else "N/A"
        
        # Determinar si es ingreso o egreso
        tipo_mov = "Ingreso" if mov.monto > 0 else "Egreso"
        
        lista_caja.append({
            "id": str(mov.id),
            "hora": mov.created_at.strftime("%H:%M:%S"),
            "_sort_ts": mov.created_at.isoformat(),
            "modulo": "Caja",
            "turno": turno,
            "tipo_movimiento": tipo_mov,
            "concepto": mov.concepto,
            "categoria": mov.tipo.value,  # rtm, comision_soat, gasto, etc.
            "monto": float(abs(mov.monto)),
            "es_ingreso": mov.monto > 0,
            "metodo_pago": mov.metodo_pago or "N/A",
            "usuario": usuario_nombre,
            "ingresa_efectivo": mov.ingresa_efectivo
        })
    
    # ==================== MOVIMIENTOS DE TESORERÍA ====================
    movimientos_tesoreria = db.query(MovimientoTesoreria).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt
        )
    ).order_by(MovimientoTesoreria.fecha_movimiento.asc()).all()
    
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
        
        lista_tesoreria.append({
            "id": str(mov.id),
            "hora": mov.fecha_movimiento.strftime("%H:%M:%S"),
            "_sort_ts": mov.fecha_movimiento.isoformat(),
            "modulo": "Tesorería",
            "turno": "N/A",
            "tipo_movimiento": tipo_mov,
            "concepto": mov.concepto,
            "categoria": categoria,
            "monto": float(abs(mov.monto)),
            "es_ingreso": mov.monto > 0,
            "metodo_pago": mov.metodo_pago.value,
            "usuario": usuario_nombre,
            "numero_comprobante": mov.numero_comprobante or "N/A"
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


@router.get("/desglose-conceptos")
def obtener_desglose_conceptos(
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin)
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
    
    # ==================== INGRESOS POR CONCEPTO ====================
    ingresos_por_concepto = {}
    
    # Ingresos de Caja (agrupar por tipo)
    from app.models.caja import TipoMovimiento
    for tipo in TipoMovimiento:
        total = db.query(func.sum(MovimientoCaja.monto)).filter(
            and_(
                MovimientoCaja.tenant_id == current_user.tenant_id,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.tipo == tipo,
                MovimientoCaja.monto > 0
            )
        ).scalar() or Decimal(0)
        
        if total > 0:
            ingresos_por_concepto[f"Caja - {tipo.value}"] = float(total)
    
    # Ingresos de Tesorería (agrupar por categoría)
    from app.models.tesoreria import CategoriaIngresoTesoreria
    for cat in CategoriaIngresoTesoreria:
        total = db.query(func.sum(MovimientoTesoreria.monto)).filter(
            and_(
                MovimientoTesoreria.tenant_id == current_user.tenant_id,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                MovimientoTesoreria.categoria_ingreso == cat,
                MovimientoTesoreria.monto > 0
            )
        ).scalar() or Decimal(0)
        
        if total > 0:
            ingresos_por_concepto[f"Tesorería - {cat.value}"] = float(total)
    
    # ==================== EGRESOS POR CONCEPTO ====================
    egresos_por_concepto = {}
    
    # Egresos de Caja
    for tipo in TipoMovimiento:
        total = db.query(func.sum(MovimientoCaja.monto)).filter(
            and_(
                MovimientoCaja.tenant_id == current_user.tenant_id,
                MovimientoCaja.created_at >= fecha_inicio_dt,
                MovimientoCaja.created_at <= fecha_fin_dt,
                MovimientoCaja.tipo == tipo,
                MovimientoCaja.monto < 0
            )
        ).scalar() or Decimal(0)
        
        if total < 0:
            egresos_por_concepto[f"Caja - {tipo.value}"] = float(abs(total))
    
    # Egresos de Tesorería
    from app.models.tesoreria import CategoriaEgresoTesoreria
    for cat in CategoriaEgresoTesoreria:
        total = db.query(func.sum(MovimientoTesoreria.monto)).filter(
            and_(
                MovimientoTesoreria.tenant_id == current_user.tenant_id,
                MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt,
                MovimientoTesoreria.categoria_egreso == cat,
                MovimientoTesoreria.monto < 0
            )
        ).scalar() or Decimal(0)
        
        if total < 0:
            egresos_por_concepto[f"Tesorería - {cat.value}"] = float(abs(total))
    
    return {
        "fecha": etiqueta_fecha,
        "ingresos_por_concepto": ingresos_por_concepto,
        "egresos_por_concepto": egresos_por_concepto
    }


@router.get("/desglose-medios-pago")
def obtener_desglose_medios_pago(
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin)
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
    
    desglose = {}
    
    # ==================== MEDIOS DE PAGO EN CAJA ====================
    # Agrupar por metodo_pago
    medios_caja = db.query(
        MovimientoCaja.metodo_pago,
        func.sum(MovimientoCaja.monto).label("total")
    ).filter(
        and_(
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.created_at >= fecha_inicio_dt,
            MovimientoCaja.created_at <= fecha_fin_dt,
            MovimientoCaja.metodo_pago.isnot(None)
        )
    ).group_by(MovimientoCaja.metodo_pago).all()
    
    for metodo, total in medios_caja:
        if metodo not in desglose:
            desglose[metodo] = {"ingresos": 0, "egresos": 0, "total": 0}
        
        if total > 0:
            desglose[metodo]["ingresos"] += float(total)
        else:
            desglose[metodo]["egresos"] += float(abs(total))
        desglose[metodo]["total"] += float(total)
    
    # ==================== MEDIOS DE PAGO EN TESORERÍA ====================
    medios_tesoreria = db.query(
        MovimientoTesoreria.metodo_pago,
        func.sum(MovimientoTesoreria.monto).label("total")
    ).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio_dt,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin_dt
        )
    ).group_by(MovimientoTesoreria.metodo_pago).all()
    
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
        "medios_pago": desglose
    }


@router.get("/tramites-detallados")
def obtener_tramites_detallados(
    fecha: Optional[date] = Query(None, description="Fecha específica (default: hoy)"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicio para rango"),
    fecha_fin: Optional[date] = Query(None, description="Fecha fin para rango"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin)
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
    
    # Obtener vehículos del rango
    vehiculos = db.query(VehiculoProceso).filter(
        and_(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.fecha_registro >= fecha_inicio_dt,
            VehiculoProceso.fecha_registro <= fecha_fin_dt
        )
    ).order_by(VehiculoProceso.fecha_registro.asc()).all()
    
    lista_tramites = []
    for veh in vehiculos:
        lista_tramites.append({
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
            "pagado": veh.estado.value in ["pagado", "en_pista", "aprobado", "rechazado", "completado"],
            "registrado_por": veh.registrador.nombre_completo if veh.registrador else "N/A"
        })
    
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
    mes: Optional[int] = Query(None, description="Mes (1-12)"),
    anio: Optional[int] = Query(None, description="Año"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin)
):
    """
    Resumen mensual consolidado
    """
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
        and_(
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto > 0
        )
    ).scalar() or Decimal(0)
    
    ingresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto > 0
        )
    ).scalar() or Decimal(0)
    
    total_ingresos = float(ingresos_caja + ingresos_tesoreria)
    
    # Egresos del mes
    egresos_caja = db.query(func.sum(MovimientoCaja.monto)).filter(
        and_(
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.created_at >= fecha_inicio,
            MovimientoCaja.created_at <= fecha_fin,
            MovimientoCaja.monto < 0
        )
    ).scalar() or Decimal(0)
    
    egresos_tesoreria = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_inicio,
            MovimientoTesoreria.fecha_movimiento <= fecha_fin,
            MovimientoTesoreria.monto < 0
        )
    ).scalar() or Decimal(0)
    
    total_egresos = float(abs(egresos_caja + egresos_tesoreria))
    
    # Trámites del mes
    tramites_mes = db.query(func.count(VehiculoProceso.id)).filter(
        and_(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.fecha_registro >= fecha_inicio,
            VehiculoProceso.fecha_registro <= fecha_fin
        )
    ).scalar() or 0
    
    return {
        "mes": mes,
        "anio": anio,
        "total_ingresos": total_ingresos,
        "total_egresos": total_egresos,
        "utilidad": total_ingresos - total_egresos,
        "tramites_atendidos": tramites_mes,
        "promedio_diario_ingresos": total_ingresos / dias_mes,
        "promedio_diario_egresos": total_egresos / dias_mes
    }
