"""
Endpoints base del módulo de nómina (fase inicial, tenant-aware).
"""
from decimal import Decimal
from datetime import datetime, timezone
from io import BytesIO
import zipfile
import uuid
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.deps import get_admin, get_db, require_nomina_enabled_for_tenant
from app.models.nomina import (
    EstadoPeriodoNomina,
    NominaCentroCosto,
    NominaContrato,
    NominaDesprendibleVersion,
    NominaEmpleado,
    NominaLiquidacion,
    NominaNovedad,
    NominaParametroLegal,
    NominaPeriodo,
    PeriodicidadNomina,
    TipoContratoNomina,
    TipoNovedadNomina,
)
from app.models.usuario import Usuario
from app.schemas.nomina import (
    NominaCentroCostoCreate,
    NominaCentroCostoResponse,
    NominaConceptoDetalle,
    NominaContratoCreate,
    NominaContratoResponse,
    NominaDesprendibleBaseResponse,
    NominaDesprendibleMetaResponse,
    NominaDesprendibleVersionResponse,
    NominaEmpleadoCreate,
    NominaEmpleadoResponse,
    NominaLiquidacionResponse,
    NominaNovedadCreate,
    NominaNovedadResponse,
    NominaParametroLegalResponse,
    NominaParametroLegalUpdate,
    NominaPreliquidacionResumen,
    NominaPeriodoCreate,
    NominaPeriodoEstadoUpdate,
    NominaPeriodoResponse,
)
from app.models.tenant import Tenant
from app.models.audit_log import AuditLog
from app.utils.nomina_pdf import build_nomina_desprendible_pdf
from app.utils.archivo_fiscal_pdf import guardar_pdf_archivo_fiscal, leer_pdf_archivo_fiscal
from app.utils.nomina_legal import calcular_base_legal_colombia

router = APIRouter(dependencies=[Depends(require_nomina_enabled_for_tenant)])


