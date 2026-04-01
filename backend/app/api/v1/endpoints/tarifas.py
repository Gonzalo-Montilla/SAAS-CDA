"""
Endpoints de Tarifas
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import date
from typing import List, Optional

from app.core.deps import get_db, get_current_user, get_admin
from app.models.usuario import Usuario
from app.models.tarifa import Tarifa, ComisionSOAT
from app.schemas.tarifa import (
    TarifaCreate,
    TarifaUpdate,
    TarifaResponse,
    TarifasPorAno,
    ComisionSOATCreate,
    ComisionSOATUpdate,
    ComisionSOATResponse
)

router = APIRouter()


def _ranges_overlap(min_a: int, max_a: Optional[int], min_b: int, max_b: Optional[int]) -> bool:
    upper_a = float("inf") if max_a is None else max_a
    upper_b = float("inf") if max_b is None else max_b
    return min_a <= upper_b and min_b <= upper_a


def _dates_overlap(start_a: date, end_a: date, start_b: date, end_b: date) -> bool:
    return start_a <= end_b and start_b <= end_a


@router.get("/vigentes", response_model=List[TarifaResponse])
def obtener_tarifas_vigentes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener tarifas vigentes hoy
    """
    hoy = date.today()
    tarifas = db.query(Tarifa).filter(
        and_(
            Tarifa.activa == True,
            Tarifa.tenant_id == current_user.tenant_id,
            Tarifa.vigencia_inicio <= hoy,
            Tarifa.vigencia_fin >= hoy
        )
    ).order_by(Tarifa.tipo_vehiculo, Tarifa.antiguedad_min).all()
    
    return tarifas


