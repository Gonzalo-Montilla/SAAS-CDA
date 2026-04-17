"""
Datos de contacto del proveedor/beneficiario en egresos para cumplimiento DIAN (documento soporte).
Validación compartida entre caja, tesorería y emisión Factus.
"""
from __future__ import annotations

from app.utils.factus_validators import email_valido_factus, solo_digitos


def normalizar_y_validar_contacto_proveedor_documento_soporte(
    *,
    direccion: str | None,
    email: str | None,
    telefono: str | None,
    factus_municipality_id: int | None,
    requiere_municipio_factus: bool = True,
) -> tuple[str, str, str, int | None]:
    """
    Devuelve (dirección, email, teléfono solo dígitos, municipality_id Factus del proveedor).

    Si ``requiere_municipio_factus`` es False (p. ej. egreso manual en caja sin pretender aún
    documento soporte), el id de municipio puede omitirse y el último valor será None.
    Para emitir documento soporte en Factus el municipio sigue siendo obligatorio.
    """
    addr = (direccion or "").strip()
    if len(addr) < 8:
        raise ValueError(
            "La dirección del proveedor o beneficiario es obligatoria (mínimo 8 caracteres), "
            "según requisitos para documento soporte electrónico."
        )
    mail = (email or "").strip().lower()
    if not email_valido_factus(mail):
        raise ValueError(
            "Indique un correo electrónico válido del proveedor (notificación del documento soporte y trazabilidad DIAN)."
        )
    phone = solo_digitos(telefono or "")
    if len(phone) < 7:
        raise ValueError(
            "Indique celular o teléfono del proveedor (mínimo 7 dígitos), requerido en el envío a Factus."
        )
    mid = factus_municipality_id
    if requiere_municipio_factus:
        if mid is None or int(mid) < 1:
            raise ValueError(
                "Seleccione el municipio del proveedor (id Factus). Use la búsqueda de municipios en el formulario de egreso."
            )
        return addr[:500], mail[:255], phone[:20], int(mid)
    if mid is not None and int(mid) >= 1:
        return addr[:500], mail[:255], phone[:20], int(mid)
    return addr[:500], mail[:255], phone[:20], None