def _obtener_o_crear_parametros_legales(db: Session, current_user: Usuario) -> NominaParametroLegal:
    row = (
        db.query(NominaParametroLegal)
        .filter(NominaParametroLegal.tenant_id == current_user.tenant_id)
        .first()
    )
    if row:
        return row

    defaults = NominaParametroLegal(
        tenant_id=current_user.tenant_id,
        salario_minimo_mensual=Decimal("1300000"),
        auxilio_transporte_mensual=Decimal("162000"),
        uvt=Decimal("47065"),
        tope_ibc_smmlv=Decimal("25"),
        umbral_exoneracion_smmlv=Decimal("10"),
        exoneracion_aportes_activa=True,
        aplica_auxilio_transporte=True,
        umbral_auxilio_transporte_smmlv=Decimal("2"),
        aplica_fsp=True,
        umbral_fsp_smmlv=Decimal("4"),
        pct_fsp_base=Decimal("0.01"),
        aplica_subsistencia=True,
        aplica_retencion_fuente=False,
        umbral_retencion_uvt=Decimal("95"),
        pct_retencion_base=Decimal("0.19"),
        pct_ibc_salario_integral=Decimal("0.70"),
        pct_salud_empleado=Decimal("0.04"),
        pct_pension_empleado=Decimal("0.04"),
        pct_salud_empresa=Decimal("0.085"),
        pct_pension_empresa=Decimal("0.12"),
        pct_arl_empresa=Decimal("0.00522"),
        pct_caja_empresa=Decimal("0.04"),
        pct_sena_empresa=Decimal("0.02"),
        pct_icbf_empresa=Decimal("0.03"),
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(defaults)
    db.commit()
    db.refresh(defaults)
    return defaults


def _validar_transicion_periodo(estado_actual: EstadoPeriodoNomina, estado_nuevo: EstadoPeriodoNomina) -> None:
    transiciones_validas = {
        EstadoPeriodoNomina.BORRADOR: {EstadoPeriodoNomina.PRELIQUIDADA},
        EstadoPeriodoNomina.PRELIQUIDADA: {EstadoPeriodoNomina.APROBADA, EstadoPeriodoNomina.BORRADOR},
        EstadoPeriodoNomina.APROBADA: {EstadoPeriodoNomina.CERRADA},
        EstadoPeriodoNomina.CERRADA: {EstadoPeriodoNomina.PAGADA},
        EstadoPeriodoNomina.PAGADA: set(),
    }
    if estado_nuevo not in transiciones_validas.get(estado_actual, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Transición inválida de {estado_actual.value} a {estado_nuevo.value}.",
        )


@router.post("/empleados", response_model=NominaEmpleadoResponse, status_code=status.HTTP_201_CREATED)
def crear_empleado_nomina(
    payload: NominaEmpleadoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    if payload.centro_costo_id:
        cc = (
            db.query(NominaCentroCosto.id)
            .filter(
                NominaCentroCosto.id == payload.centro_costo_id,
                NominaCentroCosto.tenant_id == current_user.tenant_id,
                NominaCentroCosto.activo == "si",
            )
            .first()
        )
        if not cc:
            raise HTTPException(status_code=400, detail="Centro de costo inválido para este tenant.")

    exists = (
        db.query(NominaEmpleado)
        .filter(
            NominaEmpleado.tenant_id == current_user.tenant_id,
            NominaEmpleado.documento_tipo == payload.documento_tipo,
            NominaEmpleado.documento_numero == payload.documento_numero,
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="Ya existe un empleado con ese documento en este tenant.")

    empleado = NominaEmpleado(
        tenant_id=current_user.tenant_id,
        sucursal_id=payload.sucursal_id,
        centro_costo_id=payload.centro_costo_id,
        codigo_interno=payload.codigo_interno,
        documento_tipo=payload.documento_tipo,
        documento_numero=payload.documento_numero,
        nombres=payload.nombres,
        apellidos=payload.apellidos,
        email=payload.email,
        celular=payload.celular,
        fecha_ingreso=payload.fecha_ingreso,
        created_by=current_user.id,
    )
    db.add(empleado)
    db.commit()
    db.refresh(empleado)
    return empleado


@router.get("/empleados", response_model=List[NominaEmpleadoResponse])
def listar_empleados_nomina(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    return (
        db.query(NominaEmpleado)
        .filter(NominaEmpleado.tenant_id == current_user.tenant_id)
        .order_by(desc(NominaEmpleado.created_at))
        .limit(limit)
        .all()
    )


@router.post("/contratos", response_model=NominaContratoResponse, status_code=status.HTTP_201_CREATED)
def crear_contrato_nomina(
    payload: NominaContratoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    empleado = (
        db.query(NominaEmpleado)
        .filter(
            NominaEmpleado.id == payload.empleado_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not empleado:
        raise HTTPException(status_code=404, detail="Empleado no encontrado en este tenant.")

    if payload.centro_costo_id:
        cc = (
            db.query(NominaCentroCosto.id)
            .filter(
                NominaCentroCosto.id == payload.centro_costo_id,
                NominaCentroCosto.tenant_id == current_user.tenant_id,
                NominaCentroCosto.activo == "si",
            )
            .first()
        )
        if not cc:
            raise HTTPException(status_code=400, detail="Centro de costo inválido para este tenant.")

    try:
        tipo = TipoContratoNomina(payload.tipo_contrato)
        periodicidad = PeriodicidadNomina(payload.periodicidad)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Valor inválido en tipo/periocidad: {exc}") from exc

    contrato = NominaContrato(
        tenant_id=current_user.tenant_id,
        empleado_id=payload.empleado_id,
        centro_costo_id=payload.centro_costo_id,
        es_salario_integral=payload.es_salario_integral,
        tipo_contrato=tipo,
        periodicidad=periodicidad,
        salario_base=payload.salario_base,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin=payload.fecha_fin,
        observaciones=payload.observaciones,
        created_by=current_user.id,
    )
    db.add(contrato)
    db.commit()
    db.refresh(contrato)
    return contrato


@router.get("/contratos", response_model=List[NominaContratoResponse])
def listar_contratos_nomina(
    empleado_id: UUID | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    query = db.query(NominaContrato).filter(NominaContrato.tenant_id == current_user.tenant_id)
    if empleado_id:
        query = query.filter(NominaContrato.empleado_id == empleado_id)
    return query.order_by(desc(NominaContrato.created_at)).limit(limit).all()


@router.post("/centros-costo", response_model=NominaCentroCostoResponse, status_code=status.HTTP_201_CREATED)
def crear_centro_costo_nomina(
    payload: NominaCentroCostoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    exists = (
        db.query(NominaCentroCosto.id)
        .filter(
            NominaCentroCosto.tenant_id == current_user.tenant_id,
            NominaCentroCosto.codigo == payload.codigo.strip(),
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="Ya existe un centro de costo con ese código en este tenant.")

    centro = NominaCentroCosto(
        tenant_id=current_user.tenant_id,
        sucursal_id=payload.sucursal_id,
        codigo=payload.codigo.strip(),
        nombre=payload.nombre.strip(),
        descripcion=(payload.descripcion or "").strip() or None,
        created_by=current_user.id,
    )
    db.add(centro)
    db.commit()
    db.refresh(centro)
    return centro


@router.get("/centros-costo", response_model=List[NominaCentroCostoResponse])
def listar_centros_costo_nomina(
    limit: int = Query(200, ge=1, le=500),
    activos_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    query = db.query(NominaCentroCosto).filter(NominaCentroCosto.tenant_id == current_user.tenant_id)
    if activos_only:
        query = query.filter(NominaCentroCosto.activo == "si")
    return query.order_by(NominaCentroCosto.codigo.asc()).limit(limit).all()


@router.get("/parametros-legales", response_model=NominaParametroLegalResponse)
def obtener_parametros_legales_nomina(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    return _obtener_o_crear_parametros_legales(db, current_user)


@router.put("/parametros-legales", response_model=NominaParametroLegalResponse)
def actualizar_parametros_legales_nomina(
    payload: NominaParametroLegalUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    row = _obtener_o_crear_parametros_legales(db, current_user)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(row, key, value)
    row.updated_by = current_user.id
    db.commit()
    db.refresh(row)
    return row


@router.post("/periodos", response_model=NominaPeriodoResponse, status_code=status.HTTP_201_CREATED)
def crear_periodo_nomina(
    payload: NominaPeriodoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    exists = (
        db.query(NominaPeriodo)
        .filter(
            NominaPeriodo.tenant_id == current_user.tenant_id,
            NominaPeriodo.anio == payload.anio,
            NominaPeriodo.mes == payload.mes,
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="Ya existe un período para ese año/mes en este tenant.")

    periodo = NominaPeriodo(
        tenant_id=current_user.tenant_id,
        anio=payload.anio,
        mes=payload.mes,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin=payload.fecha_fin,
        fecha_pago=payload.fecha_pago,
        observaciones=payload.observaciones,
        opened_by=current_user.id,
    )
    db.add(periodo)
    db.commit()
    db.refresh(periodo)
    return periodo


@router.patch("/periodos/{periodo_id}/estado", response_model=NominaPeriodoResponse)
def actualizar_estado_periodo_nomina(
    periodo_id: UUID,
    payload: NominaPeriodoEstadoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo = (
        db.query(NominaPeriodo)
        .filter(
            NominaPeriodo.id == periodo_id,
            NominaPeriodo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")
    try:
        nuevo_estado = EstadoPeriodoNomina(payload.estado)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Estado inválido: {exc}") from exc
    _validar_transicion_periodo(periodo.estado, nuevo_estado)
    periodo.estado = nuevo_estado
    if payload.observaciones is not None:
        periodo.observaciones = payload.observaciones
    if nuevo_estado in {EstadoPeriodoNomina.CERRADA, EstadoPeriodoNomina.PAGADA}:
        periodo.closed_by = current_user.id
    db.commit()
    db.refresh(periodo)
    return periodo


@router.get("/periodos", response_model=List[NominaPeriodoResponse])
def listar_periodos_nomina(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    return (
        db.query(NominaPeriodo)
        .filter(NominaPeriodo.tenant_id == current_user.tenant_id)
        .order_by(desc(NominaPeriodo.anio), desc(NominaPeriodo.mes))
        .limit(limit)
        .all()
    )


@router.post("/novedades", response_model=NominaNovedadResponse, status_code=status.HTTP_201_CREATED)
def crear_novedad_nomina(
    payload: NominaNovedadCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo = (
        db.query(NominaPeriodo)
        .filter(
            NominaPeriodo.id == payload.periodo_id,
            NominaPeriodo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")

    if periodo.estado != EstadoPeriodoNomina.BORRADOR:
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden agregar novedades cuando el período está en borrador.",
        )

    empleado = (
        db.query(NominaEmpleado)
        .filter(
            NominaEmpleado.id == payload.empleado_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not empleado:
        raise HTTPException(status_code=404, detail="Empleado no encontrado en este tenant.")

    try:
        tipo = TipoNovedadNomina(payload.tipo)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Tipo de novedad inválido: {exc}") from exc

    novedad = NominaNovedad(
        tenant_id=current_user.tenant_id,
        periodo_id=payload.periodo_id,
        empleado_id=payload.empleado_id,
        tipo=tipo,
        concepto=payload.concepto,
        unidades=payload.unidades,
        valor_unitario=payload.valor_unitario,
        valor_total=payload.valor_total,
        observaciones=payload.observaciones,
        created_by=current_user.id,
    )
    db.add(novedad)
    db.commit()
    db.refresh(novedad)
    return novedad


@router.get("/novedades", response_model=List[NominaNovedadResponse])
def listar_novedades_nomina(
    periodo_id: UUID,
    empleado_id: UUID | None = None,
    sucursal_id: UUID | None = None,
    centro_costo_id: UUID | None = None,
    limit: int = Query(300, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    query = (
        db.query(NominaNovedad)
        .join(NominaEmpleado, NominaEmpleado.id == NominaNovedad.empleado_id)
        .filter(
            NominaNovedad.tenant_id == current_user.tenant_id,
            NominaNovedad.periodo_id == periodo_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
        )
    )
    if empleado_id:
        query = query.filter(NominaNovedad.empleado_id == empleado_id)
    if sucursal_id:
        query = query.filter(NominaEmpleado.sucursal_id == sucursal_id)
    if centro_costo_id:
        query = query.filter(NominaEmpleado.centro_costo_id == centro_costo_id)
    return query.order_by(desc(NominaNovedad.created_at)).limit(limit).all()


@router.post(
    "/periodos/{periodo_id}/preliquidar",
    response_model=NominaPreliquidacionResumen,
    status_code=status.HTTP_200_OK,
)
def preliquidar_periodo_nomina(
    periodo_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    parametros_legales = _obtener_o_crear_parametros_legales(db, current_user)
    parametros_map = {
        "salario_minimo_mensual": Decimal(str(parametros_legales.salario_minimo_mensual or 0)),
        "auxilio_transporte_mensual": Decimal(str(parametros_legales.auxilio_transporte_mensual or 0)),
        "uvt": Decimal(str(parametros_legales.uvt or 0)),
        "tope_ibc_smmlv": Decimal(str(parametros_legales.tope_ibc_smmlv or 25)),
        "umbral_exoneracion_smmlv": Decimal(str(parametros_legales.umbral_exoneracion_smmlv or 10)),
        "exoneracion_aportes_activa": bool(parametros_legales.exoneracion_aportes_activa),
        "aplica_auxilio_transporte": bool(parametros_legales.aplica_auxilio_transporte),
        "umbral_auxilio_transporte_smmlv": Decimal(str(parametros_legales.umbral_auxilio_transporte_smmlv or 2)),
        "aplica_fsp": bool(parametros_legales.aplica_fsp),
        "umbral_fsp_smmlv": Decimal(str(parametros_legales.umbral_fsp_smmlv or 4)),
        "pct_fsp_base": Decimal(str(parametros_legales.pct_fsp_base or 0)),
        "aplica_subsistencia": bool(parametros_legales.aplica_subsistencia),
        "aplica_retencion_fuente": bool(parametros_legales.aplica_retencion_fuente),
        "umbral_retencion_uvt": Decimal(str(parametros_legales.umbral_retencion_uvt or 95)),
        "pct_retencion_base": Decimal(str(parametros_legales.pct_retencion_base or 0)),
        "pct_ibc_salario_integral": Decimal(str(parametros_legales.pct_ibc_salario_integral or Decimal("0.70"))),
        "pct_salud_empleado": Decimal(str(parametros_legales.pct_salud_empleado or 0)),
        "pct_pension_empleado": Decimal(str(parametros_legales.pct_pension_empleado or 0)),
        "pct_salud_empresa": Decimal(str(parametros_legales.pct_salud_empresa or 0)),
        "pct_pension_empresa": Decimal(str(parametros_legales.pct_pension_empresa or 0)),
        "pct_arl_empresa": Decimal(str(parametros_legales.pct_arl_empresa or 0)),
        "pct_caja_empresa": Decimal(str(parametros_legales.pct_caja_empresa or 0)),
        "pct_sena_empresa": Decimal(str(parametros_legales.pct_sena_empresa or 0)),
        "pct_icbf_empresa": Decimal(str(parametros_legales.pct_icbf_empresa or 0)),
    }

    periodo = (
        db.query(NominaPeriodo)
        .filter(
            NominaPeriodo.id == periodo_id,
            NominaPeriodo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")

    if periodo.estado not in {EstadoPeriodoNomina.BORRADOR, EstadoPeriodoNomina.PRELIQUIDADA}:
        raise HTTPException(
            status_code=400,
            detail="Solo se puede preliquidar un período en borrador/preliquidada.",
        )

    contratos = (
        db.query(NominaContrato)
        .filter(
            NominaContrato.tenant_id == current_user.tenant_id,
            NominaContrato.estado == "activo",
            NominaContrato.fecha_inicio <= periodo.fecha_fin,
        )
        .all()
    )

    if not contratos:
        raise HTTPException(
            status_code=400,
            detail="No hay contratos activos para preliquidar en este tenant.",
        )

    db.query(NominaLiquidacion).filter(
        NominaLiquidacion.tenant_id == current_user.tenant_id,
        NominaLiquidacion.periodo_id == periodo.id,
    ).delete(synchronize_session=False)

    total_salario_base = Decimal("0")
    total_devengos = Decimal("0")
    total_deducciones = Decimal("0")
    total_neto = Decimal("0")
    empleados_liquidados = 0

    for contrato in contratos:
        if contrato.fecha_fin and contrato.fecha_fin < periodo.fecha_inicio:
            continue

        devengos = (
            db.query(NominaNovedad)
            .filter(
                NominaNovedad.tenant_id == current_user.tenant_id,
                NominaNovedad.periodo_id == periodo.id,
                NominaNovedad.empleado_id == contrato.empleado_id,
                NominaNovedad.tipo == TipoNovedadNomina.DEVENGO,
            )
            .all()
        )
        deducciones = (
            db.query(NominaNovedad)
            .filter(
                NominaNovedad.tenant_id == current_user.tenant_id,
                NominaNovedad.periodo_id == periodo.id,
                NominaNovedad.empleado_id == contrato.empleado_id,
                NominaNovedad.tipo == TipoNovedadNomina.DEDUCCION,
            )
            .all()
        )

        total_dev = sum((Decimal(str(n.valor_total)) for n in devengos), Decimal("0"))
        total_ded = sum((Decimal(str(n.valor_total)) for n in deducciones), Decimal("0"))
        salario_base = Decimal(str(contrato.salario_base))
        legal = calcular_base_legal_colombia(
            salario_base=salario_base,
            parametros={**parametros_map, "es_salario_integral": bool(contrato.es_salario_integral)},
        )
        total_dev_with_legal = total_dev + legal["auxilio_transporte_devengo"]
        total_ded_with_legal = total_ded + legal["total_deducciones_legales_empleado"]
        neto = salario_base + total_dev_with_legal - total_ded_with_legal
        costo_total_empresa = (
            salario_base
            + total_dev_with_legal
            + legal["total_aportes_empresa"]
            + legal["total_provisiones"]
        )

        obs = "Neto negativo, revisar novedades." if neto < 0 else None

        liq = NominaLiquidacion(
            tenant_id=current_user.tenant_id,
            periodo_id=periodo.id,
            empleado_id=contrato.empleado_id,
            contrato_id=contrato.id,
            salario_base=salario_base,
            total_devengos=total_dev_with_legal,
            total_deducciones=total_ded_with_legal,
            neto_pagar=neto,
            auxilio_transporte_devengo=legal["auxilio_transporte_devengo"],
            base_cotizacion=legal["base_cotizacion"],
            aporte_salud_empleado=legal["aporte_salud_empleado"],
            aporte_pension_empleado=legal["aporte_pension_empleado"],
            aporte_fsp_empleado=legal["aporte_fsp_empleado"],
            aporte_subsistencia_empleado=legal["aporte_subsistencia_empleado"],
            retencion_fuente_empleado=legal["retencion_fuente_empleado"],
            aporte_salud_empresa=legal["aporte_salud_empresa"],
            aporte_pension_empresa=legal["aporte_pension_empresa"],
            aporte_arl_empresa=legal["aporte_arl_empresa"],
            aporte_caja_empresa=legal["aporte_caja_empresa"],
            aporte_sena_empresa=legal["aporte_sena_empresa"],
            aporte_icbf_empresa=legal["aporte_icbf_empresa"],
            provision_prima=legal["provision_prima"],
            provision_cesantias=legal["provision_cesantias"],
            provision_intereses_cesantias=legal["provision_intereses_cesantias"],
            provision_vacaciones=legal["provision_vacaciones"],
            costo_total_empresa=costo_total_empresa,
            observaciones=obs,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.add(liq)

        empleados_liquidados += 1
        total_salario_base += salario_base
        total_devengos += total_dev_with_legal
        total_deducciones += total_ded_with_legal
        total_neto += neto

    periodo.estado = EstadoPeriodoNomina.PRELIQUIDADA
    db.commit()

    return NominaPreliquidacionResumen(
        periodo_id=periodo.id,
        empleados_liquidados=empleados_liquidados,
        total_salario_base=total_salario_base,
        total_devengos=total_devengos,
        total_deducciones=total_deducciones,
        total_neto_pagar=total_neto,
    )


@router.get(
    "/periodos/{periodo_id}/liquidaciones",
    response_model=List[NominaLiquidacionResponse],
)
def listar_liquidaciones_periodo(
    periodo_id: UUID,
    empleado_id: UUID | None = None,
    sucursal_id: UUID | None = None,
    centro_costo_id: UUID | None = None,
    limit: int = Query(300, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo_exists = (
        db.query(NominaPeriodo.id)
        .filter(
            NominaPeriodo.id == periodo_id,
            NominaPeriodo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not periodo_exists:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")

    query = (
        db.query(NominaLiquidacion)
        .join(NominaEmpleado, NominaEmpleado.id == NominaLiquidacion.empleado_id)
        .join(NominaContrato, NominaContrato.id == NominaLiquidacion.contrato_id)
        .filter(
            NominaLiquidacion.tenant_id == current_user.tenant_id,
            NominaLiquidacion.periodo_id == periodo_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
            NominaContrato.tenant_id == current_user.tenant_id,
        )
    )
    if empleado_id:
        query = query.filter(NominaLiquidacion.empleado_id == empleado_id)
    if sucursal_id:
        query = query.filter(NominaEmpleado.sucursal_id == sucursal_id)
    if centro_costo_id:
        query = query.filter(
            (NominaContrato.centro_costo_id == centro_costo_id)
            | (NominaEmpleado.centro_costo_id == centro_costo_id)
        )
    return query.order_by(desc(NominaLiquidacion.neto_pagar)).limit(limit).all()


@router.post("/periodos/{periodo_id}/aprobar", response_model=NominaPeriodoResponse)
def aprobar_periodo_nomina(
    periodo_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo = (
        db.query(NominaPeriodo)
        .filter(NominaPeriodo.id == periodo_id, NominaPeriodo.tenant_id == current_user.tenant_id)
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")
    _validar_transicion_periodo(periodo.estado, EstadoPeriodoNomina.APROBADA)
    periodo.estado = EstadoPeriodoNomina.APROBADA
    periodo.observaciones = (periodo.observaciones or "").strip() or "Período aprobado."
    db.commit()
    db.refresh(periodo)
    return periodo


@router.post("/periodos/{periodo_id}/cerrar", response_model=NominaPeriodoResponse)
def cerrar_periodo_nomina(
    periodo_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo = (
        db.query(NominaPeriodo)
        .filter(NominaPeriodo.id == periodo_id, NominaPeriodo.tenant_id == current_user.tenant_id)
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")
    _validar_transicion_periodo(periodo.estado, EstadoPeriodoNomina.CERRADA)
    periodo.estado = EstadoPeriodoNomina.CERRADA
    periodo.closed_by = current_user.id
    db.commit()
    db.refresh(periodo)
    return periodo


@router.post("/periodos/{periodo_id}/marcar-pagada", response_model=NominaPeriodoResponse)
def marcar_pagada_periodo_nomina(
    periodo_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo = (
        db.query(NominaPeriodo)
        .filter(NominaPeriodo.id == periodo_id, NominaPeriodo.tenant_id == current_user.tenant_id)
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")
    _validar_transicion_periodo(periodo.estado, EstadoPeriodoNomina.PAGADA)
    periodo.estado = EstadoPeriodoNomina.PAGADA
    periodo.closed_by = current_user.id
    db.commit()
    db.refresh(periodo)
    return periodo


@router.get(
    "/liquidaciones/{liquidacion_id}/desprendible-base",
    response_model=NominaDesprendibleBaseResponse,
)
def obtener_desprendible_base(
    liquidacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    liq = (
        db.query(NominaLiquidacion)
        .filter(
            NominaLiquidacion.id == liquidacion_id,
            NominaLiquidacion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada en este tenant.")

    empleado = (
        db.query(NominaEmpleado)
        .filter(
            NominaEmpleado.id == liq.empleado_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not empleado:
        raise HTTPException(status_code=404, detail="Empleado no encontrado para esta liquidación.")

    novedades = (
        db.query(NominaNovedad)
        .filter(
            NominaNovedad.tenant_id == current_user.tenant_id,
            NominaNovedad.periodo_id == liq.periodo_id,
            NominaNovedad.empleado_id == liq.empleado_id,
        )
        .order_by(desc(NominaNovedad.created_at))
        .all()
    )

    devengos: list[NominaConceptoDetalle] = []
    deducciones: list[NominaConceptoDetalle] = []
    for n in novedades:
        det = NominaConceptoDetalle(
            tipo=n.tipo.value if hasattr(n.tipo, "value") else str(n.tipo),
            concepto=n.concepto,
            unidades=Decimal(str(n.unidades)),
            valor_unitario=Decimal(str(n.valor_unitario)),
            valor_total=Decimal(str(n.valor_total)),
        )
        if n.tipo == TipoNovedadNomina.DEVENGO:
            devengos.append(det)
        else:
            deducciones.append(det)

    # Deducciones legales calculadas en liquidación (trazables)
    if Decimal(str(liq.aporte_salud_empleado or 0)) > 0:
        deducciones.append(
            NominaConceptoDetalle(
                tipo="deduccion",
                concepto="Aporte salud empleado (4%)",
                unidades=Decimal("1"),
                valor_unitario=Decimal(str(liq.aporte_salud_empleado)),
                valor_total=Decimal(str(liq.aporte_salud_empleado)),
            )
        )
    if Decimal(str(liq.aporte_pension_empleado or 0)) > 0:
        deducciones.append(
            NominaConceptoDetalle(
                tipo="deduccion",
                concepto="Aporte pensión empleado (4%)",
                unidades=Decimal("1"),
                valor_unitario=Decimal(str(liq.aporte_pension_empleado)),
                valor_total=Decimal(str(liq.aporte_pension_empleado)),
            )
        )
    if Decimal(str(liq.aporte_fsp_empleado or 0)) > 0:
        deducciones.append(
            NominaConceptoDetalle(
                tipo="deduccion",
                concepto="Aporte FSP empleado",
                unidades=Decimal("1"),
                valor_unitario=Decimal(str(liq.aporte_fsp_empleado)),
                valor_total=Decimal(str(liq.aporte_fsp_empleado)),
            )
        )
    if Decimal(str(liq.aporte_subsistencia_empleado or 0)) > 0:
        deducciones.append(
            NominaConceptoDetalle(
                tipo="deduccion",
                concepto="Aporte subsistencia empleado",
                unidades=Decimal("1"),
                valor_unitario=Decimal(str(liq.aporte_subsistencia_empleado)),
                valor_total=Decimal(str(liq.aporte_subsistencia_empleado)),
            )
        )
    if Decimal(str(liq.retencion_fuente_empleado or 0)) > 0:
        deducciones.append(
            NominaConceptoDetalle(
                tipo="deduccion",
                concepto="Retención en la fuente",
                unidades=Decimal("1"),
                valor_unitario=Decimal(str(liq.retencion_fuente_empleado)),
                valor_total=Decimal(str(liq.retencion_fuente_empleado)),
            )
        )
    if Decimal(str(liq.auxilio_transporte_devengo or 0)) > 0:
        devengos.append(
            NominaConceptoDetalle(
                tipo="devengo",
                concepto="Auxilio de transporte",
                unidades=Decimal("1"),
                valor_unitario=Decimal(str(liq.auxilio_transporte_devengo)),
                valor_total=Decimal(str(liq.auxilio_transporte_devengo)),
            )
        )

    return NominaDesprendibleBaseResponse(
        tenant_id=liq.tenant_id,
        periodo_id=liq.periodo_id,
        liquidacion_id=liq.id,
        empleado_id=liq.empleado_id,
        empleado_nombre=f"{empleado.nombres} {empleado.apellidos}".strip(),
        empleado_documento=f"{empleado.documento_tipo} {empleado.documento_numero}",
        salario_base=Decimal(str(liq.salario_base)),
        total_devengos=Decimal(str(liq.total_devengos)),
        total_deducciones=Decimal(str(liq.total_deducciones)),
        neto_pagar=Decimal(str(liq.neto_pagar)),
        devengos=devengos,
        deducciones=deducciones,
    )


def _build_desprendible_payload(
    *,
    db: Session,
    current_user: Usuario,
    liquidacion_id: UUID,
) -> dict:
    liq = (
        db.query(NominaLiquidacion)
        .filter(
            NominaLiquidacion.id == liquidacion_id,
            NominaLiquidacion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada en este tenant.")

    empleado = (
        db.query(NominaEmpleado)
        .filter(
            NominaEmpleado.id == liq.empleado_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not empleado:
        raise HTTPException(status_code=404, detail="Empleado no encontrado para esta liquidación.")

    periodo = (
        db.query(NominaPeriodo)
        .filter(
            NominaPeriodo.id == liq.periodo_id,
            NominaPeriodo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado para esta liquidación.")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado.")

    novedades = (
        db.query(NominaNovedad)
        .filter(
            NominaNovedad.tenant_id == current_user.tenant_id,
            NominaNovedad.periodo_id == liq.periodo_id,
            NominaNovedad.empleado_id == liq.empleado_id,
        )
        .order_by(desc(NominaNovedad.created_at))
        .all()
    )

    devengos: list[dict] = []
    deducciones: list[dict] = []
    for n in novedades:
        row = {
            "tipo": n.tipo.value if hasattr(n.tipo, "value") else str(n.tipo),
            "concepto": n.concepto,
            "unidades": Decimal(str(n.unidades)),
            "valor_unitario": Decimal(str(n.valor_unitario)),
            "valor_total": Decimal(str(n.valor_total)),
        }
        if n.tipo == TipoNovedadNomina.DEVENGO:
            devengos.append(row)
        else:
            deducciones.append(row)

    if Decimal(str(liq.aporte_salud_empleado or 0)) > 0:
        deducciones.append(
            {
                "tipo": "deduccion",
                "concepto": "Aporte salud empleado (4%)",
                "unidades": Decimal("1"),
                "valor_unitario": Decimal(str(liq.aporte_salud_empleado)),
                "valor_total": Decimal(str(liq.aporte_salud_empleado)),
            }
        )
    if Decimal(str(liq.aporte_pension_empleado or 0)) > 0:
        deducciones.append(
            {
                "tipo": "deduccion",
                "concepto": "Aporte pensión empleado (4%)",
                "unidades": Decimal("1"),
                "valor_unitario": Decimal(str(liq.aporte_pension_empleado)),
                "valor_total": Decimal(str(liq.aporte_pension_empleado)),
            }
        )
    if Decimal(str(liq.aporte_fsp_empleado or 0)) > 0:
        deducciones.append(
            {
                "tipo": "deduccion",
                "concepto": "Aporte FSP empleado",
                "unidades": Decimal("1"),
                "valor_unitario": Decimal(str(liq.aporte_fsp_empleado)),
                "valor_total": Decimal(str(liq.aporte_fsp_empleado)),
            }
        )
    if Decimal(str(liq.aporte_subsistencia_empleado or 0)) > 0:
        deducciones.append(
            {
                "tipo": "deduccion",
                "concepto": "Aporte subsistencia empleado",
                "unidades": Decimal("1"),
                "valor_unitario": Decimal(str(liq.aporte_subsistencia_empleado)),
                "valor_total": Decimal(str(liq.aporte_subsistencia_empleado)),
            }
        )
    if Decimal(str(liq.retencion_fuente_empleado or 0)) > 0:
        deducciones.append(
            {
                "tipo": "deduccion",
                "concepto": "Retención en la fuente",
                "unidades": Decimal("1"),
                "valor_unitario": Decimal(str(liq.retencion_fuente_empleado)),
                "valor_total": Decimal(str(liq.retencion_fuente_empleado)),
            }
        )
    if Decimal(str(liq.auxilio_transporte_devengo or 0)) > 0:
        devengos.append(
            {
                "tipo": "devengo",
                "concepto": "Auxilio de transporte",
                "unidades": Decimal("1"),
                "valor_unitario": Decimal(str(liq.auxilio_transporte_devengo)),
                "valor_total": Decimal(str(liq.auxilio_transporte_devengo)),
            }
        )

    return {
        "liq": liq,
        "empleado": empleado,
        "periodo": periodo,
        "tenant": tenant,
        "devengos": devengos,
        "deducciones": deducciones,
    }


def _next_desprendible_folio(*, db: Session, tenant_id: UUID, anio: str, mes: str) -> str:
    prefix = f"NOM-{anio}{mes}-"
    existing = (
        db.query(NominaLiquidacion.desprendible_folio)
        .filter(
            NominaLiquidacion.tenant_id == tenant_id,
            NominaLiquidacion.desprendible_folio.like(f"{prefix}%"),
        )
        .all()
    )
    max_seq = 0
    for row in existing:
        folio = (row[0] or "").strip()
        if not folio.startswith(prefix):
            continue
        tail = folio.replace(prefix, "", 1)
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    return f"{prefix}{max_seq + 1:04d}"


def _obtener_o_generar_pdf_desprendible(
    *,
    db: Session,
    current_user: Usuario,
    liquidacion_id: UUID,
    force_regenerate: bool = False,
) -> tuple[bytes, str]:
    data = _build_desprendible_payload(db=db, current_user=current_user, liquidacion_id=liquidacion_id)
    liq = data["liq"]
    empleado = data["empleado"]
    periodo = data["periodo"]
    tenant = data["tenant"]

    if (not force_regenerate) and liq.desprendible_pdf_relpath:
        stored = leer_pdf_archivo_fiscal(liq.desprendible_pdf_relpath)
        if stored:
            existing_version = (
                db.query(NominaDesprendibleVersion)
                .filter(
                    NominaDesprendibleVersion.tenant_id == current_user.tenant_id,
                    NominaDesprendibleVersion.liquidacion_id == liq.id,
                    NominaDesprendibleVersion.version == int(liq.desprendible_version or 1),
                )
                .first()
            )
            if not existing_version and liq.desprendible_pdf_sha256 and liq.desprendible_pdf_relpath:
                version_row = NominaDesprendibleVersion(
                    tenant_id=current_user.tenant_id,
                    liquidacion_id=liq.id,
                    periodo_id=liq.periodo_id,
                    empleado_id=liq.empleado_id,
                    folio=liq.desprendible_folio,
                    version=int(liq.desprendible_version or 1),
                    pdf_relpath=liq.desprendible_pdf_relpath,
                    pdf_sha256=liq.desprendible_pdf_sha256,
                    generated_at=liq.desprendible_generated_at or datetime.now(timezone.utc),
                    generated_by=current_user.id,
                    motivo="backfill",
                )
                db.add(version_row)
                db.commit()
            folio = liq.desprendible_folio or "SN"
            return stored, folio

    periodo_label = f"{periodo.anio}-{periodo.mes}"
    pdf_buffer = build_nomina_desprendible_pdf(
        empleado_nombre=f"{empleado.nombres} {empleado.apellidos}".strip(),
        empleado_documento=f"{empleado.documento_tipo} {empleado.documento_numero}",
        periodo_label=periodo_label,
        salario_base=Decimal(str(liq.salario_base)),
        total_devengos=Decimal(str(liq.total_devengos)),
        total_deducciones=Decimal(str(liq.total_deducciones)),
        neto_pagar=Decimal(str(liq.neto_pagar)),
        devengos=data["devengos"],
        deducciones=data["deducciones"],
        tenant_logo_url=tenant.logo_url,
        nombre_comercial_cda=tenant.nombre_comercial,
    )
    pdf_bytes = pdf_buffer.getvalue()

    folio = liq.desprendible_folio or _next_desprendible_folio(
        db=db,
        tenant_id=current_user.tenant_id,
        anio=periodo.anio,
        mes=periodo.mes,
    )
    if force_regenerate:
        liq.desprendible_version = int(liq.desprendible_version or 1) + 1
    else:
        liq.desprendible_version = int(liq.desprendible_version or 1)
    storage_entity_id = uuid.uuid4() if force_regenerate else liq.id
    relpath, sha256_hex = guardar_pdf_archivo_fiscal(
        tenant_id=current_user.tenant_id,
        prefijo="nomina_desprendible",
        entity_id=storage_entity_id,
        pdf_bytes=pdf_bytes,
    )
    liq.desprendible_folio = folio
    liq.desprendible_pdf_relpath = relpath
    liq.desprendible_pdf_sha256 = sha256_hex
    liq.desprendible_generated_at = datetime.now(timezone.utc)
    liq.updated_by = current_user.id
    version_row = NominaDesprendibleVersion(
        tenant_id=current_user.tenant_id,
        liquidacion_id=liq.id,
        periodo_id=liq.periodo_id,
        empleado_id=liq.empleado_id,
        folio=folio,
        version=int(liq.desprendible_version or 1),
        pdf_relpath=relpath,
        pdf_sha256=sha256_hex,
        generated_at=liq.desprendible_generated_at,
        generated_by=current_user.id,
        motivo="reemision" if force_regenerate else "generacion",
    )
    db.add(version_row)
    db.commit()
    return pdf_bytes, folio


def _registrar_auditoria_nomina_reemision(
    *,
    db: Session,
    current_user: Usuario,
    request: Request | None,
    liquidacion: NominaLiquidacion,
) -> None:
    ip_address = None
    user_agent = None
    if request:
        forwarded = request.headers.get("X-Forwarded-For")
        ip_address = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
        user_agent = request.headers.get("User-Agent")
    log = AuditLog(
        action="nomina_reemit_desprendible",
        description=f"Reemisión controlada de desprendible nómina {liquidacion.id}",
        usuario_id=current_user.id,
        usuario_email=current_user.email,
        usuario_nombre=current_user.nombre_completo,
        usuario_rol=current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol),
        ip_address=ip_address,
        user_agent=user_agent,
        extra_data={
            "tenant_id": str(current_user.tenant_id),
            "liquidacion_id": str(liquidacion.id),
            "periodo_id": str(liquidacion.periodo_id),
            "empleado_id": str(liquidacion.empleado_id),
            "folio": liquidacion.desprendible_folio,
            "version": int(liquidacion.desprendible_version or 1),
        },
        success="success",
    )
    db.add(log)
    db.commit()


@router.get("/liquidaciones/{liquidacion_id}/desprendible.pdf")
def descargar_desprendible_pdf(
    liquidacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    data = _build_desprendible_payload(db=db, current_user=current_user, liquidacion_id=liquidacion_id)
    empleado = data["empleado"]
    periodo = data["periodo"]
    pdf_bytes, folio = _obtener_o_generar_pdf_desprendible(
        db=db,
        current_user=current_user,
        liquidacion_id=liquidacion_id,
    )

    safe_doc = f"{empleado.documento_numero}".replace(" ", "_")
    filename = f"Desprendible_{periodo.anio}-{periodo.mes}_{safe_doc}_{folio}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/periodos/{periodo_id}/desprendibles.zip")
def descargar_desprendibles_periodo_zip(
    periodo_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    periodo = (
        db.query(NominaPeriodo)
        .filter(
            NominaPeriodo.id == periodo_id,
            NominaPeriodo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not periodo:
        raise HTTPException(status_code=404, detail="Período no encontrado en este tenant.")

    liquidaciones = (
        db.query(NominaLiquidacion)
        .filter(
            NominaLiquidacion.tenant_id == current_user.tenant_id,
            NominaLiquidacion.periodo_id == periodo_id,
        )
        .order_by(desc(NominaLiquidacion.neto_pagar))
        .all()
    )
    if not liquidaciones:
        raise HTTPException(status_code=400, detail="No hay liquidaciones para este período.")

    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for liq in liquidaciones:
            data = _build_desprendible_payload(db=db, current_user=current_user, liquidacion_id=liq.id)
            empleado = data["empleado"]
            pdf_bytes, folio = _obtener_o_generar_pdf_desprendible(
                db=db,
                current_user=current_user,
                liquidacion_id=liq.id,
            )
            safe_doc = f"{empleado.documento_numero}".replace(" ", "_")
            name = f"Desprendible_{periodo.anio}-{periodo.mes}_{safe_doc}_{folio}.pdf"
            zf.writestr(name, pdf_bytes)

    zip_buffer.seek(0)
    zip_name = f"Desprendibles_{periodo.anio}-{periodo.mes}.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={zip_name}"},
    )


@router.get(
    "/liquidaciones/{liquidacion_id}/desprendible-meta",
    response_model=NominaDesprendibleMetaResponse,
)
def obtener_desprendible_meta(
    liquidacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    liq = (
        db.query(NominaLiquidacion)
        .filter(
            NominaLiquidacion.id == liquidacion_id,
            NominaLiquidacion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada en este tenant.")

    return NominaDesprendibleMetaResponse(
        liquidacion_id=liq.id,
        periodo_id=liq.periodo_id,
        empleado_id=liq.empleado_id,
        folio=liq.desprendible_folio,
        version=int(liq.desprendible_version or 1),
        pdf_relpath=liq.desprendible_pdf_relpath,
        pdf_sha256=liq.desprendible_pdf_sha256,
        generated_at=liq.desprendible_generated_at,
    )


@router.post("/liquidaciones/{liquidacion_id}/reemitir-desprendible")
def reemitir_desprendible_controlado(
    liquidacion_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    liq = (
        db.query(NominaLiquidacion)
        .filter(
            NominaLiquidacion.id == liquidacion_id,
            NominaLiquidacion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada en este tenant.")

    pdf_bytes, folio = _obtener_o_generar_pdf_desprendible(
        db=db,
        current_user=current_user,
        liquidacion_id=liquidacion_id,
        force_regenerate=True,
    )
    db.refresh(liq)
    _registrar_auditoria_nomina_reemision(
        db=db,
        current_user=current_user,
        request=request,
        liquidacion=liq,
    )

    return {
        "ok": True,
        "liquidacion_id": str(liq.id),
        "folio": folio,
        "version": int(liq.desprendible_version or 1),
        "pdf_sha256": liq.desprendible_pdf_sha256,
        "pdf_bytes": len(pdf_bytes),
    }


@router.get(
    "/liquidaciones/{liquidacion_id}/desprendibles/versiones",
    response_model=List[NominaDesprendibleVersionResponse],
)
def listar_versiones_desprendible(
    liquidacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    liq = (
        db.query(NominaLiquidacion.id)
        .filter(
            NominaLiquidacion.id == liquidacion_id,
            NominaLiquidacion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada en este tenant.")

    rows = (
        db.query(NominaDesprendibleVersion)
        .filter(
            NominaDesprendibleVersion.tenant_id == current_user.tenant_id,
            NominaDesprendibleVersion.liquidacion_id == liquidacion_id,
        )
        .order_by(desc(NominaDesprendibleVersion.version))
        .all()
    )
    return rows


@router.get("/liquidaciones/{liquidacion_id}/desprendibles/versiones/{version}/pdf")
def descargar_desprendible_version(
    liquidacion_id: UUID,
    version: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    if version < 1:
        raise HTTPException(status_code=400, detail="La versión debe ser >= 1.")

    version_row = (
        db.query(NominaDesprendibleVersion)
        .filter(
            NominaDesprendibleVersion.tenant_id == current_user.tenant_id,
            NominaDesprendibleVersion.liquidacion_id == liquidacion_id,
            NominaDesprendibleVersion.version == version,
        )
        .first()
    )
    if not version_row:
        raise HTTPException(status_code=404, detail="Versión de desprendible no encontrada.")

    pdf = leer_pdf_archivo_fiscal(version_row.pdf_relpath)
    if not pdf:
        raise HTTPException(status_code=404, detail="El archivo PDF de esta versión no existe en almacenamiento.")

    empleado = (
        db.query(NominaEmpleado)
        .filter(
            NominaEmpleado.id == version_row.empleado_id,
            NominaEmpleado.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    safe_doc = (empleado.documento_numero if empleado else "empleado").replace(" ", "_")
    filename = f"Desprendible_v{version:02d}_{safe_doc}.pdf"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
