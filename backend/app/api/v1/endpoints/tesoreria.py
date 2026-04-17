"""
Endpoints de Tesorería (Caja Fuerte)
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, desc, or_
from datetime import datetime, timedelta, date, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from app.core.deps import get_db, get_current_user, get_admin, get_contador_or_admin, get_active_sucursal_id
from app.core.sucursal_scope import assert_sucursal_in_tenant, comprobante_egreso_scope_sid
from app.models.usuario import Usuario, RolEnum
from app.models.tenant import Tenant
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
    MovimientoTesoreriaAnular,
    ResumenTesoreria,
    ConfiguracionTesoreriaResponse,
    ConfiguracionTesoreriaUpdate,
    EstadisticasTesoreria,
    BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA,
)
from app.utils.comprobantes import generar_comprobante_egreso
from app.utils.egreso_proveedor_dian import normalizar_y_validar_contacto_proveedor_documento_soporte
from app.services.proveedor_catalogo import cargar_beneficiario_desde_proveedor_catalogo

router = APIRouter()


def _tesoreria_sucursal_scope(consolidar_todas: bool, active_sucursal_id: UUID) -> Optional[UUID]:
    """None = todas las sedes (consolidado tenant)."""
    return None if consolidar_todas else active_sucursal_id


def _filter_movimientos_tesoreria(
    q,
    tenant_id,
    scope_sid: Optional[UUID],
    *,
    solo_activos: bool = True,
):
    q = q.filter(MovimientoTesoreria.tenant_id == tenant_id)
    if scope_sid is not None:
        q = q.filter(MovimientoTesoreria.sucursal_id == scope_sid)
    if solo_activos:
        q = q.filter(
            or_(MovimientoTesoreria.anulado == False, MovimientoTesoreria.anulado.is_(None))
        )
    return q


# ==================== FUNCIONES AUXILIARES ====================

def _total_pesos_desde_denominaciones(desglose: dict) -> Decimal:
    """Suma en pesos a partir del mapa de cantidades por denominación (coherente con DesgloseEfectivoCreate)."""
    pairs = [
        ("billetes_100000", 100000),
        ("billetes_50000", 50000),
        ("billetes_20000", 20000),
        ("billetes_10000", 10000),
        ("billetes_5000", 5000),
        ("billetes_2000", 2000),
        ("billetes_1000", 1000),
        ("monedas_1000", 1000),
        ("monedas_500", 500),
        ("monedas_200", 200),
        ("monedas_100", 100),
        ("monedas_50", 50),
    ]
    total = Decimal(0)
    for key, unit in pairs:
        total += Decimal(int(desglose.get(key, 0) or 0)) * Decimal(unit)
    return total


def _calcular_desglose_disponible(db: Session, tenant_id, sucursal_id: Optional[UUID]) -> dict:
    """
    Calcula el desglose de denominaciones actualmente disponible en caja.
    Retorna un diccionario con las cantidades de cada denominación.
    """
    q = db.query(MovimientoTesoreria).filter(
        MovimientoTesoreria.metodo_pago == MetodoPagoTesoreria.EFECTIVO,
        MovimientoTesoreria.tenant_id == tenant_id,
        or_(MovimientoTesoreria.anulado == False, MovimientoTesoreria.anulado.is_(None)),
    )
    if sucursal_id is not None:
        q = q.filter(MovimientoTesoreria.sucursal_id == sucursal_id)
    movimientos_efectivo = q.all()
    
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
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
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

    ben_norm = None
    tid_norm = None
    num_id_norm = None
    dir_norm = None
    email_norm = None
    phone_norm = None
    mid_bn = None
    proveedor_fk = None

    if movimiento_data.tipo == "egreso":
        if movimiento_data.proveedor_catalogo_id:
            try:
                snap = cargar_beneficiario_desde_proveedor_catalogo(
                    db,
                    tenant_id=current_user.tenant_id,
                    proveedor_catalogo_id=movimiento_data.proveedor_catalogo_id,
                )
            except ValueError as e:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
            ben_norm = snap["beneficiario"]
            tid_norm = snap["beneficiario_tipo_identificacion"]
            num_id_norm = snap["beneficiario_numero_identificacion"]
            dir_norm = snap["beneficiario_direccion"]
            email_norm = snap["beneficiario_email"]
            phone_norm = snap["beneficiario_telefono"]
            mid_bn = snap["beneficiario_factus_municipality_id"]
            proveedor_fk = snap["proveedor_catalogo_id"]
        else:
            ben = (movimiento_data.beneficiario or "").strip()
            if len(ben) < 2:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El beneficiario / pagado a es obligatorio para egresos (mínimo 2 caracteres).",
                )
            tid = (movimiento_data.beneficiario_tipo_identificacion or "").strip()
            if not tid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El tipo de identificación del beneficiario es obligatorio para egresos.",
                )
            if tid not in BENEFICIARIO_TIPOS_IDENTIFICACION_TESORERIA:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Tipo de identificación del beneficiario no válido.",
                )
            num_id = (movimiento_data.beneficiario_numero_identificacion or "").strip()
            if len(num_id) < 4:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El número de identificación del beneficiario es obligatorio para egresos (mínimo 4 caracteres).",
                )
            try:
                dir_norm, email_norm, phone_norm, mid_bn = normalizar_y_validar_contacto_proveedor_documento_soporte(
                    direccion=movimiento_data.beneficiario_direccion,
                    email=movimiento_data.beneficiario_email,
                    telefono=movimiento_data.beneficiario_telefono,
                    factus_municipality_id=movimiento_data.beneficiario_factus_municipality_id,
                )
            except ValueError as e:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
            ben_norm = ben
            tid_norm = tid
            num_id_norm = num_id

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
            desglose_disponible = _calcular_desglose_disponible(db, current_user.tenant_id, active_sucursal_id)
            
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
        sucursal_id=active_sucursal_id,
        tipo=TipoMovimientoTesoreria(movimiento_data.tipo),
        categoria_ingreso=CategoriaIngresoTesoreria(movimiento_data.categoria_ingreso) if movimiento_data.categoria_ingreso else None,
        categoria_egreso=CategoriaEgresoTesoreria(movimiento_data.categoria_egreso) if movimiento_data.categoria_egreso else None,
        monto=monto_final,
        concepto=movimiento_data.concepto,
        metodo_pago=movimiento_data.metodo_pago,
        origen_caja_id=movimiento_data.origen_caja_id,
        numero_comprobante=movimiento_data.numero_comprobante,
        fecha_movimiento=movimiento_data.fecha_movimiento or datetime.now(timezone.utc),
        created_by=current_user.id,
        beneficiario=ben_norm,
        beneficiario_tipo_identificacion=tid_norm,
        beneficiario_numero_identificacion=num_id_norm,
        beneficiario_direccion=dir_norm,
        beneficiario_email=email_norm,
        beneficiario_telefono=phone_norm,
        beneficiario_factus_municipality_id=mid_bn,
        proveedor_catalogo_id=proveedor_fk,
    )
    
    db.add(nuevo_movimiento)
    db.flush()  # Generar ID sin hacer commit aún
    
    # Si es efectivo y hay desglose, guardarlo
    if movimiento_data.metodo_pago == "efectivo" and movimiento_data.desglose_efectivo:
        desglose = DesgloseEfectivoTesoreria(
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
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
    consolidar_todas: bool = Query(False, description="Incluir todas las sedes (vista consolidada)"),
    solo_activos: bool = Query(
        False,
        description="Si es true, excluye movimientos anulados (útil en resúmenes recientes).",
    ),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Listar movimientos de tesorería con filtros (solo administrador)
    """
    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    query = _filter_movimientos_tesoreria(
        db.query(MovimientoTesoreria),
        current_user.tenant_id,
        scope_sid,
        solo_activos=solo_activos,
    )

    # Aplicar filtros
    if tipo:
        try:
            query = query.filter(MovimientoTesoreria.tipo == TipoMovimientoTesoreria(tipo))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tipo de movimiento inválido (use ingreso o egreso)",
            )
    
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
        try:
            query = query.filter(
                MovimientoTesoreria.metodo_pago == MetodoPagoTesoreria(metodo_pago)
            )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Método de pago inválido",
            )
    
    movimientos = query.order_by(desc(MovimientoTesoreria.fecha_movimiento)).limit(limit).all()
    
    return movimientos


