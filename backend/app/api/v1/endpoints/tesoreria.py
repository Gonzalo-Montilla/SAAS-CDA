"""
Endpoints de Tesorería (Caja Fuerte)
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, desc
from datetime import datetime, timedelta, date, timezone
from decimal import Decimal
from typing import List, Optional

from app.core.deps import get_db, get_current_user, get_admin
from app.models.usuario import Usuario
from app.models.tesoreria import (
    MovimientoTesoreria,
    ConfiguracionTesoreria,
    TipoMovimientoTesoreria,
    CategoriaIngresoTesoreria,
    CategoriaEgresoTesoreria,
    DesgloseEfectivoTesoreria,
    MetodoPagoTesoreria
)
from app.schemas.tesoreria import (
    MovimientoTesoreriaCreate,
    MovimientoTesoreriaResponse,
    ResumenTesoreria,
    ConfiguracionTesoreriaResponse,
    ConfiguracionTesoreriaUpdate,
    EstadisticasTesoreria
)
from app.utils.comprobantes import generar_comprobante_egreso

router = APIRouter()


# ==================== FUNCIONES AUXILIARES ====================

def _calcular_desglose_disponible(db: Session, tenant_id) -> dict:
    """
    Calcula el desglose de denominaciones actualmente disponible en caja.
    Retorna un diccionario con las cantidades de cada denominación.
    """
    # Obtener todos los movimientos en efectivo con su desglose
    movimientos_efectivo = db.query(MovimientoTesoreria).filter(
        MovimientoTesoreria.metodo_pago == "efectivo",
        MovimientoTesoreria.tenant_id == tenant_id
    ).all()
    
    # Inicializar contadores
    desglose_total = {
        'billetes_100000': 0,
        'billetes_50000': 0,
        'billetes_20000': 0,
        'billetes_10000': 0,
        'billetes_5000': 0,
        'billetes_2000': 0,
        'billetes_1000': 0,
        'monedas_1000': 0,
        'monedas_500': 0,
        'monedas_200': 0,
        'monedas_100': 0,
        'monedas_50': 0,
    }
    
    # Sumar/restar desgloses según tipo de movimiento
    for mov in movimientos_efectivo:
        if mov.desglose_efectivo:
            desg = mov.desglose_efectivo
            multiplicador = 1 if mov.monto > 0 else -1  # Ingresos suman, egresos restan
            
            desglose_total['billetes_100000'] += int(desg.billetes_100000 or 0) * multiplicador
            desglose_total['billetes_50000'] += int(desg.billetes_50000 or 0) * multiplicador
            desglose_total['billetes_20000'] += int(desg.billetes_20000 or 0) * multiplicador
            desglose_total['billetes_10000'] += int(desg.billetes_10000 or 0) * multiplicador
            desglose_total['billetes_5000'] += int(desg.billetes_5000 or 0) * multiplicador
            desglose_total['billetes_2000'] += int(desg.billetes_2000 or 0) * multiplicador
            desglose_total['billetes_1000'] += int(desg.billetes_1000 or 0) * multiplicador
            desglose_total['monedas_1000'] += int(desg.monedas_1000 or 0) * multiplicador
            desglose_total['monedas_500'] += int(desg.monedas_500 or 0) * multiplicador
            desglose_total['monedas_200'] += int(desg.monedas_200 or 0) * multiplicador
            desglose_total['monedas_100'] += int(desg.monedas_100 or 0) * multiplicador
            desglose_total['monedas_50'] += int(desg.monedas_50 or 0) * multiplicador
    
    return desglose_total


def _generar_sugerencia_denominaciones(monto_total: int, desglose_disponible: dict) -> str:
    """
    Genera una sugerencia de cómo componer el monto con las denominaciones disponibles.
    Usa un algoritmo greedy que intenta usar las denominaciones más grandes primero.
    """
    # Ordenar denominaciones de mayor a menor
    denominaciones = [
        (100000, 'billetes_100000', 'billetes de $100,000'),
        (50000, 'billetes_50000', 'billetes de $50,000'),
        (20000, 'billetes_20000', 'billetes de $20,000'),
        (10000, 'billetes_10000', 'billetes de $10,000'),
        (5000, 'billetes_5000', 'billetes de $5,000'),
        (2000, 'billetes_2000', 'billetes de $2,000'),
        (1000, 'billetes_1000', 'billetes de $1,000'),
        (1000, 'monedas_1000', 'monedas de $1,000'),
        (500, 'monedas_500', 'monedas de $500'),
        (200, 'monedas_200', 'monedas de $200'),
        (100, 'monedas_100', 'monedas de $100'),
        (50, 'monedas_50', 'monedas de $50'),
    ]
    
    monto_restante = monto_total
    sugerencia_desglose = []
    
    for valor, campo, nombre in denominaciones:
        if monto_restante <= 0:
            break
        
        disponible = desglose_disponible.get(campo, 0)
        if disponible > 0:
            # Calcular cuántas de esta denominación se necesitan
            cantidad_necesaria = monto_restante // valor
            cantidad_a_usar = min(cantidad_necesaria, disponible)
            
            if cantidad_a_usar > 0:
                sugerencia_desglose.append(f"  - {cantidad_a_usar} {nombre}")
                monto_restante -= cantidad_a_usar * valor
    
    # Si se logró componer el monto completo
    if monto_restante == 0:
        return "\n".join(sugerencia_desglose)
    else:
        return f"No es posible componer ${monto_total:,.0f} con las denominaciones disponibles. Faltan ${monto_restante:,.0f}."


# ==================== MOVIMIENTOS ====================

@router.post("/movimientos", response_model=MovimientoTesoreriaResponse, status_code=status.HTTP_201_CREATED)
def crear_movimiento(
    movimiento_data: MovimientoTesoreriaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Crear movimiento en tesorería (solo administrador)
    """
    # Validar que tenga la categoría correcta según el tipo
    if movimiento_data.tipo == "ingreso" and not movimiento_data.categoria_ingreso:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe especificar una categoría de ingreso válida"
        )
    
    if movimiento_data.tipo == "egreso" and not movimiento_data.categoria_egreso:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe especificar una categoría de egreso válida"
        )
    
    # Validar desglose de efectivo si el método de pago es efectivo
    if movimiento_data.metodo_pago == "efectivo":
        if not movimiento_data.desglose_efectivo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El desglose de efectivo es obligatorio para movimientos en efectivo. Debe especificar la cantidad de billetes y monedas."
            )
        
        total_desglose = movimiento_data.desglose_efectivo.calcular_total()
        if total_desglose != movimiento_data.monto:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El desglose de efectivo (${total_desglose:,.0f}) no coincide con el monto declarado (${movimiento_data.monto:,.0f}). Por favor, ajuste las denominaciones para que el total calculado coincida exactamente con el monto."
            )
        
        # Validar disponibilidad de denominaciones para EGRESOS
        if movimiento_data.tipo == "egreso":
            desglose_solicitado = movimiento_data.desglose_efectivo
            desglose_disponible = _calcular_desglose_disponible(db, current_user.tenant_id)
            
            # Validar cada denominación
            denominaciones_faltantes = []
            denominaciones_map = {
                'billetes_100000': (100000, 'billetes de $100,000'),
                'billetes_50000': (50000, 'billetes de $50,000'),
                'billetes_20000': (20000, 'billetes de $20,000'),
                'billetes_10000': (10000, 'billetes de $10,000'),
                'billetes_5000': (5000, 'billetes de $5,000'),
                'billetes_2000': (2000, 'billetes de $2,000'),
                'billetes_1000': (1000, 'billetes de $1,000'),
                'monedas_1000': (1000, 'monedas de $1,000'),
                'monedas_500': (500, 'monedas de $500'),
                'monedas_200': (200, 'monedas de $200'),
                'monedas_100': (100, 'monedas de $100'),
                'monedas_50': (50, 'monedas de $50'),
            }
            
            for campo, (valor, nombre) in denominaciones_map.items():
                solicitado = getattr(desglose_solicitado, campo, 0)
                disponible = desglose_disponible.get(campo, 0)
                
                if solicitado > disponible:
                    denominaciones_faltantes.append(
                        f"{nombre}: solicita {solicitado} pero solo hay {disponible} disponibles"
                    )
            
            # Si hay denominaciones faltantes, generar error con sugerencias
            if denominaciones_faltantes:
                mensaje_error = "No hay suficientes denominaciones disponibles:\n" + "\n".join(
                    [f"  - {d}" for d in denominaciones_faltantes]
                )
                
                # Generar sugerencia de denominaciones alternativas
                sugerencia = _generar_sugerencia_denominaciones(
                    int(movimiento_data.monto),
                    desglose_disponible
                )
                
                if sugerencia:
                    mensaje_error += f"\n\nSugerencia de denominaciones disponibles:\n{sugerencia}"
                
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=mensaje_error
                )
    
    # Convertir monto según el tipo (ingreso positivo, egreso negativo)
    monto_final = movimiento_data.monto if movimiento_data.tipo == "ingreso" else -movimiento_data.monto
    
    # Crear movimiento
    nuevo_movimiento = MovimientoTesoreria(
        tenant_id=current_user.tenant_id,
        tipo=TipoMovimientoTesoreria(movimiento_data.tipo),
        categoria_ingreso=CategoriaIngresoTesoreria(movimiento_data.categoria_ingreso) if movimiento_data.categoria_ingreso else None,
        categoria_egreso=CategoriaEgresoTesoreria(movimiento_data.categoria_egreso) if movimiento_data.categoria_egreso else None,
        monto=monto_final,
        concepto=movimiento_data.concepto,
        metodo_pago=movimiento_data.metodo_pago,
        origen_caja_id=movimiento_data.origen_caja_id,
        numero_comprobante=movimiento_data.numero_comprobante,
        fecha_movimiento=movimiento_data.fecha_movimiento or datetime.now(timezone.utc),
        created_by=current_user.id
    )
    
    db.add(nuevo_movimiento)
    db.flush()  # Generar ID sin hacer commit aún
    
    # Si es efectivo y hay desglose, guardarlo
    if movimiento_data.metodo_pago == "efectivo" and movimiento_data.desglose_efectivo:
        desglose = DesgloseEfectivoTesoreria(
            tenant_id=current_user.tenant_id,
            movimiento_id=nuevo_movimiento.id,
            **movimiento_data.desglose_efectivo.model_dump()
        )
        db.add(desglose)
    
    db.commit()
    db.refresh(nuevo_movimiento)
    
    return nuevo_movimiento


