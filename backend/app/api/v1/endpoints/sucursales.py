"""
Sedes (sucursales) del tenant.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user, get_admin
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.schemas.sucursal import SucursalCreate, SucursalOut, SucursalUpdate

router = APIRouter()


@router.get("", response_model=list[SucursalOut])
def listar_sucursales(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    return (
        db.query(Sucursal)
        .filter(Sucursal.tenant_id == current_user.tenant_id)
        .order_by(Sucursal.es_principal.desc(), Sucursal.nombre.asc())
        .all()
    )


@router.post("", response_model=SucursalOut, status_code=status.HTTP_201_CREATED)
def crear_sucursal(
    body: SucursalCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    existing = (
        db.query(Sucursal).filter(Sucursal.tenant_id == current_user.tenant_id).count()
    )
    if tenant and tenant.sedes_totales is not None and existing >= int(tenant.sedes_totales):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Has alcanzado el número máximo de sedes incluidas en tu plan "
                f"({tenant.sedes_totales}). Contacta soporte si necesitas ampliar."
            ),
        )
    es_principal = body.es_principal or existing == 0
    if es_principal:
        db.query(Sucursal).filter(
            Sucursal.tenant_id == current_user.tenant_id,
            Sucursal.es_principal.is_(True),
        ).update({Sucursal.es_principal: False})

    dir_sede = (body.direccion.strip() if body.direccion else None) or None
    ciudad_sede = (body.ciudad.strip() if body.ciudad else None) or None
    row = Sucursal(
        tenant_id=current_user.tenant_id,
        nombre=body.nombre.strip(),
        codigo=(body.codigo.strip() if body.codigo else None) or None,
        activa=body.activa,
        es_principal=es_principal,
        factus_municipality_id=body.factus_municipality_id,
        factus_numbering_range_id=body.factus_numbering_range_id,
        direccion=dir_sede,
        ciudad=ciudad_sede,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{sucursal_id}", response_model=SucursalOut)
def actualizar_sucursal(
    sucursal_id: UUID,
    body: SucursalUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    row = (
        db.query(Sucursal)
        .filter(Sucursal.id == sucursal_id, Sucursal.tenant_id == current_user.tenant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sede no encontrada")

    data = body.model_dump(exclude_unset=True)
    if "nombre" in data and data["nombre"] is not None:
        row.nombre = data["nombre"].strip()
    if "codigo" in data:
        if data["codigo"] is None:
            row.codigo = None
        else:
            row.codigo = data["codigo"].strip() or None
    if "activa" in data and data["activa"] is not None:
        row.activa = data["activa"]
    if data.get("es_principal") is True:
        db.query(Sucursal).filter(
            Sucursal.tenant_id == current_user.tenant_id,
            Sucursal.id != row.id,
        ).update({Sucursal.es_principal: False})
        row.es_principal = True
    elif data.get("es_principal") is False:
        if row.es_principal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Marque otra sede como principal antes de quitar la principal",
            )
        row.es_principal = False
    if "factus_municipality_id" in data:
        row.factus_municipality_id = data["factus_municipality_id"]
    if "factus_numbering_range_id" in data:
        rid = data["factus_numbering_range_id"]
        if rid is not None and int(rid) < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="factus_numbering_range_id debe ser un entero ≥ 1 o null.",
            )
        row.factus_numbering_range_id = rid
    if "direccion" in data:
        d = data["direccion"]
        if d is None:
            row.direccion = None
        else:
            row.direccion = d.strip() or None
    if "ciudad" in data:
        c = data["ciudad"]
        if c is None:
            row.ciudad = None
        else:
            row.ciudad = c.strip() or None

    db.commit()
    db.refresh(row)
    return row