@router.get("/movimientos/{movimiento_id}", response_model=MovimientoTesoreriaResponse)
def obtener_movimiento(
    movimiento_id: str,
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener detalle de un movimiento específico
    """
    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    q = _filter_movimientos_tesoreria(
        db.query(MovimientoTesoreria),
        current_user.tenant_id,
        scope_sid,
        solo_activos=False,
    )
    movimiento = q.filter(MovimientoTesoreria.id == movimiento_id).first()

    if not movimiento:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movimiento no encontrado"
        )
    
    return movimiento


@router.post("/movimientos/{movimiento_id}/anular", response_model=MovimientoTesoreriaResponse)
def anular_movimiento(
    movimiento_id: str,
    body: MovimientoTesoreriaAnular = Body(default_factory=MovimientoTesoreriaAnular),
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Anula un movimiento: deja de afectar saldo y desglose de efectivo (no borra el registro).
    """
    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    q = _filter_movimientos_tesoreria(
        db.query(MovimientoTesoreria),
        current_user.tenant_id,
        scope_sid,
        solo_activos=False,
    )
    mov = q.filter(MovimientoTesoreria.id == movimiento_id).first()
    if not mov:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")
    if mov.anulado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este movimiento ya está anulado.",
        )
    motivo = (body.motivo or "").strip() or "Anulado desde el panel de tesorería"
    mov.anulado = True
    mov.motivo_anulacion = motivo
    mov.anulado_por = current_user.id
    mov.fecha_anulacion = datetime.now(timezone.utc)
    db.commit()
    db.refresh(mov)
    return mov


