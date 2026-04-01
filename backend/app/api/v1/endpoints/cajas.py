"""
Endpoints de Cajas
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from datetime import datetime, timezone
from decimal import Decimal
from typing import List

from app.core.deps import get_db, get_current_user, get_cajero_or_admin, get_admin
from app.models.usuario import Usuario
from app.models.caja import Caja, MovimientoCaja, TurnoEnum, EstadoCaja, TipoMovimiento, DesgloseEfectivoCierre
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo
from app.schemas.caja import (
    CajaApertura,
    CajaCierre,
    MovimientoCreate,
    MovimientoResponse,
    CajaResponse,
    CajaDetalle,
    CajaResumen
)
from app.utils.audit import audit_caja_operation
from app.models.audit_log import AuditAction
from app.utils.comprobantes_caja import generar_comprobante_cierre_caja

router = APIRouter()


@router.post("/abrir", response_model=CajaResponse, status_code=status.HTTP_201_CREATED)
def abrir_caja(
    request: Request,
    apertura_data: CajaApertura,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Abrir caja de trabajo
    """
    # Validación adicional de monto inicial
    if apertura_data.monto_inicial < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El monto inicial no puede ser negativo"
        )
    
    # Verificar que no tenga ya una caja abierta
    caja_existente = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if caja_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya tienes una caja abierta. Debes cerrarla antes de abrir una nueva."
        )
    
    # Crear nueva caja
    nueva_caja = Caja(
        tenant_id=current_user.tenant_id,
        usuario_id=current_user.id,
        monto_inicial=apertura_data.monto_inicial,
        turno=TurnoEnum(apertura_data.turno),
        estado=EstadoCaja.ABIERTA
    )
    
    db.add(nueva_caja)
    db.commit()
    db.refresh(nueva_caja)
    
    # Auditar apertura de caja
    audit_caja_operation(
        db=db,
        action=AuditAction.OPEN_CAJA,
        description=f"Caja abierta - Turno: {apertura_data.turno} - Monto inicial: ${apertura_data.monto_inicial:,.0f}",
        usuario=current_user,
        request=request,
        metadata={
            "caja_id": str(nueva_caja.id),
            "turno": apertura_data.turno,
            "monto_inicial": float(apertura_data.monto_inicial)
        }
    )
    
    return nueva_caja


@router.get("/activa", response_model=CajaResponse)
def obtener_caja_activa(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Obtener caja activa del usuario actual
    """
    caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una caja abierta"
        )
    
    return caja


@router.get("/activa/resumen", response_model=CajaResumen)
def obtener_resumen_caja(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Obtener resumen de caja activa (para pre-cierre)
    """
    caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una caja abierta"
        )
    
    # Calcular totales por método de pago
    movimientos = db.query(MovimientoCaja).filter(
        MovimientoCaja.caja_id == caja.id
    ).all()
    
    efectivo = Decimal(0)
    tarjeta_debito = Decimal(0)
    tarjeta_credito = Decimal(0)
    transferencia = Decimal(0)
    credismart = Decimal(0)
    sistecredito = Decimal(0)
    total_rtm = Decimal(0)
    total_comision_soat = Decimal(0)
    total_ingresos = Decimal(0)
    total_ingresos_efectivo = Decimal(0)
    total_egresos = Decimal(0)
    
    for mov in movimientos:
        if mov.monto > 0:
            total_ingresos += mov.monto
            if mov.ingresa_efectivo:
                total_ingresos_efectivo += mov.monto
            
            # Clasificar por tipo de concepto
            if mov.tipo == TipoMovimiento.RTM:
                total_rtm += mov.monto
            elif mov.tipo == TipoMovimiento.COMISION_SOAT:
                total_comision_soat += mov.monto
            
            # Clasificar por método (case-insensitive)
            metodo_lower = mov.metodo_pago.lower() if mov.metodo_pago else ""
            if metodo_lower == "efectivo":
                efectivo += mov.monto
            elif metodo_lower == "tarjeta_debito":
                tarjeta_debito += mov.monto
            elif metodo_lower == "tarjeta_credito":
                tarjeta_credito += mov.monto
            elif metodo_lower == "transferencia":
                transferencia += mov.monto
            elif metodo_lower == "credismart":
                credismart += mov.monto
            elif metodo_lower == "sistecredito":
                sistecredito += mov.monto
        else:
            total_egresos += abs(mov.monto)
    
    # Contar vehículos cobrados
    vehiculos_cobrados = db.query(func.count(VehiculoProceso.id)).filter(
        VehiculoProceso.caja_id == caja.id
        ,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).scalar()
    
    return CajaResumen(
        caja_id=caja.id,
        monto_inicial=caja.monto_inicial,
        total_ingresos=total_ingresos,
        total_ingresos_efectivo=total_ingresos_efectivo,
        total_egresos=total_egresos,
        saldo_esperado=caja.saldo_esperado,  # Usar propiedad del modelo
        efectivo=efectivo,
        tarjeta_debito=tarjeta_debito,
        tarjeta_credito=tarjeta_credito,
        transferencia=transferencia,
        credismart=credismart,
        sistecredito=sistecredito,
        total_rtm=total_rtm,
        total_comision_soat=total_comision_soat,
        vehiculos_cobrados=vehiculos_cobrados or 0
    )


