"""
Endpoints de Vehículos
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from datetime import datetime, date, timezone
from typing import List, Dict
from decimal import Decimal

from app.core.deps import get_db, get_current_user, get_cajero_or_admin, get_recepcionista_or_admin
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo, MetodoPago
from app.models.tarifa import Tarifa, ComisionSOAT
from app.models.caja import Caja, MovimientoCaja, TipoMovimiento, EstadoCaja
from app.utils.email import (
    enviar_email,
    enviar_email_con_adjuntos,
    generar_email_bienvenida_recepcion_cliente,
    generar_email_llamado_caja_cliente,
    generar_email_recibo_pago_cliente,
)
from app.utils.quality import create_quality_survey_invite
from app.utils.rtm_reminders import schedule_rtm_renewal_reminder_for_vehicle
from app.schemas.vehiculo import (
    VehiculoRegistro,
    VehiculoEdicion,
    VehiculoCobro,
    VehiculoResponse,
    VehiculosPendientes,
    VehiculoConTarifa,
    TarifaCalculada,
    VentaSOAT
)

router = APIRouter()

VALID_PAYMENT_METHODS = {
    "efectivo",
    "tarjeta_debito",
    "tarjeta_credito",
    "transferencia",
    "credismart",
    "sistecredito",
    "mixto",
}
MIXED_BREAKDOWN_METHODS = VALID_PAYMENT_METHODS - {"mixto"}


def _normalize_payment_method(method: str) -> str:
    normalized = (method or "").strip().lower()
    if normalized not in VALID_PAYMENT_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Método de pago inválido. Opciones: {', '.join(sorted(VALID_PAYMENT_METHODS))}",
        )
    return normalized


def _validate_mixed_breakdown(
    breakdown: Dict[str, float] | None,
    total_expected: Decimal,
) -> Dict[str, Decimal]:
    if not breakdown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe proporcionar el desglose de pagos para método mixto",
        )

    normalized_amounts: Dict[str, Decimal] = {}
    for raw_method, raw_amount in breakdown.items():
        method = (raw_method or "").strip().lower()
        if method not in MIXED_BREAKDOWN_METHODS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Método '{raw_method}' no permitido en desglose mixto",
            )
        amount = Decimal(str(raw_amount))
        if amount < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El monto del método '{method}' no puede ser negativo",
            )
        if amount == 0:
            continue
        normalized_amounts[method] = normalized_amounts.get(method, Decimal("0")) + amount

    if len(normalized_amounts) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El pago mixto requiere al menos 2 métodos con valor mayor a 0",
        )

    rounded_sum = sum(normalized_amounts.values()).quantize(Decimal("0.01"))
    rounded_expected = Decimal(str(total_expected)).quantize(Decimal("0.01"))
    if rounded_sum != rounded_expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"La suma del desglose ({rounded_sum}) no coincide con el total a cobrar ({rounded_expected})",
        )

    return normalized_amounts


def mapear_tipo_vehiculo_a_comision(tipo_vehiculo: str) -> str:
    """
    Mapear tipo de vehículo RTM a tipo de comisión SOAT.
    - Motos → 'moto' (comisión $30,000)
    - Vehículos livianos y pesados → 'carro' (comisión $50,000)
    """
    if tipo_vehiculo == "moto":
        return "moto"
    elif tipo_vehiculo in ["liviano_particular", "liviano_publico", "pesado_particular", "pesado_publico"]:
        return "carro"
    else:
        # Por defecto, si es un tipo no reconocido, usar 'carro'
        return "carro"


def calcular_tarifa_por_antiguedad(ano_modelo: int, tipo_vehiculo: str, tenant_id, db: Session) -> Tarifa:
    """Calcular tarifa según antigüedad y tipo de vehículo"""
    ano_actual = datetime.now().year
    antiguedad = ano_actual - ano_modelo
    
    # Buscar tarifa vigente según tipo y antigüedad
    hoy = date.today()
    tarifa = db.query(Tarifa).filter(
        and_(
            Tarifa.activa == True,
            Tarifa.tenant_id == tenant_id,
            Tarifa.tipo_vehiculo == tipo_vehiculo,
            Tarifa.vigencia_inicio <= hoy,
            Tarifa.vigencia_fin >= hoy,
            Tarifa.antiguedad_min <= antiguedad,
            (Tarifa.antiguedad_max >= antiguedad) | (Tarifa.antiguedad_max == None)
        )
    ).order_by(Tarifa.antiguedad_min.desc(), Tarifa.created_at.desc()).first()
    
    if not tarifa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró tarifa para vehículo tipo '{tipo_vehiculo}' de {antiguedad} años"
        )
    
    return tarifa


@router.post("/registrar", response_model=VehiculoResponse, status_code=status.HTTP_201_CREATED)
def registrar_vehiculo(
    vehiculo_data: VehiculoRegistro,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin)
):
    """
    Registrar vehículo (Recepción)
    """
    # Validar que no exista vehículo con la misma placa en proceso
    placa_upper = vehiculo_data.placa.upper()
    vehiculo_existente = db.query(VehiculoProceso).filter(
        and_(
            VehiculoProceso.placa == placa_upper,
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.estado.in_([EstadoVehiculo.REGISTRADO, EstadoVehiculo.PAGADO])
        )
    ).first()
    
    if vehiculo_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe un vehículo con placa {placa_upper} en estado {vehiculo_existente.estado}"
        )
    
    # Si es PREVENTIVA, no calcular tarifa (se define en Caja)
    if vehiculo_data.tipo_vehiculo == "preventiva":
        # PREVENTIVA: valor se define manualmente en Caja
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        
        # SOAT puede aplicar o no en preventiva
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == "carro",  # Por defecto carro para preventiva
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
                total_cobrado = comision_soat  # Solo SOAT por ahora, preventiva se suma en Caja
    else:
        # Calcular tarifa según tipo y antigüedad (RTM normal)
        tarifa = calcular_tarifa_por_antiguedad(
            vehiculo_data.ano_modelo,
            vehiculo_data.tipo_vehiculo,
            current_user.tenant_id,
            db
        )
        valor_rtm = tarifa.valor_total
        
        # Obtener comisión SOAT si aplica
        comision_soat = Decimal(0)
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            tipo_comision = mapear_tipo_vehiculo_a_comision(vehiculo_data.tipo_vehiculo)
            
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == tipo_comision,
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
        
        total_cobrado = valor_rtm + comision_soat
    
    # Crear vehículo en proceso
    cliente_email_normalizado = (vehiculo_data.cliente_email or "").strip().lower() or None
    nuevo_vehiculo = VehiculoProceso(
        tenant_id=current_user.tenant_id,
        placa=placa_upper,
        tipo_vehiculo=vehiculo_data.tipo_vehiculo,
        marca=vehiculo_data.marca,
        modelo=vehiculo_data.modelo,
        ano_modelo=vehiculo_data.ano_modelo,
        cliente_nombre=vehiculo_data.cliente_nombre,
        cliente_documento=vehiculo_data.cliente_documento,
        cliente_telefono=vehiculo_data.cliente_telefono,
        cliente_email=cliente_email_normalizado,
        valor_rtm=valor_rtm,
        tiene_soat=vehiculo_data.tiene_soat,
        comision_soat=comision_soat,
        total_cobrado=total_cobrado,
        estado=EstadoVehiculo.REGISTRADO,
        observaciones=vehiculo_data.observaciones,
        registrado_por=current_user.id
    )
    
    db.add(nuevo_vehiculo)
    db.commit()
    db.refresh(nuevo_vehiculo)

    # Notificación opcional por email al cliente (no bloquea el flujo de recepción).
    if cliente_email_normalizado:
        try:
            tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
            nombre_cda = (
                tenant.nombre_comercial
                if tenant and tenant.nombre_comercial
                else (tenant.nombre if tenant else "CDASOFT")
            )
            asunto = f"Bienvenido a {nombre_cda}"
            cuerpo_html = generar_email_bienvenida_recepcion_cliente(
                nombre_cda=nombre_cda,
                placa_vehiculo=placa_upper,
            )
            enviar_email(cliente_email_normalizado, asunto, cuerpo_html)
        except Exception as e:
            print(f"[WARN] No se pudo enviar email de recepción al cliente: {e}")
    
    return nuevo_vehiculo


@router.put("/{vehiculo_id}", response_model=VehiculoResponse)
def editar_vehiculo(
    vehiculo_id: str,
    vehiculo_data: VehiculoEdicion,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin)
):
    """
    Editar vehículo registrado (solo antes de cobrar)
    """
    # Buscar vehículo
    vehiculo = db.query(VehiculoProceso).filter(
        VehiculoProceso.id == vehiculo_id,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).first()
    
    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    # Validar que esté en estado REGISTRADO (no cobrado)
    if vehiculo.estado != EstadoVehiculo.REGISTRADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede editar un vehículo en estado {vehiculo.estado}. Solo se pueden editar vehículos registrados."
        )
    
    # Si cambió la placa, validar que no exista otra con la misma placa
    placa_upper = vehiculo_data.placa.upper()
    if placa_upper != vehiculo.placa:
        vehiculo_existente = db.query(VehiculoProceso).filter(
            and_(
                VehiculoProceso.placa == placa_upper,
                VehiculoProceso.id != vehiculo_id,
                VehiculoProceso.tenant_id == current_user.tenant_id,
                VehiculoProceso.estado.in_([EstadoVehiculo.REGISTRADO, EstadoVehiculo.PAGADO])
            )
        ).first()
        
        if vehiculo_existente:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ya existe otro vehículo con placa {placa_upper} en estado {vehiculo_existente.estado}"
            )
    
    # Si es PREVENTIVA, no calcular tarifa
    if vehiculo_data.tipo_vehiculo == "preventiva":
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        
        # SOAT puede aplicar o no en preventiva
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == "carro",
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
                total_cobrado = comision_soat
    else:
        # REUTILIZAR LÓGICA DE REGISTRO: Calcular tarifa según tipo y antigüedad
        tarifa = calcular_tarifa_por_antiguedad(
            vehiculo_data.ano_modelo,
            vehiculo_data.tipo_vehiculo,
            current_user.tenant_id,
            db
        )
        valor_rtm = tarifa.valor_total
        
        # REUTILIZAR LÓGICA DE REGISTRO: Obtener comisión SOAT si aplica
        comision_soat = Decimal(0)
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            tipo_comision = mapear_tipo_vehiculo_a_comision(vehiculo_data.tipo_vehiculo)
            
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == tipo_comision,
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
        
        total_cobrado = valor_rtm + comision_soat
    
    # Actualizar vehículo
    vehiculo.placa = placa_upper
    vehiculo.tipo_vehiculo = vehiculo_data.tipo_vehiculo
    vehiculo.marca = vehiculo_data.marca
    vehiculo.modelo = vehiculo_data.modelo
    vehiculo.ano_modelo = vehiculo_data.ano_modelo
    vehiculo.cliente_nombre = vehiculo_data.cliente_nombre
    vehiculo.cliente_documento = vehiculo_data.cliente_documento
    vehiculo.cliente_telefono = vehiculo_data.cliente_telefono
    vehiculo.cliente_email = (vehiculo_data.cliente_email or "").strip().lower() or None
    vehiculo.tiene_soat = vehiculo_data.tiene_soat
    vehiculo.observaciones = vehiculo_data.observaciones
    
    # Actualizar tarifas (RECALCULADAS)
    vehiculo.valor_rtm = valor_rtm
    vehiculo.comision_soat = comision_soat
    vehiculo.total_cobrado = total_cobrado
    
    db.commit()
    db.refresh(vehiculo)
    
    return vehiculo


@router.get("/pendientes", response_model=VehiculosPendientes)
def listar_pendientes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Listar vehículos pendientes de pago (para Caja)
    """
    vehiculos = db.query(VehiculoProceso).filter(
        VehiculoProceso.estado == EstadoVehiculo.REGISTRADO,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).order_by(VehiculoProceso.fecha_registro).all()
    
    return VehiculosPendientes(
        vehiculos=vehiculos,
        total=len(vehiculos)
    )