@router.get("/movimientos", response_model=List[MovimientoTesoreriaResponse])
def listar_movimientos(
    tipo: Optional[str] = None,
    categoria: Optional[str] = None,
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    metodo_pago: Optional[str] = None,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Listar movimientos de tesorería con filtros (solo administrador)
    """
    query = db.query(MovimientoTesoreria).filter(
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    )
    
    # Aplicar filtros
    if tipo:
        query = query.filter(MovimientoTesoreria.tipo == tipo)
    
    if categoria:
        query = query.filter(
            (MovimientoTesoreria.categoria_ingreso == categoria) |
            (MovimientoTesoreria.categoria_egreso == categoria)
        )
    
    if fecha_desde:
        fecha_desde_dt = datetime.combine(fecha_desde, datetime.min.time())
        query = query.filter(MovimientoTesoreria.fecha_movimiento >= fecha_desde_dt)
    
    if fecha_hasta:
        fecha_hasta_dt = datetime.combine(fecha_hasta, datetime.max.time())
        query = query.filter(MovimientoTesoreria.fecha_movimiento <= fecha_hasta_dt)
    
    if metodo_pago:
        query = query.filter(MovimientoTesoreria.metodo_pago == metodo_pago)
    
    movimientos = query.order_by(desc(MovimientoTesoreria.fecha_movimiento)).limit(limit).all()
    
    return movimientos


@router.get("/movimientos/{movimiento_id}", response_model=MovimientoTesoreriaResponse)
def obtener_movimiento(
    movimiento_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener detalle de un movimiento específico
    """
    movimiento = db.query(MovimientoTesoreria).filter(
        MovimientoTesoreria.id == movimiento_id,
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).first()
    
    if not movimiento:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movimiento no encontrado"
        )
    
    return movimiento


