"""API obligaciones / facturas de compra por pagar."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_contador_or_admin, get_db
from app.core.sucursal_scope import assert_sucursal_in_tenant
from app.models.obligacion_proveedor import ObligacionProveedor, ObligacionProveedorPago
from app.models.proveedor_catalogo import ProveedorCatalogo
from app.models.usuario import Usuario
from app.schemas.obligacion_proveedor import (
    ObligacionPagoCreate,
    ObligacionPagoResponse,
    ObligacionProveedorCreate,
    ObligacionProveedorResponse,
    ObligacionProveedorUpdate,
    ObligacionesListResponse,
)

router = APIRouter()


def _tramo_vencimiento(fecha_vencimiento: Optional[date], saldo: Decimal, estado: str) -> tuple[int, str]:
    if estado in ("pagada", "anulada") or saldo <= 0:
        return 0, "al_dia"
    if not fecha_vencimiento:
        return 0, "sin_vencimiento"
    hoy = date.today()
    dias = (hoy - fecha_vencimiento).days
    if dias > 0:
        return dias, "vencida"
    if dias >= -30:
        return 0, "por_vencer_30"
    return 0, "al_dia"


def _to_response(row: ObligacionProveedor) -> ObligacionProveedorResponse:
    saldo = Decimal(str(row.saldo_pendiente or 0))
    dias, tramo = _tramo_vencimiento(row.fecha_vencimiento, saldo, row.estado or "abierta")
    return ObligacionProveedorResponse(
        id=row.id,
        sucursal_id=row.sucursal_id,
        proveedor_catalogo_id=row.proveedor_catalogo_id,
        proveedor_nombre=row.proveedor_nombre,
        proveedor_documento=row.proveedor_documento,
        proveedor_tipo_documento=row.proveedor_tipo_documento,
        numero_documento=row.numero_documento,
        fecha_emision=row.fecha_emision,
        fecha_vencimiento=row.fecha_vencimiento,
        concepto=row.concepto,
        notas=row.notas,
        valor_total=Decimal(str(row.valor_total or 0)),
        saldo_pendiente=saldo,
        estado=row.estado,
        created_at=row.created_at,
        updated_at=row.updated_at,
        dias_vencida=max(dias, 0),
        tramo_vencimiento=tramo,
    )


@router.get("", response_model=ObligacionesListResponse)
def listar_obligaciones(
    estado: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    solo_pendientes: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    query = db.query(ObligacionProveedor).filter(
        ObligacionProveedor.tenant_id == current_user.tenant_id
    )
    if estado:
        query = query.filter(ObligacionProveedor.estado == estado.strip().lower())
    if solo_pendientes:
        query = query.filter(
            ObligacionProveedor.estado.in_(["abierta", "parcial"]),
            ObligacionProveedor.saldo_pendiente > 0,
        )
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        from sqlalchemy import or_, func

        query = query.filter(
            or_(
                func.lower(ObligacionProveedor.proveedor_nombre).like(term),
                func.lower(ObligacionProveedor.proveedor_documento).like(term),
                func.lower(ObligacionProveedor.numero_documento).like(term),
                func.lower(ObligacionProveedor.concepto).like(term),
            )
        )
    rows = query.order_by(ObligacionProveedor.fecha_emision.desc()).limit(limit).all()
    items = [_to_response(r) for r in rows]

    saldo_abierto = sum(
        (i.saldo_pendiente for i in items if i.estado in ("abierta", "parcial")),
        Decimal("0"),
    )
    vencidas = [i for i in items if i.tramo_vencimiento == "vencida"]
    return ObligacionesListResponse(
        resumen={
            "total_items": len(items),
            "saldo_pendiente_total": saldo_abierto.quantize(Decimal("0.01")),
            "vencidas_count": len(vencidas),
            "vencidas_saldo": sum((i.saldo_pendiente for i in vencidas), Decimal("0")).quantize(
                Decimal("0.01")
            ),
            "abiertas": sum(1 for i in items if i.estado == "abierta"),
            "parciales": sum(1 for i in items if i.estado == "parcial"),
            "pagadas": sum(1 for i in items if i.estado == "pagada"),
        },
        items=items,
    )


@router.post("", response_model=ObligacionProveedorResponse, status_code=status.HTTP_201_CREATED)
def crear_obligacion(
    payload: ObligacionProveedorCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    tid = current_user.tenant_id
    nombre = payload.proveedor_nombre
    documento = payload.proveedor_documento
    tipo_doc = payload.proveedor_tipo_documento
    catalogo_id = payload.proveedor_catalogo_id

    if catalogo_id:
        prov = (
            db.query(ProveedorCatalogo)
            .filter(ProveedorCatalogo.id == catalogo_id, ProveedorCatalogo.tenant_id == tid)
            .first()
        )
        if not prov:
            raise HTTPException(status_code=404, detail="Proveedor de catálogo no encontrado.")
        nombre = prov.razon_social_rut
        documento = prov.numero_identificacion
        tipo_doc = prov.tipo_identificacion

    if payload.sucursal_id:
        assert_sucursal_in_tenant(db, payload.sucursal_id, tid)

    valor = Decimal(str(payload.valor_total)).quantize(Decimal("0.01"))
    row = ObligacionProveedor(
        tenant_id=tid,
        sucursal_id=payload.sucursal_id,
        proveedor_catalogo_id=catalogo_id,
        proveedor_nombre=nombre,
        proveedor_documento=documento,
        proveedor_tipo_documento=tipo_doc,
        numero_documento=payload.numero_documento,
        fecha_emision=payload.fecha_emision,
        fecha_vencimiento=payload.fecha_vencimiento,
        concepto=payload.concepto,
        notas=payload.notas,
        valor_total=valor,
        saldo_pendiente=valor,
        estado="abierta",
        created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.patch("/{obligacion_id}", response_model=ObligacionProveedorResponse)
def actualizar_obligacion(
    obligacion_id: UUID,
    payload: ObligacionProveedorUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    row = (
        db.query(ObligacionProveedor)
        .filter(
            ObligacionProveedor.id == obligacion_id,
            ObligacionProveedor.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Obligación no encontrada.")

    data = payload.model_dump(exclude_unset=True)
    if "sucursal_id" in data and data["sucursal_id"]:
        assert_sucursal_in_tenant(db, data["sucursal_id"], current_user.tenant_id)

    if "valor_total" in data and data["valor_total"] is not None:
        nuevo_total = Decimal(str(data["valor_total"])).quantize(Decimal("0.01"))
        pagado = Decimal(str(row.valor_total or 0)) - Decimal(str(row.saldo_pendiente or 0))
        if nuevo_total < pagado:
            raise HTTPException(
                status_code=400,
                detail="El valor total no puede ser menor a lo ya abonado.",
            )
        row.valor_total = nuevo_total
        row.saldo_pendiente = (nuevo_total - pagado).quantize(Decimal("0.01"))
        data.pop("valor_total")

    for k, v in data.items():
        if k == "estado" and v == "anulada":
            row.estado = "anulada"
            continue
        if hasattr(row, k) and k != "estado":
            setattr(row, k, v)

    if row.estado != "anulada":
        row.recalcular_estado()
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.post("/{obligacion_id}/pagos", response_model=ObligacionProveedorResponse)
def registrar_pago_obligacion(
    obligacion_id: UUID,
    payload: ObligacionPagoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    row = (
        db.query(ObligacionProveedor)
        .filter(
            ObligacionProveedor.id == obligacion_id,
            ObligacionProveedor.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Obligación no encontrada.")
    if row.estado == "anulada":
        raise HTTPException(status_code=400, detail="La obligación está anulada.")
    if row.estado == "pagada" or Decimal(str(row.saldo_pendiente or 0)) <= 0:
        raise HTTPException(status_code=400, detail="La obligación ya está pagada.")

    monto = Decimal(str(payload.monto)).quantize(Decimal("0.01"))
    saldo = Decimal(str(row.saldo_pendiente or 0))
    if monto > saldo:
        raise HTTPException(status_code=400, detail="El pago supera el saldo pendiente.")

    pago = ObligacionProveedorPago(
        tenant_id=current_user.tenant_id,
        obligacion_id=row.id,
        monto=monto,
        fecha_pago=payload.fecha_pago or date.today(),
        notas=payload.notas,
        movimiento_tesoreria_id=payload.movimiento_tesoreria_id,
        created_by=current_user.id,
    )
    db.add(pago)
    row.saldo_pendiente = (saldo - monto).quantize(Decimal("0.01"))
    row.recalcular_estado()
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.get("/{obligacion_id}/pagos", response_model=list[ObligacionPagoResponse])
def listar_pagos_obligacion(
    obligacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    row = (
        db.query(ObligacionProveedor)
        .filter(
            ObligacionProveedor.id == obligacion_id,
            ObligacionProveedor.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Obligación no encontrada.")
    pagos = (
        db.query(ObligacionProveedorPago)
        .filter(
            ObligacionProveedorPago.obligacion_id == obligacion_id,
            ObligacionProveedorPago.tenant_id == current_user.tenant_id,
        )
        .order_by(ObligacionProveedorPago.fecha_pago.desc())
        .all()
    )
    return pagos