@router.post("/{vehiculo_id}/notificar-paso-caja")
def notificar_paso_caja(
    vehiculo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
):
    """
    Notificar por email al cliente para pasar a caja.
    No bloquea la operación de cobro si el envío falla.
    """
    vehiculo = db.query(VehiculoProceso).filter(
        VehiculoProceso.id == vehiculo_id,
        VehiculoProceso.tenant_id == current_user.tenant_id,
    ).first()
    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado",
        )

    if vehiculo.estado != EstadoVehiculo.REGISTRADO:
        return {
            "sent": False,
            "has_email": bool(vehiculo.cliente_email),
            "message": "El vehículo ya no está en estado pendiente de cobro.",
        }

    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if not cliente_email:
        return {
            "sent": False,
            "has_email": False,
            "message": "El cliente no tiene correo electrónico registrado.",
        }

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )

    asunto = f"{nombre_cda} - Te invitamos a pasar a caja"
    cuerpo_html = generar_email_llamado_caja_cliente(
        nombre_cda=nombre_cda,
        nombre_cliente=vehiculo.cliente_nombre,
    )
    sent = enviar_email(cliente_email, asunto, cuerpo_html)

    return {
        "sent": bool(sent),
        "has_email": True,
        "message": "Notificación enviada al cliente." if sent else "No fue posible enviar la notificación.",
    }


