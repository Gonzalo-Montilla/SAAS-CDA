"""CRUD catálogo de proveedores (datos documento soporte)."""
from __future__ import annotations

import uuid
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_admin, get_cajero_or_admin, get_db
from app.models.proveedor_catalogo import ProveedorCatalogo
from app.models.usuario import Usuario
from app.schemas.proveedor_catalogo import (
    ProveedorCatalogoCreate,
    ProveedorCatalogoResponse,
    ProveedorCatalogoUpdate,
    validar_tipo_identificacion_proveedor,
)
from app.services.proveedor_catalogo import (
    eliminar_archivo_rut_pdf_si_existe,
    proveedores_rut_abs_path,
    proveedores_rut_storage_root,
)
from app.utils.egreso_proveedor_dian import normalizar_y_validar_contacto_proveedor_documento_soporte
from app.utils.factus_validators import normalizar_numero_identificacion_proveedor
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


@router.post(
    "/{proveedor_id}/documento-rut",
    response_model=ProveedorCatalogoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def subir_documento_rut_proveedor(
    proveedor_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    """
    PDF de certificación RUT (DIAN). No usar cédula escaneada.
    """
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

    content = await file.read()
    max_bytes = settings.PROVEEDORES_RUT_MAX_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El archivo supera el límite de {settings.PROVEEDORES_RUT_MAX_MB} MB.",
        )
    if len(content) < 8 or not content.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se admite un archivo PDF válido (certificación RUT).",
        )

    root = proveedores_rut_storage_root()
    tenant_dir = root / str(admin.tenant_id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}.pdf"
    dest = tenant_dir / fname
    dest.write_bytes(content)
    rel = f"{admin.tenant_id}/{fname}"

    eliminar_archivo_rut_pdf_si_existe(p.rut_pdf_relpath)

    # Persistencia por ORM (misma sesión que `p`): evita desincronía con Core update + refresh.
    p.rut_pdf_relpath = rel
    db.add(p)
    db.commit()
    db.refresh(p)
    if not (p.rut_pdf_relpath or "").strip():
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El PDF se guardó en disco pero no quedó la ruta en base de datos (columna rut_pdf_relpath). Ejecute migraciones / reinicie el backend.",
        )
    return p


@router.get("/{proveedor_id}/documento-rut")
def descargar_documento_rut_proveedor(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado en su sede/tenant.",
        )
    if not (p.rut_pdf_relpath or "").strip():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay PDF de RUT adjunto para este proveedor.",
        )
    path = proveedores_rut_abs_path(p.rut_pdf_relpath)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El archivo ya no está en el servidor.",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        filename="rut-proveedor.pdf",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@router.delete("/{proveedor_id}/documento-rut", response_model=ProveedorCatalogoResponse)
def borrar_documento_rut_proveedor(
    proveedor_id: UUID,
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
    eliminar_archivo_rut_pdf_si_existe(p.rut_pdf_relpath)
    p.rut_pdf_relpath = None
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


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

    num_norm = normalizar_numero_identificacion_proveedor(body.numero_identificacion)[:80]
    try:
        validar_identificacion_proveedor_catalogo_documento_soporte(tid, num_norm)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    row = ProveedorCatalogo(
        tenant_id=admin.tenant_id,
        alias=(body.alias or "").strip()[:120] or None,
        razon_social_rut=(body.razon_social_rut or "").strip()[:300],
        tipo_identificacion=tid,
        numero_identificacion=num_norm,
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
    if "numero_identificacion" in data and data["numero_identificacion"] is not None:
        data["numero_identificacion"] = normalizar_numero_identificacion_proveedor(data["numero_identificacion"])[:80]

    # Solo columnas permitidas; no tocar rut_pdf_relpath / id / tenant_id / timestamps.
    # Si el cliente envía null en opcionales que en BD son NOT NULL, setattr(..., None) rompe el commit (500).
    _patch_keys = {
        "alias",
        "razon_social_rut",
        "tipo_identificacion",
        "numero_identificacion",
        "direccion",
        "email",
        "telefono",
        "factus_municipality_id",
        "activo",
    }
    _nullable_json = {"alias"}  # única que admite NULL explícito en BD
    for k, v in data.items():
        if k not in _patch_keys:
            continue
        if v is None and k not in _nullable_json:
            continue
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

    # Releer solo la ruta del PDF desde BD: si hubo subida concurrente, no pisar con estado ORM viejo.
    db.refresh(p, attribute_names=["rut_pdf_relpath"])

    db.commit()
    db.refresh(p)
    return p