@router.get("/por-ano/{ano}", response_model=TarifasPorAno)
def obtener_tarifas_por_ano(
    ano: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener tarifas de un año específico
    """
    tarifas = db.query(Tarifa).filter(
        Tarifa.ano_vigencia == ano,
        Tarifa.tenant_id == current_user.tenant_id
    ).order_by(Tarifa.tipo_vehiculo, Tarifa.antiguedad_min).all()
    
    return TarifasPorAno(
        ano=ano,
        tarifas=tarifas
    )


@router.post("/", response_model=TarifaResponse, status_code=status.HTTP_201_CREATED)
def crear_tarifa(
    tarifa_data: TarifaCreate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)
):
    if tarifa_data.antiguedad_max is not None and tarifa_data.antiguedad_max < tarifa_data.antiguedad_min:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La antigüedad máxima no puede ser menor a la antigüedad mínima.",
        )

    expected_total = tarifa_data.valor_rtm + tarifa_data.valor_terceros
    if tarifa_data.valor_total != expected_total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Inconsistencia en valores de tarifa: el valor total debe ser igual a "
                f"valor_rtm + valor_terceros ({expected_total})."
            ),
        )

    """
    Crear nueva tarifa (solo administrador)
    """
    # Verificar conflictos de vigencia + antigüedad en el mismo tenant/tipo/año.
    candidatas = db.query(Tarifa).filter(
        and_(
            Tarifa.ano_vigencia == tarifa_data.ano_vigencia,
            Tarifa.tenant_id == admin.tenant_id,
            Tarifa.tipo_vehiculo == tarifa_data.tipo_vehiculo,
            Tarifa.activa == True
        )
    ).all()

    conflicto = next(
        (
            tarifa
            for tarifa in candidatas
            if _dates_overlap(
                tarifa.vigencia_inicio,
                tarifa.vigencia_fin,
                tarifa_data.vigencia_inicio,
                tarifa_data.vigencia_fin,
            )
            and _ranges_overlap(
                tarifa.antiguedad_min,
                tarifa.antiguedad_max,
                tarifa_data.antiguedad_min,
                tarifa_data.antiguedad_max,
            )
        ),
        None,
    )

    if conflicto:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Ya existe una tarifa activa con vigencia y rango de antigüedad solapados para este tipo de vehículo "
                f"(rango existente: {conflicto.antiguedad_min}-{conflicto.antiguedad_max or '∞'} años)."
            ),
        )
    
    nueva_tarifa = Tarifa(
        tenant_id=admin.tenant_id,
        ano_vigencia=tarifa_data.ano_vigencia,
        vigencia_inicio=tarifa_data.vigencia_inicio,
        vigencia_fin=tarifa_data.vigencia_fin,
        tipo_vehiculo=tarifa_data.tipo_vehiculo,
        antiguedad_min=tarifa_data.antiguedad_min,
        antiguedad_max=tarifa_data.antiguedad_max,
        valor_rtm=tarifa_data.valor_rtm,
        valor_terceros=tarifa_data.valor_terceros,
        valor_total=tarifa_data.valor_total,
        activa=True,
        created_by=admin.id
    )
    
    db.add(nueva_tarifa)
    db.commit()
    db.refresh(nueva_tarifa)
    
    return nueva_tarifa


@router.put("/{tarifa_id}", response_model=TarifaResponse)
def actualizar_tarifa(
    tarifa_id: str,
    tarifa_data: TarifaUpdate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)
):
    """
    Actualizar tarifa existente (solo administrador)
    """
    tarifa = db.query(Tarifa).filter(
        Tarifa.id == tarifa_id,
        Tarifa.tenant_id == admin.tenant_id
    ).first()
    
    if not tarifa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tarifa no encontrada"
        )
    
    # Calcular valores efectivos después del update para mantener coherencia.
    valor_rtm_efectivo = tarifa_data.valor_rtm if tarifa_data.valor_rtm is not None else tarifa.valor_rtm
    valor_terceros_efectivo = (
        tarifa_data.valor_terceros if tarifa_data.valor_terceros is not None else tarifa.valor_terceros
    )
    total_calculado = valor_rtm_efectivo + valor_terceros_efectivo

    if tarifa_data.valor_total is not None and tarifa_data.valor_total != total_calculado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Inconsistencia en actualización: el valor total debe ser igual a "
                f"valor_rtm + valor_terceros ({total_calculado})."
            ),
        )

    # Actualizar campos base y normalizar total.
    tarifa.valor_rtm = valor_rtm_efectivo
    tarifa.valor_terceros = valor_terceros_efectivo
    tarifa.valor_total = total_calculado
    if tarifa_data.activa is not None:
        tarifa.activa = tarifa_data.activa
    
    db.commit()
    db.refresh(tarifa)
    
    return tarifa


@router.get("/comisiones-soat", response_model=List[ComisionSOATResponse])
def obtener_comisiones_soat(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener comisiones SOAT vigentes
    """
    hoy = date.today()
    comisiones = db.query(ComisionSOAT).filter(
        and_(
            ComisionSOAT.activa == True,
            ComisionSOAT.tenant_id == current_user.tenant_id,
            ComisionSOAT.vigencia_inicio <= hoy,
            (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
        )
    ).all()
    
    return comisiones


@router.post("/comisiones-soat", response_model=ComisionSOATResponse, status_code=status.HTTP_201_CREATED)
def crear_comision_soat(
    comision_data: ComisionSOATCreate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)
):
    """
    Crear nueva comisión SOAT (solo administrador)
    """
    nueva_comision = ComisionSOAT(
        tenant_id=admin.tenant_id,
        tipo_vehiculo=comision_data.tipo_vehiculo,
        valor_comision=comision_data.valor_comision,
        vigencia_inicio=comision_data.vigencia_inicio,
        vigencia_fin=comision_data.vigencia_fin,
        activa=True,
        created_by=admin.id
    )
    
    db.add(nueva_comision)
    db.commit()
    db.refresh(nueva_comision)
    
    return nueva_comision


@router.put("/comisiones-soat/{comision_id}", response_model=ComisionSOATResponse)
def actualizar_comision_soat(
    comision_id: str,
    comision_data: ComisionSOATUpdate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)
):
    """
    Actualizar comisión SOAT existente (solo administrador)
    """
    comision = db.query(ComisionSOAT).filter(
        ComisionSOAT.id == comision_id,
        ComisionSOAT.tenant_id == admin.tenant_id
    ).first()
    
    if not comision:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comisión no encontrada"
        )
    
    # Actualizar campos
    if comision_data.tipo_vehiculo is not None:
        comision.tipo_vehiculo = comision_data.tipo_vehiculo
    if comision_data.valor_comision is not None:
        comision.valor_comision = comision_data.valor_comision
    if comision_data.vigencia_inicio is not None:
        comision.vigencia_inicio = comision_data.vigencia_inicio
    if comision_data.vigencia_fin is not None:
        comision.vigencia_fin = comision_data.vigencia_fin
    if comision_data.activa is not None:
        comision.activa = comision_data.activa
    
    db.commit()
    db.refresh(comision)
    
    return comision


@router.delete("/comisiones-soat/{comision_id}")
def eliminar_comision_soat(
    comision_id: str,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)
):
    """
    Eliminar comisión SOAT (solo administrador)
    """
    comision = db.query(ComisionSOAT).filter(
        ComisionSOAT.id == comision_id,
        ComisionSOAT.tenant_id == admin.tenant_id
    ).first()
    
    if not comision:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comisión no encontrada"
        )
    
    db.delete(comision)
    db.commit()
    
    return {"message": "Comisión eliminada exitosamente"}


@router.get("/", response_model=List[TarifaResponse])
def listar_todas_tarifas(
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)
):
    """
    Listar todas las tarifas (solo administrador)
    """
    tarifas = db.query(Tarifa).filter(
        Tarifa.tenant_id == admin.tenant_id
    ).order_by(
        Tarifa.ano_vigencia.desc(),
        Tarifa.tipo_vehiculo,
        Tarifa.antiguedad_min
    ).all()
    
    return tarifas
