"""Tarifa y comisión SOAT: catálogo del NIT + override opcional por sede."""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.tarifa import ComisionSOAT, Tarifa


def _fecha(hoy: Optional[date]) -> date:
    return hoy or date.today()


def _buscar_tarifa(
    db: Session,
    *,
    tenant_id,
    tipo_vehiculo: str,
    antiguedad: int,
    sucursal_id: Optional[UUID],
    fecha: date,
) -> Tarifa | None:
    q = db.query(Tarifa).filter(
        and_(
            Tarifa.activa.is_(True),
            Tarifa.tenant_id == tenant_id,
            Tarifa.tipo_vehiculo == tipo_vehiculo,
            Tarifa.vigencia_inicio <= fecha,
            Tarifa.vigencia_fin >= fecha,
            Tarifa.antiguedad_min <= antiguedad,
            (Tarifa.antiguedad_max >= antiguedad) | (Tarifa.antiguedad_max.is_(None)),
        )
    )
    if sucursal_id is None:
        q = q.filter(Tarifa.sucursal_id.is_(None))
    else:
        q = q.filter(Tarifa.sucursal_id == sucursal_id)
    return q.order_by(Tarifa.antiguedad_min.desc(), Tarifa.created_at.desc()).first()


def resolver_tarifa_vigente(
    db: Session,
    *,
    tenant_id,
    tipo_vehiculo: str,
    ano_modelo: int,
    sucursal_id: Optional[UUID] = None,
    fecha: Optional[date] = None,
    ano_referencia: Optional[int] = None,
) -> Tarifa | None:
    fecha_ref = _fecha(fecha)
    ano_ref = ano_referencia if ano_referencia is not None else fecha_ref.year
    antiguedad = max(0, ano_ref - int(ano_modelo or ano_ref))

    def _pick(ant: int) -> Tarifa | None:
        if sucursal_id is not None:
            override = _buscar_tarifa(
                db,
                tenant_id=tenant_id,
                tipo_vehiculo=tipo_vehiculo,
                antiguedad=ant,
                sucursal_id=sucursal_id,
                fecha=fecha_ref,
            )
            if override is not None:
                return override
        return _buscar_tarifa(
            db,
            tenant_id=tenant_id,
            tipo_vehiculo=tipo_vehiculo,
            antiguedad=ant,
            sucursal_id=None,
            fecha=fecha_ref,
        )

    tarifa = _pick(antiguedad)
    if tarifa is None and antiguedad == 0:
        tarifa = _pick(1)
    return tarifa


def resolver_comision_soat(
    db: Session,
    *,
    tenant_id,
    tipo_vehiculo: str,
    sucursal_id: Optional[UUID] = None,
    fecha: Optional[date] = None,
) -> ComisionSOAT | None:
    fecha_ref = _fecha(fecha)

    def _buscar(sid: Optional[UUID]) -> ComisionSOAT | None:
        q = db.query(ComisionSOAT).filter(
            and_(
                ComisionSOAT.tipo_vehiculo == tipo_vehiculo,
                ComisionSOAT.tenant_id == tenant_id,
                ComisionSOAT.activa.is_(True),
                ComisionSOAT.vigencia_inicio <= fecha_ref,
                (ComisionSOAT.vigencia_fin >= fecha_ref) | (ComisionSOAT.vigencia_fin.is_(None)),
            )
        )
        if sid is None:
            q = q.filter(ComisionSOAT.sucursal_id.is_(None))
        else:
            q = q.filter(ComisionSOAT.sucursal_id == sid)
        return q.order_by(ComisionSOAT.created_at.desc()).first()

    if sucursal_id is not None:
        override = _buscar(sucursal_id)
        if override is not None:
            return override
    return _buscar(None)