# ==================== SALDO Y RESUMEN ====================

@router.get("/saldo-actual")
def obtener_saldo_actual(
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener saldo actual de la caja fuerte
    """
    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    q = _filter_movimientos_tesoreria(
        db.query(func.sum(MovimientoTesoreria.monto)),
        current_user.tenant_id,
        scope_sid,
    )
    saldo = q.scalar() or Decimal(0)

    return {
        "saldo_actual": float(saldo),
        "fecha_calculo": datetime.now(timezone.utc).isoformat()
    }


@router.get("/resumen", response_model=ResumenTesoreria)
def obtener_resumen(
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
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

    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)

    movimientos = (
        _filter_movimientos_tesoreria(
            db.query(MovimientoTesoreria),
            current_user.tenant_id,
            scope_sid,
        )
        .filter(
            and_(
                MovimientoTesoreria.fecha_movimiento >= fecha_desde_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_hasta_dt,
            )
        )
        .all()
    )
    
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
    
    saldo_actual = (
        _filter_movimientos_tesoreria(
            db.query(func.sum(MovimientoTesoreria.monto)),
            current_user.tenant_id,
            scope_sid,
        ).scalar()
        or Decimal(0)
    )

    if scope_sid is None:
        configs = (
            db.query(ConfiguracionTesoreria)
            .filter(ConfiguracionTesoreria.tenant_id == current_user.tenant_id)
            .all()
        )
        # Vista consolidada: umbral = suma de mínimos por sede (cada sede debería mantener su piso).
        umbral_minimo = (
            sum((c.saldo_minimo_alerta or Decimal(0)) for c in configs)
            if configs
            else Decimal(100000)
        )
    else:
        config = (
            db.query(ConfiguracionTesoreria)
            .filter(
                ConfiguracionTesoreria.tenant_id == current_user.tenant_id,
                ConfiguracionTesoreria.sucursal_id == scope_sid,
            )
            .first()
        )
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
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener desglose del saldo actual por método de pago
    """
    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    resultados = (
        _filter_movimientos_tesoreria(
            db.query(
                MovimientoTesoreria.metodo_pago,
                func.sum(MovimientoTesoreria.monto).label("saldo"),
            ),
            current_user.tenant_id,
            scope_sid,
        )
        .group_by(MovimientoTesoreria.metodo_pago)
        .all()
    )
    
    desglose = {}
    total = Decimal(0)
    
    for metodo, saldo in resultados:
        saldo_decimal = Decimal(str(saldo)) if saldo else Decimal(0)
        key = metodo.value if isinstance(metodo, MetodoPagoTesoreria) else str(metodo)
        desglose[key] = float(saldo_decimal)
        total += saldo_decimal
    
    return {
        "desglose": desglose,
        "total": float(total),
        "fecha_calculo": datetime.now(timezone.utc).isoformat()
    }


@router.get("/desglose-efectivo")
def obtener_desglose_efectivo(
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener desglose de billetes y monedas del efectivo actual en caja
    """
    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    movimientos_efectivo = (
        _filter_movimientos_tesoreria(
            db.query(MovimientoTesoreria),
            current_user.tenant_id,
            scope_sid,
        )
        .filter(MovimientoTesoreria.metodo_pago == MetodoPagoTesoreria.EFECTIVO)
        .all()
    )

    # Total contable: todos los movimientos en efectivo (coincide con /desglose-saldo).
    total_efectivo_contable = sum((Decimal(str(mov.monto)) for mov in movimientos_efectivo), Decimal(0))
    
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
    # IMPORTANTE: Solo movimientos con desglose afectan el inventario por denominación
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

    total_desglosado = _total_pesos_desde_denominaciones(desglose_total)
    
    return {
        "desglose": desglose_total,
        "total_efectivo": float(total_efectivo_contable),
        "total_desglosado": float(total_desglosado),
        "fecha_calculo": datetime.now(timezone.utc).isoformat()
    }


# ==================== ESTADÍSTICAS ====================

@router.get("/estadisticas", response_model=EstadisticasTesoreria)
def obtener_estadisticas(
    fecha_desde: date,
    fecha_hasta: date,
    consolidar_todas: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener estadísticas detalladas de un período
    """
    fecha_desde_dt = datetime.combine(fecha_desde, datetime.min.time())
    fecha_hasta_dt = datetime.combine(fecha_hasta, datetime.max.time())

    scope_sid = _tesoreria_sucursal_scope(consolidar_todas, active_sucursal_id)
    movimientos = (
        _filter_movimientos_tesoreria(
            db.query(MovimientoTesoreria),
            current_user.tenant_id,
            scope_sid,
        )
        .filter(
            and_(
                MovimientoTesoreria.fecha_movimiento >= fecha_desde_dt,
                MovimientoTesoreria.fecha_movimiento <= fecha_hasta_dt,
            )
        )
        .all()
    )
    
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
    
    saldo_inicial = (
        _filter_movimientos_tesoreria(
            db.query(func.sum(MovimientoTesoreria.monto)),
            current_user.tenant_id,
            scope_sid,
        )
        .filter(MovimientoTesoreria.fecha_movimiento < fecha_desde_dt)
        .scalar()
        or Decimal(0)
    )
    
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
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener configuración de tesorería
    """
    config = db.query(ConfiguracionTesoreria).filter(
        ConfiguracionTesoreria.tenant_id == current_user.tenant_id,
        ConfiguracionTesoreria.sucursal_id == active_sucursal_id,
    ).first()
    
    # Si no existe, crear una por defecto
    if not config:
        config = ConfiguracionTesoreria(
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
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
    current_user: Usuario = Depends(get_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Actualizar configuración de tesorería
    """
    config = db.query(ConfiguracionTesoreria).filter(
        ConfiguracionTesoreria.tenant_id == current_user.tenant_id,
        ConfiguracionTesoreria.sucursal_id == active_sucursal_id,
    ).first()
    
    if not config:
        # Crear si no existe
        config = ConfiguracionTesoreria(
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
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
    consolidar_todas: bool = Query(False),
    sucursal_id: Optional[UUID] = Query(
        None,
        description="Filtrar por sede (p. ej. reportes con sede elegida). Requiere administrador o contador.",
    ),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Generar y descargar comprobante de egreso en PDF
    """
    scope_sid = comprobante_egreso_scope_sid(
        db,
        current_user,
        consolidar_todas=consolidar_todas,
        active_sucursal_id=active_sucursal_id,
        sucursal_id_param=sucursal_id,
    )
    movimiento = (
        _filter_movimientos_tesoreria(
            db.query(MovimientoTesoreria),
            current_user.tenant_id,
            scope_sid,
            solo_activos=False,
        )
        .filter(MovimientoTesoreria.id == movimiento_id)
        .first()
    )
    
    if not movimiento:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movimiento no encontrado"
        )

    if movimiento.anulado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede descargar el comprobante de un movimiento anulado.",
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
    
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()

    if movimiento.beneficiario:
        beneficiario_pdf = movimiento.beneficiario
    elif " - " in (movimiento.concepto or ""):
        beneficiario_pdf = movimiento.concepto.split(" - ", 1)[0].strip()
    else:
        beneficiario_pdf = "N/A"

    tipo_id_pdf = movimiento.beneficiario_tipo_identificacion or "—"
    numero_id_pdf = movimiento.beneficiario_numero_identificacion or "—"
    concepto_pdf = (
        movimiento.concepto.split(" - ", 1)[1].strip()
        if (not movimiento.beneficiario) and " - " in (movimiento.concepto or "")
        else (movimiento.concepto or "")
    )

    pdf_buffer = generar_comprobante_egreso(
        numero_comprobante=numero_comprobante,
        fecha=movimiento.fecha_movimiento,
        beneficiario=beneficiario_pdf,
        beneficiario_tipo_identificacion=tipo_id_pdf,
        beneficiario_numero_identificacion=numero_id_pdf,
        concepto=concepto_pdf,
        categoria=categoria_str,
        monto=abs(movimiento.monto),
        metodo_pago=metodo_pago_str,
        autorizado_por=autorizado_por,
        desglose_efectivo=desglose_dict,
        tenant_logo_url=tenant.logo_url if tenant else None,
        nombre_comercial_cda=tenant.nombre_comercial if tenant else None,
        beneficiario_direccion=movimiento.beneficiario_direccion,
        beneficiario_email=movimiento.beneficiario_email,
        beneficiario_telefono=movimiento.beneficiario_telefono,
        beneficiario_factus_municipality_id=movimiento.beneficiario_factus_municipality_id,
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
            {"value": "otro_ingreso", "label": "Otro Ingreso"},
            {"value": "ajuste_correccion", "label": "Ajuste / corrección de monto"},
        ],
        "egresos": [
            {"value": "nomina", "label": "Nómina y Salarios"},
            {"value": "servicios_publicos", "label": "Servicios Públicos"},
            {"value": "arriendo", "label": "Arriendo"},
            {"value": "proveedores", "label": "Proveedores (RUNT, INDRA, etc.)"},
            {"value": "compra_inventario", "label": "Compra de Inventario"},
            {"value": "mantenimiento", "label": "Mantenimiento"},
            {"value": "impuestos", "label": "Impuestos"},
            {"value": "otros_gastos", "label": "Otros Gastos"},
            {"value": "ajuste_correccion", "label": "Ajuste / corrección de monto"},
        ],
        "metodos_pago": [
            {"value": "efectivo", "label": "Efectivo"},
            {"value": "transferencia", "label": "Transferencia"},
            {"value": "cheque", "label": "Cheque"},
            {"value": "consignacion", "label": "Consignación"}
        ]
    }