@router.post("/cerrar", response_model=CajaResponse)
def cerrar_caja(
    request: Request,
    cierre_data: CajaCierre,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Cerrar caja de trabajo
    """
    caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una caja abierta para cerrar"
        )
    
    # Validar que no haya vehículos pendientes sin cobrar en el tenant.
    # Se alinea con la misma lógica mostrada en UI (/vehiculos/pendientes).
    vehiculos_pendientes = db.query(VehiculoProceso).filter(
        and_(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.estado == EstadoVehiculo.REGISTRADO
        )
    ).count()
    
    if vehiculos_pendientes > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede cerrar la caja. Hay {vehiculos_pendientes} vehículo(s) pendiente(s) sin cobrar. Debes finalizar todos los procesos antes de cerrar."
        )
    
    # Validar desglose de efectivo
    total_desglose = cierre_data.desglose_efectivo.calcular_total()
    if abs(total_desglose - cierre_data.monto_final_fisico) > Decimal('0.01'):  # Tolerancia de 1 centavo
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El desglose de efectivo (${total_desglose:,.0f}) no coincide con el monto final físico declarado (${cierre_data.monto_final_fisico:,.0f})"
        )
    
    # Validar que si hay efectivo esperado, el desglose no sea cero
    saldo_esperado = caja.saldo_esperado
    if saldo_esperado > Decimal('0') and total_desglose == Decimal('0'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Se esperan ${saldo_esperado:,.0f} en efectivo pero el desglose está vacío. Debes contar los billetes y monedas."
        )
    
    # Calcular saldo esperado
    saldo_esperado = caja.saldo_esperado
    
    try:
        # Actualizar caja
        caja.fecha_cierre = datetime.now(timezone.utc)
        caja.monto_final_sistema = Decimal(str(saldo_esperado))
        caja.monto_final_fisico = cierre_data.monto_final_fisico
        caja.diferencia = cierre_data.monto_final_fisico - Decimal(str(saldo_esperado))
        caja.observaciones_cierre = cierre_data.observaciones_cierre
        caja.estado = EstadoCaja.CERRADA
        
        # Guardar desglose de efectivo
        desglose = DesgloseEfectivoCierre(
            tenant_id=current_user.tenant_id,
            caja_id=caja.id,
            billetes_100000=cierre_data.desglose_efectivo.billetes_100000,
            billetes_50000=cierre_data.desglose_efectivo.billetes_50000,
            billetes_20000=cierre_data.desglose_efectivo.billetes_20000,
            billetes_10000=cierre_data.desglose_efectivo.billetes_10000,
            billetes_5000=cierre_data.desglose_efectivo.billetes_5000,
            billetes_2000=cierre_data.desglose_efectivo.billetes_2000,
            billetes_1000=cierre_data.desglose_efectivo.billetes_1000,
            monedas_1000=cierre_data.desglose_efectivo.monedas_1000,
            monedas_500=cierre_data.desglose_efectivo.monedas_500,
            monedas_200=cierre_data.desglose_efectivo.monedas_200,
            monedas_100=cierre_data.desglose_efectivo.monedas_100,
            monedas_50=cierre_data.desglose_efectivo.monedas_50
        )
        db.add(desglose)
        
        # Crear notificación para administradores
        from app.models.notificacion_cierre import NotificacionCierreCaja
        notificacion = NotificacionCierreCaja(
            tenant_id=current_user.tenant_id,
            caja_id=caja.id,
            turno=caja.turno.value,
            cajera_nombre=current_user.nombre_completo,
            fecha_cierre=caja.fecha_cierre,
            efectivo_entregar=cierre_data.monto_final_fisico,
            monto_sistema=Decimal(str(saldo_esperado)),
            monto_fisico=cierre_data.monto_final_fisico,
            diferencia=caja.diferencia,
            observaciones=cierre_data.observaciones_cierre
        )
        db.add(notificacion)
        
        # Commit atómico de caja + desglose + notificación
        db.commit()
        db.refresh(caja)
        
        # Auditar cierre de caja (fuera de la transacción crítica)
        audit_caja_operation(
            db=db,
            action=AuditAction.CLOSE_CAJA,
            description=f"Caja cerrada - Sistema: ${saldo_esperado:,.0f} - Físico: ${cierre_data.monto_final_fisico:,.0f} - Diferencia: ${abs(caja.diferencia):,.0f}",
            usuario=current_user,
            request=request,
            metadata={
                "caja_id": str(caja.id),
                "monto_final_sistema": float(saldo_esperado),
                "monto_final_fisico": float(cierre_data.monto_final_fisico),
                "diferencia": float(caja.diferencia),
                "observaciones": cierre_data.observaciones_cierre
            }
        )
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al cerrar la caja: {str(e)}"
        )
    
    return caja


@router.post("/movimientos", response_model=MovimientoResponse, status_code=status.HTTP_201_CREATED)
def crear_movimiento(
    request: Request,
    movimiento_data: MovimientoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Crear movimiento manual (gasto, ajuste, etc)
    """
    caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una caja abierta"
        )
    
    # Crear movimiento
    movimiento = MovimientoCaja(
        tenant_id=current_user.tenant_id,
        caja_id=caja.id,
        tipo=TipoMovimiento(movimiento_data.tipo),
        monto=movimiento_data.monto,
        metodo_pago=movimiento_data.metodo_pago,
        concepto=movimiento_data.concepto,
        ingresa_efectivo=movimiento_data.ingresa_efectivo,
        created_by=current_user.id
    )
    
    db.add(movimiento)
    db.commit()
    db.refresh(movimiento)
    
    # Determinar acción de auditoría según tipo de movimiento
    if movimiento.monto < 0:
        action = AuditAction.REGISTER_GASTO
        descripcion = f"Gasto registrado: {movimiento_data.concepto} - ${abs(movimiento_data.monto):,.0f}"
    else:
        action = AuditAction.REGISTER_INGRESO_EXTRA
        descripcion = f"Ingreso extra registrado: {movimiento_data.concepto} - ${movimiento_data.monto:,.0f}"
    
    audit_caja_operation(
        db=db,
        action=action,
        description=descripcion,
        usuario=current_user,
        request=request,
        metadata={
            "caja_id": str(caja.id),
            "movimiento_id": str(movimiento.id),
            "tipo": movimiento_data.tipo,
            "monto": float(movimiento_data.monto),
            "metodo_pago": movimiento_data.metodo_pago,
            "concepto": movimiento_data.concepto
        }
    )
    
    return movimiento