@router.post("/{vehiculo_id}/enviar-recibo-email")
async def enviar_recibo_pago_email(
    vehiculo_id: str,
    receipt_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
):
    """Envía por email el recibo PDF generado en caja para el vehículo indicado."""
    vehiculo = db.query(VehiculoProceso).filter(
        VehiculoProceso.id == vehiculo_id,
        VehiculoProceso.tenant_id == current_user.tenant_id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if not cliente_email:
        return {
            "sent": False,
            "has_email": False,
            "message": "El cliente no tiene correo electrónico registrado.",
        }

    content = await receipt_file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo de recibo está vacío")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )
    email_html = generar_email_recibo_pago_cliente(
        nombre_cda=nombre_cda,
        nombre_cliente=vehiculo.cliente_nombre,
        placa_vehiculo=vehiculo.placa,
    )
    filename = receipt_file.filename or f"recibo_pago_{vehiculo.placa}.pdf"
    sent = enviar_email_con_adjuntos(
        destinatario=cliente_email,
        asunto=f"Recibo de pago - {nombre_cda} - {vehiculo.placa}",
        cuerpo_html=email_html,
        adjuntos=[(filename, content, "application/pdf")],
    )
    return {
        "sent": bool(sent),
        "has_email": True,
        "message": "Recibo enviado al cliente." if sent else "No fue posible enviar el recibo por correo.",
    }


@router.post("/cobrar", response_model=VehiculoResponse)
def cobrar_vehiculo(
    request: Request,
    cobro_data: VehiculoCobro,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Cobrar vehículo (Caja)
    """
    metodo_pago = _normalize_payment_method(cobro_data.metodo_pago)

    # Buscar vehículo
    vehiculo = db.query(VehiculoProceso).filter(
        VehiculoProceso.id == cobro_data.vehiculo_id,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).first()
    
    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    if vehiculo.estado != EstadoVehiculo.REGISTRADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Vehículo ya está en estado: {vehiculo.estado}"
        )
    
    # Verificar que cajero tenga caja abierta
    caja_abierta = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tienes una caja abierta. Debes abrir caja antes de cobrar."
        )
    
    try:
        # Si es PREVENTIVA y viene valor manual, actualizar
        if vehiculo.tipo_vehiculo == "preventiva":
            if cobro_data.valor_preventiva is None or cobro_data.valor_preventiva <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Debe ingresar un valor mayor a 0 para el servicio PREVENTIVA"
                )
            
            # Actualizar valor RTM con el valor manual
            vehiculo.valor_rtm = cobro_data.valor_preventiva
            
            # Si tiene SOAT, agregar comisión
            comision_soat = Decimal(0)
            if cobro_data.tiene_soat:
                hoy = date.today()
                comision = db.query(ComisionSOAT).filter(
                    and_(
                        ComisionSOAT.tipo_vehiculo == "carro",
                        ComisionSOAT.tenant_id == current_user.tenant_id,
                        ComisionSOAT.activa == True,
                        ComisionSOAT.vigencia_inicio <= hoy,
                        (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                    )
                ).first()
                
                if comision:
                    comision_soat = comision.valor_comision
            
            vehiculo.tiene_soat = cobro_data.tiene_soat
            vehiculo.comision_soat = comision_soat
            vehiculo.total_cobrado = vehiculo.valor_rtm + comision_soat
        
        # Si NO es preventiva y cambió el estado de SOAT, recalcular comisión
        elif cobro_data.tiene_soat != vehiculo.tiene_soat:
            comision_soat = Decimal(0)
            if cobro_data.tiene_soat:
                hoy = date.today()
                tipo_comision = mapear_tipo_vehiculo_a_comision(vehiculo.tipo_vehiculo)
                
                comision = db.query(ComisionSOAT).filter(
                    and_(
                        ComisionSOAT.tipo_vehiculo == tipo_comision,
                        ComisionSOAT.tenant_id == current_user.tenant_id,
                        ComisionSOAT.activa == True,
                        ComisionSOAT.vigencia_inicio <= hoy,
                        (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                    )
                ).first()
                
                if comision:
                    comision_soat = comision.valor_comision
            
            vehiculo.tiene_soat = cobro_data.tiene_soat
            vehiculo.comision_soat = comision_soat
            vehiculo.total_cobrado = vehiculo.valor_rtm + comision_soat
        
        # Actualizar vehículo - usar setattr para bypass el enum type checking
        vehiculo.numero_factura_dian = cobro_data.numero_factura_dian
        vehiculo.registrado_runt = cobro_data.registrado_runt
        vehiculo.registrado_sicov = cobro_data.registrado_sicov
        vehiculo.registrado_indra = cobro_data.registrado_indra
        vehiculo.fecha_pago = datetime.now(timezone.utc)
        vehiculo.estado = EstadoVehiculo.PAGADO
        vehiculo.caja_id = caja_abierta.id
        vehiculo.cobrado_por = current_user.id
        
        # Para metodo_pago, usar UPDATE raw SQL para bypass enum type checking cuando es mixto
        from sqlalchemy import text
        if metodo_pago == "mixto":
            # Usar SQL directo para actualizar con el valor literal
            db.execute(
                text("UPDATE vehiculos_proceso SET metodo_pago = :metodo WHERE id = :vehiculo_id"),
                {"metodo": "mixto", "vehiculo_id": str(vehiculo.id)}
            )
        else:
            vehiculo.metodo_pago = MetodoPago(metodo_pago)
        
        # Crear movimientos en caja
        # IMPORTANTE: Solo el efectivo ingresa físicamente a caja
        # Tarjetas, transferencias y créditos NO ingresan a caja física
        
        # Si es PAGO MIXTO, crear múltiples movimientos
        if metodo_pago == "mixto":
            desglose_mixto = _validate_mixed_breakdown(cobro_data.desglose_mixto, vehiculo.total_cobrado)
            
            # Crear movimientos por cada método usado en el desglose
            # Distribuir proporcionalmente entre RTM y SOAT
            for metodo, monto_total_decimal in desglose_mixto.items():
                ingresa_efectivo = (metodo == "efectivo")
                
                # Calcular porcentaje que representa este método del total
                porcentaje = monto_total_decimal / vehiculo.total_cobrado
                
                # Distribuir proporcionalmente entre RTM y SOAT
                monto_rtm = vehiculo.valor_rtm * porcentaje
                monto_soat = vehiculo.comision_soat * porcentaje if vehiculo.comision_soat > 0 else Decimal(0)
                
                # Movimiento RTM parcial
                mov_rtm = MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=caja_abierta.id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.RTM,
                    monto=monto_rtm,
                    metodo_pago=metodo,
                    concepto=f"RTM {vehiculo.placa} ({metodo.replace('_', ' ').title()}) - {vehiculo.cliente_nombre}",
                    ingresa_efectivo=ingresa_efectivo,
                    created_by=current_user.id
                )
                db.add(mov_rtm)
                
                # Movimiento SOAT parcial (si aplica)
                if monto_soat > 0:
                    mov_soat = MovimientoCaja(
                        tenant_id=current_user.tenant_id,
                        caja_id=caja_abierta.id,
                        vehiculo_id=vehiculo.id,
                        tipo=TipoMovimiento.COMISION_SOAT,
                        monto=monto_soat,
                        metodo_pago=metodo,
                        concepto=f"Comisión SOAT {vehiculo.placa} ({metodo.replace('_', ' ').title()})",
                        ingresa_efectivo=ingresa_efectivo,
                        created_by=current_user.id
                    )
                    db.add(mov_soat)
        
        # Si NO es mixto, crear movimientos normales
        else:
            ingresa_efectivo_fisico = (metodo_pago == "efectivo")
            
            # 1. RTM
            mov_rtm = MovimientoCaja(
                tenant_id=current_user.tenant_id,
                caja_id=caja_abierta.id,
                vehiculo_id=vehiculo.id,
                tipo=TipoMovimiento.RTM,
                monto=vehiculo.valor_rtm,
                metodo_pago=metodo_pago,
                concepto=f"RTM {vehiculo.placa} - {vehiculo.cliente_nombre}",
                ingresa_efectivo=ingresa_efectivo_fisico,
                created_by=current_user.id
            )
            db.add(mov_rtm)
            
            # 2. Comisión SOAT (si aplica)
            if vehiculo.comision_soat > 0:
                mov_soat = MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=caja_abierta.id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.COMISION_SOAT,
                    monto=vehiculo.comision_soat,
                    metodo_pago=metodo_pago,
                    concepto=f"Comisión SOAT {vehiculo.placa}",
                    ingresa_efectivo=ingresa_efectivo_fisico,
                    created_by=current_user.id
                )
                db.add(mov_soat)
        
        db.commit()
        db.refresh(vehiculo)

        # Programar encuesta de calidad (envío diferido) sin bloquear el flujo de cobro.
        try:
            recepcionista_nombre = None
            if vehiculo.registrado_por:
                recepcionista = db.query(Usuario).filter(Usuario.id == vehiculo.registrado_por).first()
                if recepcionista:
                    recepcionista_nombre = recepcionista.nombre_completo

            create_quality_survey_invite(
                db,
                tenant_id=current_user.tenant_id,
                vehiculo_id=vehiculo.id,
                cliente_nombre=vehiculo.cliente_nombre,
                cliente_email=vehiculo.cliente_email,
                cliente_celular=vehiculo.cliente_telefono,
                placa=vehiculo.placa,
                tipo_vehiculo=vehiculo.tipo_vehiculo,
                cajero_nombre=current_user.nombre_completo,
                recepcionista_nombre=recepcionista_nombre,
                send_delay_hours=3,
                expires_in_days=7,
            )
            db.commit()
        except Exception as quality_exc:
            db.rollback()
            print(f"[WARN] No se pudo programar encuesta de calidad: {quality_exc}")

        # Programar recordatorio de próxima RTM (no bloquea flujo de cobro).
        try:
            schedule_rtm_renewal_reminder_for_vehicle(db, vehiculo)
            db.commit()
        except Exception as reminder_exc:
            db.rollback()
            print(f"[WARN] No se pudo programar recordatorio de próxima RTM: {reminder_exc}")

        from app.utils.audit import audit_caja_operation
        from app.models.audit_log import AuditAction
        audit_caja_operation(
            db=db,
            action=AuditAction.UPDATE_VEHICLE,
            description=f"Cobro registrado: {vehiculo.placa} por ${vehiculo.total_cobrado} ({metodo_pago})",
            usuario=current_user,
            request=request,
            metadata={
                "vehiculo_id": str(vehiculo.id),
                "caja_id": str(caja_abierta.id),
                "metodo_pago": metodo_pago,
                "monto_total": float(vehiculo.total_cobrado),
                "tiene_soat": bool(vehiculo.tiene_soat),
                "comision_soat": float(vehiculo.comision_soat or 0),
                "es_pago_mixto": metodo_pago == "mixto",
            },
        )
        
        return vehiculo
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al procesar el cobro: {str(e)}"
        )


@router.post("/venta-soat", response_model=VehiculoResponse, status_code=status.HTTP_201_CREATED)
def venta_solo_soat(
    venta_data: VentaSOAT,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Venta solo de comisión SOAT (sin revisión técnica)
    Cliente compra SOAT pero NO hace revisión. Solo se cobra comisión.
    """
    # Verificar que cajero tenga caja abierta
    caja_abierta = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA
        )
    ).first()
    
    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tienes una caja abierta. Debes abrir caja antes de registrar ventas."
        )
    
    # Validar placa
    placa_upper = venta_data.placa.upper()
    
    # Obtener comisión SOAT desde la base de datos
    hoy = date.today()
    comision = db.query(ComisionSOAT).filter(
        and_(
            ComisionSOAT.tipo_vehiculo == venta_data.tipo_vehiculo,
            ComisionSOAT.tenant_id == current_user.tenant_id,
            ComisionSOAT.activa == True,
            ComisionSOAT.vigencia_inicio <= hoy,
            (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
        )
    ).first()
    
    if not comision:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró comisión SOAT vigente para tipo '{venta_data.tipo_vehiculo}'"
        )
    
    comision_soat = comision.valor_comision
    
    try:
        # Crear vehículo con estado PAGADO (no pasa por recepción ni inspección)
        vehiculo_soat = VehiculoProceso(
            tenant_id=current_user.tenant_id,
            placa=placa_upper,
            tipo_vehiculo=venta_data.tipo_vehiculo,
            marca=None,
            modelo=None,
            ano_modelo=datetime.now().year,  # Año actual por defecto
            cliente_nombre=venta_data.cliente_nombre,
            cliente_documento=venta_data.cliente_documento,
            cliente_telefono=None,
            valor_rtm=Decimal(0),  # NO hay revisión
            tiene_soat=True,
            comision_soat=comision_soat,
            total_cobrado=comision_soat,  # Solo se cobra la comisión
            metodo_pago=MetodoPago(venta_data.metodo_pago),
            numero_factura_dian=None,  # Venta de SOAT no requiere factura DIAN
            registrado_runt=False,
            registrado_sicov=False,
            registrado_indra=False,
            fecha_pago=datetime.now(timezone.utc),
            estado=EstadoVehiculo.PAGADO,  # Directo a pagado
            observaciones=f"Venta solo SOAT - Valor comercial: ${venta_data.valor_soat_comercial}",
            caja_id=caja_abierta.id,
            registrado_por=current_user.id,
            cobrado_por=current_user.id
        )
        
        db.add(vehiculo_soat)
        db.flush()  # Para obtener el ID del vehículo
        
        # Crear movimiento en caja
        ingresa_efectivo_fisico = (venta_data.metodo_pago == "efectivo")
        
        mov_soat = MovimientoCaja(
            tenant_id=current_user.tenant_id,
            caja_id=caja_abierta.id,
            vehiculo_id=vehiculo_soat.id,
            tipo=TipoMovimiento.COMISION_SOAT,
            monto=comision_soat,
            metodo_pago=venta_data.metodo_pago,
            concepto=f"Venta SOAT {placa_upper} - Comisión",
            ingresa_efectivo=ingresa_efectivo_fisico,
            created_by=current_user.id
        )
        db.add(mov_soat)
        
        db.commit()
        db.refresh(vehiculo_soat)
        
        return vehiculo_soat
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al registrar venta de SOAT: {str(e)}"
        )


