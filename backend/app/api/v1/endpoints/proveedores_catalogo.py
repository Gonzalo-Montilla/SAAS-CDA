"""CRUD catálogo de proveedores (datos documento soporte)."""
from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_admin, get_cajero_or_admin, get_db
from app.models.proveedor_catalogo import ProveedorCatalogo
from app.models.usuario import Usuario
from app.schemas.proveedor_catalogo import (
    ProveedorCatalogoCreate,
    ProveedorCatalogoResponse,
    ProveedorCatalogoUpdate,
    validar_tipo_identificacion_proveedor,
)
from app.utils.egreso_proveedor_dian import normalizar_y_validar_contacto_proveedor_documento_soporte
from app.integrations.factus_support_emit import validar_identificacion_proveedor_catalogo_documento_soporte

router = APIRouter()


@router.get("", response_model=List[ProveedorCatalogoResponse])
def listar_proveedores_catalogo(
    solo_activos: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
):
    q = db.query(ProveedorCatalogo).filter(ProveedorCatalogo.tenant_id == current_user.tenant_id)
    if solo_activos:
        q = q.filter(ProveedorCatalogo.activo.is_(True))
    return q.order_by(ProveedorCatalogo.razon_social_rut.asc()).all()


@router.get("/{proveedor_id}", response_model=ProveedorCatalogoResponse)
def obtener_proveedor_catalogo(
    proveedor_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
):
    p = (
        db.query(ProveedorCatalogo)
        .filter(
            ProveedorCatalogo.id == proveedor_id,
            ProveedorCatalogo.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")
    return p


@router.post("", response_model=ProveedorCatalogoResponse, status_code=status.HTTP_201_CREATED)
def crear_proveedor_catalogo(
    body: ProveedorCatalogoCreate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    try:
        tid = validar_tipo_identificacion_proveedor(body.tipo_identificacion)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    try:
        addr, mail, phone, mid = normalizar_y_validar_contacto_proveedor_documento_soporte(
            direccion=body.direccion,
            email=body.email,
            telefono=body.telefono,
            factus_municipality_id=body.factus_municipality_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    row = ProveedorCatalogo(
        tenant_id=admin.tenant_id,
        alias=(body.alias or "").strip()[:120] or None,
        razon_social_rut=(body.razon_social_rut or "").strip()[:300],
        tipo_identificacion=tid,
        numero_identificacion=(body.numero_identificacion or "").strip()[:80],
        direccion=addr,
        email=mail,
        telefono=phone,
        factus_municipality_id=mid,
        activo=body.activo,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{proveedor_id}", response_model=ProveedorCatalogoResponse)
def actualizar_proveedor_catalogo(
    proveedor_id: UUID,
    body: ProveedorCatalogoUpdate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    p = (
        db.query(ProveedorCatalogo)
        .filter(
            ProveedorCatalogo.id == proveedor_id,
            ProveedorCatalogo.tenant_id == admin.tenant_id,
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    data = body.model_dump(exclude_unset=True)
    if "tipo_identificacion" in data and data["tipo_identificacion"] is not None:
        try:
            data["tipo_identificacion"] = validar_tipo_identificacion_proveedor(data["tipo_identificacion"])
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    for k, v in data.items():
        setattr(p, k, v)

    try:
        addr, mail, phone, mid = normalizar_y_validar_contacto_proveedor_documento_soporte(
            direccion=p.direccion,
            email=p.email,
            telefono=p.telefono,
            factus_municipality_id=p.factus_municipality_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    p.direccion = addr
    p.email = mail
    p.telefono = phone
    p.factus_municipality_id = mid

    if p.alias is not None:
        a = (p.alias or "").strip()[:120]
        p.alias = a or None

    try:
        validar_identificacion_proveedor_catalogo_documento_soporte(
            p.tipo_identificacion,
            (p.numero_identificacion or "").strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    db.commit()
    db.refresh(p)
    return p
