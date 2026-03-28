"""
Endpoints de Tarifas
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import date
from typing import List

from app.core.deps import get_db, get_current_user, get_admin
from app.models.usuario import Usuario
from app.models.tarifa import Tarifa, ComisionSOAT
from app.schemas.tarifa import (
    TarifaCreate,
    TarifaUpdate,
    TarifaResponse,
    TarifasPorAno,
    ComisionSOATCreate,
    ComisionSOATResponse
)

router = APIRouter()


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
    """
    Crear nueva tarifa (solo administrador)
    """
    # Verificar que no exista conflicto de vigencias
    conflicto = db.query(Tarifa).filter(
        and_(
            Tarifa.ano_vigencia == tarifa_data.ano_vigencia,
            Tarifa.tenant_id == admin.tenant_id,
            Tarifa.tipo_vehiculo == tarifa_data.tipo_vehiculo,
            Tarifa.antiguedad_min == tarifa_data.antiguedad_min,
            Tarifa.activa == True
        )
    ).first()
    
    if conflicto:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe una tarifa para {tarifa_data.ano_vigencia} tipo '{tarifa_data.tipo_vehiculo}' con antigüedad {tarifa_data.antiguedad_min}"
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
    
    # Actualizar campos
    if tarifa_data.valor_rtm is not None:
        tarifa.valor_rtm = tarifa_data.valor_rtm
    if tarifa_data.valor_terceros is not None:
        tarifa.valor_terceros = tarifa_data.valor_terceros
    if tarifa_data.valor_total is not None:
        tarifa.valor_total = tarifa_data.valor_total
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
    comision_data: ComisionSOATCreate,
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
    if hasattr(comision_data, 'valor_comision') and comision_data.valor_comision is not None:
        comision.valor_comision = comision_data.valor_comision
    if hasattr(comision_data, 'activa') and comision_data.activa is not None:
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
