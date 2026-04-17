"""Carga de datos de beneficiario desde el catálogo de proveedores."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.proveedor_catalogo import ProveedorCatalogo
from app.utils.egreso_proveedor_dian import normalizar_y_validar_contacto_proveedor_documento_soporte


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