@router.get("/vehiculos-por-metodo")
def obtener_vehiculos_por_metodo(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Obtener vehículos cobrados agrupados por método de pago
    """
    caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una caja abierta"
        )
    
    # Obtener vehículos cobrados con su método de pago
    vehiculos = db.query(
        VehiculoProceso.placa,
        VehiculoProceso.cliente_nombre,
        VehiculoProceso.total_cobrado,
        VehiculoProceso.metodo_pago,
        VehiculoProceso.fecha_pago
    ).filter(
        VehiculoProceso.caja_id == caja.id
        ,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).order_by(VehiculoProceso.fecha_pago.desc()).all()
    
    # Agrupar por método de pago
    agrupados = {
        "efectivo": [],
        "tarjeta_debito": [],
        "tarjeta_credito": [],
        "transferencia": [],
        "mixto": [],
        "credismart": [],
        "sistecredito": []
    }
    
    for vehiculo in vehiculos:
        metodo = vehiculo.metodo_pago
        if metodo in agrupados:
            agrupados[metodo].append({
                "placa": vehiculo.placa,
                "cliente_nombre": vehiculo.cliente_nombre,
                "total_cobrado": float(vehiculo.total_cobrado),
                "fecha_pago": vehiculo.fecha_pago.isoformat() if vehiculo.fecha_pago else None
            })
    
    return agrupados


@router.get("/movimientos", response_model=List[MovimientoResponse])
def listar_movimientos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Listar movimientos de la caja activa
    """
    caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes una caja abierta"
        )
    
    movimientos = db.query(MovimientoCaja).filter(
        MovimientoCaja.caja_id == caja.id
    ).order_by(MovimientoCaja.created_at).all()
    
    return movimientos