# ==================== SALDO Y RESUMEN ====================

@router.get("/saldo-actual")
def obtener_saldo_actual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener saldo actual de la caja fuerte
    """
    # Sumar todos los movimientos (positivos y negativos)
    saldo = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).scalar() or Decimal(0)
    
    return {
        "saldo_actual": float(saldo),
        "fecha_calculo": datetime.now(timezone.utc).isoformat()
    }


@router.get("/resumen", response_model=ResumenTesoreria)
def obtener_resumen(
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener resumen de tesorería en un período
    """
    # Si no se especifica período, usar el mes actual
    if not fecha_desde:
        fecha_desde = date.today().replace(day=1)
    if not fecha_hasta:
        fecha_hasta = date.today()
    
    # Convertir date a datetime para comparación correcta con PostgreSQL
    fecha_desde_dt = datetime.combine(fecha_desde, datetime.min.time())
    fecha_hasta_dt = datetime.combine(fecha_hasta, datetime.max.time())
    
    # Obtener movimientos del período
    movimientos = db.query(MovimientoTesoreria).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_desde_dt,
            MovimientoTesoreria.fecha_movimiento <= fecha_hasta_dt
        )
    ).all()
    
    # Calcular totales
    total_ingresos = Decimal(0)
    total_egresos = Decimal(0)
    ingresos_por_categoria = {}
    egresos_por_categoria = {}
    
    for mov in movimientos:
        if mov.monto > 0:
            total_ingresos += mov.monto
            cat = mov.categoria_ingreso.value if mov.categoria_ingreso else "sin_categoria"
            ingresos_por_categoria[cat] = ingresos_por_categoria.get(cat, Decimal(0)) + mov.monto
        else:
            total_egresos += abs(mov.monto)
            cat = mov.categoria_egreso.value if mov.categoria_egreso else "sin_categoria"
            egresos_por_categoria[cat] = egresos_por_categoria.get(cat, Decimal(0)) + abs(mov.monto)
    
    # Saldo actual (todos los movimientos históricos)
    saldo_actual = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).scalar() or Decimal(0)
    
    # Obtener configuración de alertas
    config = db.query(ConfiguracionTesoreria).filter(
        ConfiguracionTesoreria.tenant_id == current_user.tenant_id
    ).first()
    umbral_minimo = config.saldo_minimo_alerta if config else Decimal(100000)
    saldo_bajo_umbral = saldo_actual < umbral_minimo
    
    return ResumenTesoreria(
        saldo_actual=saldo_actual,
        total_ingresos=total_ingresos,
        total_egresos=total_egresos,
        cantidad_movimientos=len(movimientos),
        ingresos_por_categoria=ingresos_por_categoria,
        egresos_por_categoria=egresos_por_categoria,
        saldo_bajo_umbral=saldo_bajo_umbral,
        umbral_minimo=umbral_minimo
    )


