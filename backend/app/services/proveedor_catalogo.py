"""Carga de datos de beneficiario desde el catálogo de proveedores."""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.proveedor_catalogo import ProveedorCatalogo
from app.utils.egreso_proveedor_dian import normalizar_y_validar_contacto_proveedor_documento_soporte

# Directorio `backend/` (contiene `app/`), no el cwd de uvicorn (puede ser la raíz del repo o System32).
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent


def proveedores_rut_storage_root() -> Path:
    p = Path(settings.PROVEEDORES_RUT_STORAGE_DIR)
    if p.is_absolute():
        return p
    return (_BACKEND_ROOT / p).resolve()


def proveedores_rut_abs_path(relpath: str) -> Path:
    """
    Resuelve la ruta absoluta del PDF. Prioriza el directorio estable bajo `backend/`;
    si no existe el archivo, prueba rutas antiguas (cwd o raíz del repo) por compatibilidad.
    """
    root = proveedores_rut_storage_root().resolve()
    rel = (relpath or "").replace("\\", "/").lstrip("/")
    primary = (root / rel).resolve()
    try:
        primary.relative_to(root)
    except ValueError as exc:
        raise ValueError("Ruta de almacenamiento inválida.") from exc
    if primary.is_file():
        return primary

    # Compat: subidas cuando el cwd era la raíz del monorepo (p. ej. .../SAAS-CDA/private_uploads/...)
    try:
        cwd_root = (Path.cwd() / Path(settings.PROVEEDORES_RUT_STORAGE_DIR)).resolve()
        alt = (cwd_root / rel).resolve()
        alt.relative_to(cwd_root)
        if alt.is_file():
            return alt
    except ValueError:
        pass

    try:
        parent_root = (_BACKEND_ROOT.parent / Path(settings.PROVEEDORES_RUT_STORAGE_DIR)).resolve()
        alt2 = (parent_root / rel).resolve()
        alt2.relative_to(parent_root)
        if alt2.is_file():
            return alt2
    except ValueError:
        pass

    return primary


def eliminar_archivo_rut_pdf_si_existe(relpath: str | None) -> None:
    if not (relpath or "").strip():
        return
    try:
        p = proveedores_rut_abs_path(relpath)
    except ValueError:
        return
    if p.is_file():
        p.unlink()


def cargar_beneficiario_desde_proveedor_catalogo(
    db: Session,
    *,
    tenant_id: UUID,
    proveedor_catalogo_id: UUID,
) -> dict:
    """
    Devuelve campos homónimos a movimiento (beneficiario, …) más proveedor_catalogo_id.
    """
    prov = (
        db.query(ProveedorCatalogo)
        .filter(
            ProveedorCatalogo.id == proveedor_catalogo_id,
            ProveedorCatalogo.tenant_id == tenant_id,
        )
        .first()
    )
    if prov is None:
        raise ValueError("Proveedor del catálogo no encontrado.")
    if not prov.activo:
        raise ValueError("El proveedor está inactivo en el catálogo. Actívelo o elija otro.")

    addr, mail, phone, mid = normalizar_y_validar_contacto_proveedor_documento_soporte(
        direccion=prov.direccion,
        email=prov.email,
        telefono=prov.telefono,
        factus_municipality_id=prov.factus_municipality_id,
    )
    nombre = (prov.razon_social_rut or "").strip()
    if len(nombre) < 2:
        raise ValueError("El nombre o razón social del proveedor en catálogo no es válido.")
    tid = (prov.tipo_identificacion or "").strip()
    num = (prov.numero_identificacion or "").strip()
    if not tid or len(num) < 4:
        raise ValueError("Tipo o número de identificación del proveedor en catálogo incompleto.")

    return {
        "beneficiario": nombre[:300],
        "beneficiario_tipo_identificacion": tid[:80],
        "beneficiario_numero_identificacion": num[:80],
        "beneficiario_direccion": addr,
        "beneficiario_email": mail,
        "beneficiario_telefono": phone,
        "beneficiario_factus_municipality_id": mid,
        "proveedor_catalogo_id": prov.id,
    }