@router.get("/ultima-cerrada")
def obtener_ultima_caja_cerrada(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Obtener resumen de la última caja cerrada del usuario
    """
    ultima_caja = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.CERRADA
        )
    ).order_by(Caja.fecha_cierre.desc()).first()
    
    if not ultima_caja:
        return None
    
    # Contar vehículos cobrados
    vehiculos_cobrados = db.query(func.count(VehiculoProceso.id)).filter(
        VehiculoProceso.caja_id == ultima_caja.id
    ).scalar()
    
    return {
        "caja_id": str(ultima_caja.id),
        "fecha_cierre": ultima_caja.fecha_cierre.isoformat(),
        "turno": ultima_caja.turno,
        "vehiculos_cobrados": vehiculos_cobrados or 0,
        "total_ingresos": float(ultima_caja.saldo_esperado) - float(ultima_caja.monto_inicial),
        "diferencia": float(ultima_caja.diferencia) if ultima_caja.diferencia else 0
    }


@router.get("/historial", response_model=List[CajaResponse])
def obtener_historial_cajas(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener historial de cajas (admin ve todas, cajero solo las suyas)
    """
    query = db.query(Caja).filter(Caja.tenant_id == current_user.tenant_id)
    
    # Si no es admin, solo ver sus propias cajas
    if current_user.rol != "administrador":
        query = query.filter(Caja.usuario_id == current_user.id)
    
    cajas = query.order_by(Caja.fecha_apertura.desc()).limit(limit).all()
    
    return cajas


@router.get("/{caja_id}/detalle", response_model=CajaDetalle)
def obtener_detalle_caja(
    caja_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener detalle completo de una caja
    """
    caja = db.query(Caja).filter(
        Caja.id == caja_id,
        Caja.tenant_id == current_user.tenant_id
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caja no encontrada"
        )
    
    # Verificar permisos
    if current_user.rol != "administrador" and caja.usuario_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para ver esta caja"
        )
    
    # Obtener movimientos
    movimientos = db.query(MovimientoCaja).filter(
        MovimientoCaja.caja_id == caja.id
    ).order_by(MovimientoCaja.created_at).all()
    
    # Calcular totales por método
    efectivo = Decimal(0)
    tarjeta = Decimal(0)
    transferencia = Decimal(0)
    credismart = Decimal(0)
    sistecredito = Decimal(0)
    
    for mov in movimientos:
        if mov.monto > 0:
            metodo_lower = mov.metodo_pago.lower() if mov.metodo_pago else ""
            if metodo_lower == "efectivo":
                efectivo += mov.monto
            elif metodo_lower in ["tarjeta_debito", "tarjeta_credito"]:
                tarjeta += mov.monto
            elif metodo_lower == "transferencia":
                transferencia += mov.monto
            elif metodo_lower == "credismart":
                credismart += mov.monto
            elif metodo_lower == "sistecredito":
                sistecredito += mov.monto
    
    # Contar vehículos
    vehiculos_cobrados = db.query(func.count(VehiculoProceso.id)).filter(
        VehiculoProceso.caja_id == caja.id,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).scalar()
    
    # Crear CajaResponse con propiedades calculadas
    caja_response = CajaResponse(
        id=caja.id,
        usuario_id=caja.usuario_id,
        fecha_apertura=caja.fecha_apertura,
        monto_inicial=caja.monto_inicial,
        turno=caja.turno.value,
        fecha_cierre=caja.fecha_cierre,
        monto_final_sistema=caja.monto_final_sistema,
        monto_final_fisico=caja.monto_final_fisico,
        diferencia=caja.diferencia,
        observaciones_cierre=caja.observaciones_cierre,
        estado=caja.estado.value,
        total_ingresos_efectivo=Decimal(str(caja.total_ingresos_efectivo)),
        total_egresos=Decimal(str(caja.total_egresos)),
        saldo_esperado=Decimal(str(caja.saldo_esperado))
    )
    
    return CajaDetalle(
        caja=caja_response,
        movimientos=movimientos,
        vehiculos_cobrados=vehiculos_cobrados or 0,
        total_efectivo=efectivo,
        total_tarjeta=tarjeta,
        total_transferencia=transferencia,
        total_credismart=credismart,
        total_sistecredito=sistecredito
    )


@router.get("/{caja_id}/comprobante-cierre")
def descargar_comprobante_cierre(
    caja_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Descargar comprobante de cierre de caja en PDF
    """
    caja = db.query(Caja).filter(
        Caja.id == caja_id,
        Caja.tenant_id == current_user.tenant_id
    ).first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caja no encontrada"
        )
    
    # Verificar que la caja esté cerrada
    if caja.estado != EstadoCaja.CERRADA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La caja debe estar cerrada para generar el comprobante"
        )
    
    # Verificar permisos
    if current_user.rol != "administrador" and caja.usuario_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para ver este comprobante"
        )
    
    # Obtener desglose de efectivo.
    # Si por alguna razón no existe registro, generamos comprobante igual
    # con desglose en cero para no bloquear la operación de cierre.
    desglose = db.query(DesgloseEfectivoCierre).filter(
        DesgloseEfectivoCierre.caja_id == caja.id
    ).first()
    
    # Calcular totales para el PDF
    tenant_logo_url = None
    if caja.tenant_id:
        from app.models.tenant import Tenant
        tenant = db.query(Tenant).filter(Tenant.id == caja.tenant_id).first()
        tenant_logo_url = tenant.logo_url if tenant else None

    movimientos = db.query(MovimientoCaja).filter(
        MovimientoCaja.caja_id == caja.id
    ).all()
    
    total_rtm = Decimal(0)
    total_soat = Decimal(0)
    total_efectivo = Decimal(0)
    total_tarjeta_debito = Decimal(0)
    total_tarjeta_credito = Decimal(0)
    total_transferencia = Decimal(0)
    total_credismart = Decimal(0)
    total_sistecredito = Decimal(0)
    
    for mov in movimientos:
        if mov.monto > 0:
            if mov.tipo == TipoMovimiento.RTM:
                total_rtm += mov.monto
            elif mov.tipo == TipoMovimiento.COMISION_SOAT:
                total_soat += mov.monto
            
            # Clasificar por método de pago (case-insensitive)
            metodo_lower = mov.metodo_pago.lower() if mov.metodo_pago else ""
            if metodo_lower == "efectivo":
                total_efectivo += mov.monto
            elif metodo_lower == "tarjeta_debito":
                total_tarjeta_debito += mov.monto
            elif metodo_lower == "tarjeta_credito":
                total_tarjeta_credito += mov.monto
            elif metodo_lower == "transferencia":
                total_transferencia += mov.monto
            elif metodo_lower == "credismart":
                total_credismart += mov.monto
            elif metodo_lower == "sistecredito":
                total_sistecredito += mov.monto
    
    # Contar vehículos
    vehiculos_cobrados = db.query(func.count(VehiculoProceso.id)).filter(
        VehiculoProceso.caja_id == caja.id,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).scalar() or 0
    
    # Preparar desglose como diccionario
    if desglose:
        desglose_dict = {
            'billetes_100000': int(desglose.billetes_100000 or 0),
            'billetes_50000': int(desglose.billetes_50000 or 0),
            'billetes_20000': int(desglose.billetes_20000 or 0),
            'billetes_10000': int(desglose.billetes_10000 or 0),
            'billetes_5000': int(desglose.billetes_5000 or 0),
            'billetes_2000': int(desglose.billetes_2000 or 0),
            'billetes_1000': int(desglose.billetes_1000 or 0),
            'monedas_1000': int(desglose.monedas_1000 or 0),
            'monedas_500': int(desglose.monedas_500 or 0),
            'monedas_200': int(desglose.monedas_200 or 0),
            'monedas_100': int(desglose.monedas_100 or 0),
            'monedas_50': int(desglose.monedas_50 or 0),
        }
    else:
        desglose_dict = {
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
    
    # Generar PDF
    pdf_buffer = generar_comprobante_cierre_caja(
        caja_id=str(caja.id),
        cajero_nombre=caja.usuario.nombre_completo,
        turno=caja.turno.value,
        fecha_apertura=caja.fecha_apertura,
        fecha_cierre=caja.fecha_cierre,
        monto_inicial=caja.monto_inicial,
        total_ingresos_efectivo=Decimal(str(caja.total_ingresos_efectivo)),
        total_egresos=Decimal(str(caja.total_egresos)),
        saldo_esperado=Decimal(str(caja.saldo_esperado)),
        monto_final_fisico=caja.monto_final_fisico,
        diferencia=caja.diferencia,
        desglose_efectivo=desglose_dict,
        observaciones=caja.observaciones_cierre,
        vehiculos_cobrados=vehiculos_cobrados,
        total_rtm=total_rtm,
        total_soat=total_soat,
        total_efectivo=total_efectivo,
        total_tarjeta_debito=total_tarjeta_debito,
        total_tarjeta_credito=total_tarjeta_credito,
        total_transferencia=total_transferencia,
        total_credismart=total_credismart,
        total_sistecredito=total_sistecredito,
        tenant_logo_url=tenant_logo_url,
    )
    
    # Retornar PDF como bytes para evitar descargas corruptas en algunos clientes.
    pdf_bytes = pdf_buffer.getvalue()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=comprobante_cierre_caja_{caja.fecha_cierre.strftime('%Y%m%d_%H%M')}.pdf",
            "Content-Length": str(len(pdf_bytes)),
        },
    )