@router.get("/cobrados-hoy", response_model=List[VehiculoResponse])
def listar_cobrados_hoy(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Listar vehículos cobrados hoy en la caja del usuario actual
    Para permitir cambio de método de pago
    """
    current_role = current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol)
    hoy = date.today()

    if current_role == "administrador":
        # Admin: supervisa cobrados de hoy en todas las cajas ABIERTAS del tenant.
        cajas_abiertas_subq = db.query(Caja.id).filter(
            and_(
                Caja.tenant_id == current_user.tenant_id,
                Caja.estado == EstadoCaja.ABIERTA,
            )
        ).subquery()

        vehiculos = db.query(VehiculoProceso).filter(
            and_(
                VehiculoProceso.caja_id.in_(cajas_abiertas_subq),
                VehiculoProceso.tenant_id == current_user.tenant_id,
                VehiculoProceso.estado == EstadoVehiculo.PAGADO,
                func.date(VehiculoProceso.fecha_pago) == hoy,
            )
        ).order_by(VehiculoProceso.fecha_pago.desc()).all()
        return vehiculos

    # Cajero/recepcionista con permisos de caja: solo su caja activa.
    caja_abierta = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.estado == EstadoCaja.ABIERTA,
        )
    ).first()
    if not caja_abierta:
        return []

    vehiculos = db.query(VehiculoProceso).filter(
        and_(
            VehiculoProceso.caja_id == caja_abierta.id,
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.estado == EstadoVehiculo.PAGADO,
            func.date(VehiculoProceso.fecha_pago) == hoy,
        )
    ).order_by(VehiculoProceso.fecha_pago.desc()).all()

    return vehiculos


@router.put("/{vehiculo_id}/cambiar-metodo-pago")
def cambiar_metodo_pago(
    vehiculo_id: str,
    nuevo_metodo: str,
    motivo: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin)
):
    """
    Cambiar método de pago de un vehículo ya cobrado
    - Solo si el vehículo está PAGADO
    - Solo si la caja está ABIERTA
    - Solo el mismo día del cobro
    - Requiere motivo obligatorio
    """
    # Validar motivo
    if not motivo or len(motivo.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El motivo debe tener al menos 10 caracteres"
        )
    
    # Validar nuevo método de pago
    nuevo_metodo_normalizado = _normalize_payment_method(nuevo_metodo)
    if nuevo_metodo_normalizado == "mixto":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede cambiar a método 'mixto'. El pago mixto solo es válido al momento del cobro inicial."
        )
    
    # Buscar vehículo
    vehiculo = db.query(VehiculoProceso).filter(
        VehiculoProceso.id == vehiculo_id,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).first()
    
    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    # Validar que esté pagado
    if vehiculo.estado != EstadoVehiculo.PAGADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo se puede cambiar el método de pago de vehículos pagados. Estado actual: {vehiculo.estado}"
        )
    
    # Validar que tenga caja asociada
    if not vehiculo.caja_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El vehículo no tiene caja asociada"
        )
    
    # Obtener caja
    caja = db.query(Caja).filter(
        Caja.id == vehiculo.caja_id,
        Caja.tenant_id == current_user.tenant_id
    ).first()
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caja no encontrada"
        )
    
    # Validar que la caja esté abierta
    if caja.estado != EstadoCaja.ABIERTA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La caja ya está cerrada. No se puede modificar el método de pago"
        )

    # Ownership: cajero solo puede modificar cobros de su caja.
    # Admin del tenant sí puede intervenir.
    current_role = current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol)
    if current_role != "administrador" and caja.usuario_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el cajero propietario de la caja puede cambiar el método de pago de este cobro",
        )
    
    # Validar que sea el mismo día
    hoy = date.today()
    fecha_pago = vehiculo.fecha_pago.date() if vehiculo.fecha_pago else None
    if fecha_pago != hoy:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede cambiar el método de pago el mismo día del cobro"
        )
    
    # Buscar movimientos de caja de este vehículo
    movimientos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja_id == caja.id,
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.vehiculo_id == vehiculo.id
        )
    ).all()
    
    if not movimientos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontraron movimientos asociados a este vehículo"
        )
    
    # Guardar método anterior para auditoría
    metodo_anterior = vehiculo.metodo_pago
    if (metodo_anterior or "").lower() == nuevo_metodo_normalizado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nuevo método de pago es igual al método actual",
        )
    
    try:
        # Actualizar método de pago en vehículo
        vehiculo.metodo_pago = nuevo_metodo_normalizado
        
        # CASO ESPECIAL: Si el método anterior era MIXTO
        # Consolidar todos los movimientos en uno solo con el nuevo método
        if metodo_anterior == "mixto":
            # 1. ELIMINAR todos los movimientos mixtos
            for movimiento in movimientos:
                db.delete(movimiento)
            
            # 2. CREAR movimientos consolidados con el nuevo método
            ingresa_efectivo = (nuevo_metodo_normalizado == "efectivo")
            
            # Movimiento RTM consolidado
            mov_rtm = MovimientoCaja(
                tenant_id=current_user.tenant_id,
                caja_id=caja.id,
                vehiculo_id=vehiculo.id,
                tipo=TipoMovimiento.RTM,
                monto=vehiculo.valor_rtm,
                metodo_pago=nuevo_metodo_normalizado,
                concepto=f"RTM {vehiculo.placa} (Cambio de mixto a {nuevo_metodo_normalizado}) - {vehiculo.cliente_nombre}",
                ingresa_efectivo=ingresa_efectivo,
                created_by=current_user.id
            )
            db.add(mov_rtm)
            
            # Movimiento SOAT consolidado (si aplica)
            if vehiculo.comision_soat > 0:
                mov_soat = MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=caja.id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.COMISION_SOAT,
                    monto=vehiculo.comision_soat,
                    metodo_pago=nuevo_metodo_normalizado,
                    concepto=f"Comisión SOAT {vehiculo.placa} (Cambio de mixto a {nuevo_metodo_normalizado})",
                    ingresa_efectivo=ingresa_efectivo,
                    created_by=current_user.id
                )
                db.add(mov_soat)
        
        # CASO NORMAL: Cambio entre métodos simples
        else:
            # Actualizar cada movimiento existente
            for movimiento in movimientos:
                movimiento.metodo_pago = nuevo_metodo_normalizado
                
                # Ajustar ingresa_efectivo según nuevo método
                # SOLO el efectivo ingresa físicamente a caja
                if nuevo_metodo_normalizado == "efectivo":
                    movimiento.ingresa_efectivo = True
                else:
                    movimiento.ingresa_efectivo = False

        db.commit()

        # Registrar en auditoría (fuera de transacción principal)
        from app.utils.audit import audit_caja_operation
        from app.models.audit_log import AuditAction
        audit_caja_operation(
            db=db,
            action=AuditAction.UPDATE_VEHICLE,
            description=f"Cambio de método de pago: {metodo_anterior} → {nuevo_metodo_normalizado}. Motivo: {motivo}",
            usuario=current_user,
            request=request,
            metadata={
                "vehiculo_id": str(vehiculo.id),
                "placa": vehiculo.placa,
                "caja_id": str(caja.id),
                "metodo_anterior": metodo_anterior,
                "metodo_nuevo": nuevo_metodo_normalizado,
                "motivo": motivo.strip(),
                "movimientos_afectados": len(movimientos),
                "era_mixto": metodo_anterior == "mixto",
            },
        )
        
        return {
            "success": True,
            "message": "Método de pago actualizado exitosamente",
            "metodo_anterior": metodo_anterior,
            "metodo_nuevo": nuevo_metodo_normalizado,
            "vehiculo_id": str(vehiculo.id),
            "placa": vehiculo.placa
        }
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al cambiar método de pago: {str(e)}"
        )


@router.get("/calcular-tarifa/{ano_modelo}", response_model=TarifaCalculada)
def calcular_tarifa(
    ano_modelo: int,
    tipo_vehiculo: str = 'moto',  # Por defecto moto para retrocompatibilidad
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Calcular tarifa para un vehículo según su año de modelo y tipo
    """
    tarifa = calcular_tarifa_por_antiguedad(ano_modelo, tipo_vehiculo, current_user.tenant_id, db)
    ano_actual = datetime.now().year
    antiguedad = ano_actual - ano_modelo
    
    # Calcular descripción de antigüedad
    if tarifa.antiguedad_max:
        descripcion = f"{tarifa.antiguedad_min}-{tarifa.antiguedad_max} años"
    else:
        descripcion = f"{tarifa.antiguedad_min}+ años"
    
    return TarifaCalculada(
        valor_rtm=tarifa.valor_rtm,
        valor_terceros=tarifa.valor_terceros,
        valor_total=tarifa.valor_total,
        descripcion_antiguedad=descripcion
    )


@router.get("/{vehiculo_id}", response_model=VehiculoResponse)
def obtener_vehiculo(
    vehiculo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener detalles de un vehículo
    """
    vehiculo = db.query(VehiculoProceso).filter(
        VehiculoProceso.id == vehiculo_id,
        VehiculoProceso.tenant_id == current_user.tenant_id
    ).first()
    
    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    return vehiculo


@router.get("/", response_model=List[VehiculoResponse])
def listar_vehiculos(
    buscar: str = None,
    estado: str = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Listar vehículos con filtros avanzados y paginación
    
    Filtros:
    - buscar: Búsqueda por placa o cédula del cliente
    - estado: Filtrar por estado del vehículo
    - fecha_desde: Fecha inicio (YYYY-MM-DD)
    - fecha_hasta: Fecha fin (YYYY-MM-DD)
    - skip: Saltar registros (paginación)
    - limit: Límite de registros (default 20)
    """
    from sqlalchemy import or_, func
    
    query = db.query(VehiculoProceso).filter(VehiculoProceso.tenant_id == current_user.tenant_id)
    
    # Filtro de búsqueda (placa o cédula)
    if buscar:
        buscar_term = f"%{buscar.upper()}%"
        query = query.filter(
            or_(
                VehiculoProceso.placa.ilike(buscar_term),
                VehiculoProceso.cliente_documento.ilike(buscar_term),
                VehiculoProceso.cliente_nombre.ilike(buscar_term)
            )
        )
    
    # Filtro por estado
    if estado:
        query = query.filter(VehiculoProceso.estado == estado)
    
    # Filtro por rango de fechas
    if fecha_desde:
        try:
            fecha_inicio = datetime.strptime(fecha_desde, "%Y-%m-%d").date()
            query = query.filter(func.date(VehiculoProceso.fecha_registro) >= fecha_inicio)
        except ValueError:
            pass
    
    if fecha_hasta:
        try:
            fecha_fin = datetime.strptime(fecha_hasta, "%Y-%m-%d").date()
            query = query.filter(func.date(VehiculoProceso.fecha_registro) <= fecha_fin)
        except ValueError:
            pass
    
    # Ordenar por fecha de registro (más recientes primero)
    query = query.order_by(VehiculoProceso.fecha_registro.desc())
    
    # Paginación
    vehiculos = query.offset(skip).limit(limit).all()
    
    return vehiculos


@router.get("/count/total")
def contar_vehiculos(
    buscar: str = None,
    estado: str = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Contar total de vehículos con los mismos filtros que listar_vehiculos
    Útil para calcular paginación en el frontend
    """
    from sqlalchemy import or_, func
    
    query = db.query(VehiculoProceso).filter(VehiculoProceso.tenant_id == current_user.tenant_id)
    
    # Aplicar los mismos filtros
    if buscar:
        buscar_term = f"%{buscar.upper()}%"
        query = query.filter(
            or_(
                VehiculoProceso.placa.ilike(buscar_term),
                VehiculoProceso.cliente_documento.ilike(buscar_term),
                VehiculoProceso.cliente_nombre.ilike(buscar_term)
            )
        )
    
    if estado:
        query = query.filter(VehiculoProceso.estado == estado)
    
    if fecha_desde:
        try:
            fecha_inicio = datetime.strptime(fecha_desde, "%Y-%m-%d").date()
            query = query.filter(func.date(VehiculoProceso.fecha_registro) >= fecha_inicio)
        except ValueError:
            pass
    
    if fecha_hasta:
        try:
            fecha_fin = datetime.strptime(fecha_hasta, "%Y-%m-%d").date()
            query = query.filter(func.date(VehiculoProceso.fecha_registro) <= fecha_fin)
        except ValueError:
            pass
    
    total = query.count()
    
    return {"total": total}