# ==================== DESGLOSE DE SALDO ====================

@router.get("/desglose-saldo")
def obtener_desglose_saldo(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener desglose del saldo actual por método de pago
    """
    # Agrupar movimientos por método de pago y sumar
    resultados = db.query(
        MovimientoTesoreria.metodo_pago,
        func.sum(MovimientoTesoreria.monto).label('saldo')
    ).filter(
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).group_by(MovimientoTesoreria.metodo_pago).all()
    
    desglose = {}
    total = Decimal(0)
    
    for metodo, saldo in resultados:
        saldo_decimal = Decimal(str(saldo)) if saldo else Decimal(0)
        desglose[metodo] = float(saldo_decimal)
        total += saldo_decimal
    
    return {
        "desglose": desglose,
        "total": float(total),
        "fecha_calculo": datetime.now(timezone.utc).isoformat()
    }


@router.get("/desglose-efectivo")
def obtener_desglose_efectivo(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener desglose de billetes y monedas del efectivo actual en caja
    """
    # Obtener todos los movimientos en efectivo con su desglose
    movimientos_efectivo = db.query(MovimientoTesoreria).filter(
        MovimientoTesoreria.metodo_pago == "efectivo",
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).all()
    
    # Inicializar contadores
    desglose_total = {
        'billetes_100000': 0,
        'billetes_50000': 0,
        'billetes_20000': 0,
        'billetes_10000': 0,
        'billetes_5000': 0,
        'billetes_2000': 0,
        'billetes_1000': 0,
        'monedas_1000': 0,
        'monedas_500': 0,
        'monedas_200': 0,
        'monedas_100': 0,
        'monedas_50': 0,
    }
    
    total_efectivo = Decimal(0)
    
    # Sumar/restar desgloses según tipo de movimiento
    # IMPORTANTE: Solo contar movimientos que tienen desglose registrado
    for mov in movimientos_efectivo:
        # Solo procesar si tiene desglose
        if mov.desglose_efectivo:
            # Sumar al total
            total_efectivo += mov.monto
            
            desg = mov.desglose_efectivo
            multiplicador = 1 if mov.monto > 0 else -1  # Ingresos suman, egresos restan
            
            desglose_total['billetes_100000'] += int(desg.billetes_100000 or 0) * multiplicador
            desglose_total['billetes_50000'] += int(desg.billetes_50000 or 0) * multiplicador
            desglose_total['billetes_20000'] += int(desg.billetes_20000 or 0) * multiplicador
            desglose_total['billetes_10000'] += int(desg.billetes_10000 or 0) * multiplicador
            desglose_total['billetes_5000'] += int(desg.billetes_5000 or 0) * multiplicador
            desglose_total['billetes_2000'] += int(desg.billetes_2000 or 0) * multiplicador
            desglose_total['billetes_1000'] += int(desg.billetes_1000 or 0) * multiplicador
            desglose_total['monedas_1000'] += int(desg.monedas_1000 or 0) * multiplicador
            desglose_total['monedas_500'] += int(desg.monedas_500 or 0) * multiplicador
            desglose_total['monedas_200'] += int(desg.monedas_200 or 0) * multiplicador
            desglose_total['monedas_100'] += int(desg.monedas_100 or 0) * multiplicador
            desglose_total['monedas_50'] += int(desg.monedas_50 or 0) * multiplicador
    
    return {
        "desglose": desglose_total,
        "total_efectivo": float(total_efectivo),
        "fecha_calculo": datetime.now(timezone.utc).isoformat()
    }


# ==================== ESTADÍSTICAS ====================

@router.get("/estadisticas", response_model=EstadisticasTesoreria)
def obtener_estadisticas(
    fecha_desde: date,
    fecha_hasta: date,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener estadísticas detalladas de un período
    """
    fecha_desde_dt = datetime.combine(fecha_desde, datetime.min.time())
    fecha_hasta_dt = datetime.combine(fecha_hasta, datetime.max.time())

    movimientos = db.query(MovimientoTesoreria).filter(
        and_(
            MovimientoTesoreria.tenant_id == current_user.tenant_id,
            MovimientoTesoreria.fecha_movimiento >= fecha_desde_dt,
            MovimientoTesoreria.fecha_movimiento <= fecha_hasta_dt
        )
    ).all()
    
    total_ingresos = Decimal(0)
    total_egresos = Decimal(0)
    egresos_por_categoria = {}
    
    for mov in movimientos:
        if mov.monto > 0:
            total_ingresos += mov.monto
        else:
            total_egresos += abs(mov.monto)
            cat = mov.categoria_egreso.value if mov.categoria_egreso else "sin_categoria"
            egresos_por_categoria[cat] = egresos_por_categoria.get(cat, Decimal(0)) + abs(mov.monto)
    
    # Categoría con más egreso
    categoria_mas_egreso = None
    monto_categoria_mas_egreso = None
    if egresos_por_categoria:
        categoria_mas_egreso = max(egresos_por_categoria, key=egresos_por_categoria.get)
        monto_categoria_mas_egreso = egresos_por_categoria[categoria_mas_egreso]
    
    # Saldo inicial (antes del período)
    saldo_inicial = db.query(func.sum(MovimientoTesoreria.monto)).filter(
        MovimientoTesoreria.tenant_id == current_user.tenant_id,
        MovimientoTesoreria.fecha_movimiento < fecha_desde_dt
    ).scalar() or Decimal(0)
    
    saldo_final = saldo_inicial + total_ingresos - total_egresos
    
    return EstadisticasTesoreria(
        periodo_inicio=fecha_desde,
        periodo_fin=fecha_hasta,
        total_ingresos=total_ingresos,
        total_egresos=total_egresos,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        movimientos_count=len(movimientos),
        categoria_mas_egreso=categoria_mas_egreso,
        monto_categoria_mas_egreso=monto_categoria_mas_egreso
    )


# ==================== CONFIGURACIÓN ====================

@router.get("/configuracion", response_model=ConfiguracionTesoreriaResponse)
def obtener_configuracion(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener configuración de tesorería
    """
    config = db.query(ConfiguracionTesoreria).filter(
        ConfiguracionTesoreria.tenant_id == current_user.tenant_id
    ).first()
    
    # Si no existe, crear una por defecto
    if not config:
        config = ConfiguracionTesoreria(
            tenant_id=current_user.tenant_id,
            saldo_minimo_alerta=Decimal(100000),
            notificar_saldo_bajo=True,
            updated_by=current_user.id
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    
    return config


@router.put("/configuracion", response_model=ConfiguracionTesoreriaResponse)
def actualizar_configuracion(
    config_data: ConfiguracionTesoreriaUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Actualizar configuración de tesorería
    """
    config = db.query(ConfiguracionTesoreria).filter(
        ConfiguracionTesoreria.tenant_id == current_user.tenant_id
    ).first()
    
    if not config:
        # Crear si no existe
        config = ConfiguracionTesoreria(
            tenant_id=current_user.tenant_id,
            updated_by=current_user.id
        )
        db.add(config)
    
    # Actualizar campos
    if config_data.saldo_minimo_alerta is not None:
        config.saldo_minimo_alerta = config_data.saldo_minimo_alerta
    
    if config_data.notificar_saldo_bajo is not None:
        config.notificar_saldo_bajo = config_data.notificar_saldo_bajo
    
    if config_data.email_notificacion is not None:
        config.email_notificacion = config_data.email_notificacion
    
    config.updated_at = datetime.now(timezone.utc)
    config.updated_by = current_user.id
    
    db.commit()
    db.refresh(config)
    
    return config


# ==================== COMPROBANTES ====================

@router.get("/movimientos/{movimiento_id}/comprobante")
async def descargar_comprobante_egreso(
    movimiento_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Generar y descargar comprobante de egreso en PDF
    """
    # Obtener movimiento
    movimiento = db.query(MovimientoTesoreria).filter(
        MovimientoTesoreria.id == movimiento_id,
        MovimientoTesoreria.tenant_id == current_user.tenant_id
    ).first()
    
    if not movimiento:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movimiento no encontrado"
        )
    
    # Validar que sea un egreso
    if movimiento.tipo != TipoMovimientoTesoreria.EGRESO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se pueden generar comprobantes para egresos"
        )
    
    # Obtener información del usuario que autorizó
    usuario = db.query(Usuario).filter(Usuario.id == movimiento.created_by).first()
    autorizado_por = usuario.nombre_completo if usuario else "N/A"
    
    # Preparar desglose de efectivo si existe
    desglose_dict = None
    if movimiento.desglose_efectivo:
        desglose_dict = {
            'billetes_100000': int(movimiento.desglose_efectivo.billetes_100000 or 0),
            'billetes_50000': int(movimiento.desglose_efectivo.billetes_50000 or 0),
            'billetes_20000': int(movimiento.desglose_efectivo.billetes_20000 or 0),
            'billetes_10000': int(movimiento.desglose_efectivo.billetes_10000 or 0),
            'billetes_5000': int(movimiento.desglose_efectivo.billetes_5000 or 0),
            'billetes_2000': int(movimiento.desglose_efectivo.billetes_2000 or 0),
            'billetes_1000': int(movimiento.desglose_efectivo.billetes_1000 or 0),
            'monedas_1000': int(movimiento.desglose_efectivo.monedas_1000 or 0),
            'monedas_500': int(movimiento.desglose_efectivo.monedas_500 or 0),
            'monedas_200': int(movimiento.desglose_efectivo.monedas_200 or 0),
            'monedas_100': int(movimiento.desglose_efectivo.monedas_100 or 0),
            'monedas_50': int(movimiento.desglose_efectivo.monedas_50 or 0),
        }
    
    # Generar comprobante
    numero_comprobante = movimiento.numero_comprobante or f"EGR-{str(movimiento.id)[:8].upper()}"
    
    # Obtener valores de los enums
    categoria_str = movimiento.categoria_egreso.value if movimiento.categoria_egreso else "otros_gastos"
    metodo_pago_str = movimiento.metodo_pago.value if isinstance(movimiento.metodo_pago, MetodoPagoTesoreria) else str(movimiento.metodo_pago)
    
    pdf_buffer = generar_comprobante_egreso(
        numero_comprobante=numero_comprobante,
        fecha=movimiento.fecha_movimiento,
        beneficiario=movimiento.concepto.split(" - ")[0] if " - " in movimiento.concepto else "N/A",
        concepto=movimiento.concepto,
        categoria=categoria_str,
        monto=abs(movimiento.monto),
        metodo_pago=metodo_pago_str,
        autorizado_por=autorizado_por,
        desglose_efectivo=desglose_dict
    )
    
    # Nombre del archivo
    fecha_str = movimiento.fecha_movimiento.strftime("%Y%m%d")
    nombre_archivo = f"Comprobante_Egreso_{numero_comprobante}_{fecha_str}.pdf"
    
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={nombre_archivo}"}
    )


# ==================== CATEGORÍAS (para el frontend) ====================

@router.get("/categorias")
def obtener_categorias(
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener listado de categorías disponibles
    """
    return {
        "ingresos": [
            {"value": "traslado_caja", "label": "Traslado desde Caja Diaria"},
            {"value": "prestamo", "label": "Préstamo"},
            {"value": "aporte_socio", "label": "Aporte de Socio"},
            {"value": "ingreso_externo", "label": "Ingreso Externo"},
            {"value": "otro_ingreso", "label": "Otro Ingreso"}
        ],
        "egresos": [
            {"value": "nomina", "label": "Nómina y Salarios"},
            {"value": "servicios_publicos", "label": "Servicios Públicos"},
            {"value": "arriendo", "label": "Arriendo"},
            {"value": "proveedores", "label": "Proveedores (RUNT, INDRA, etc.)"},
            {"value": "compra_inventario", "label": "Compra de Inventario"},
            {"value": "mantenimiento", "label": "Mantenimiento"},
            {"value": "impuestos", "label": "Impuestos"},
            {"value": "otros_gastos", "label": "Otros Gastos"}
        ],
        "metodos_pago": [
            {"value": "efectivo", "label": "Efectivo"},
            {"value": "transferencia", "label": "Transferencia"},
            {"value": "cheque", "label": "Cheque"},
            {"value": "consignacion", "label": "Consignación"}
        ]
    }

