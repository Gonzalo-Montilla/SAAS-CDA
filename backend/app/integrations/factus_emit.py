"""
Construcción de payload y emisión de factura Factus para un cobro de vehículo.
"""
from __future__ import annotations

import re
import uuid
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.factus_crypto import decrypt_secret
from app.integrations.factus_client import FactusAPIError, factus_base_url, obtain_token, validate_invoice
from app.models.factus import FacturaElectronica, TenantFactusSettings
from app.services.factus_tenant_settings import active_auth_encrypted
from app.models.sucursal import Sucursal
from app.models.tarifa import Tarifa
from app.models.tenant import Tenant
from app.models.vehiculo import VehiculoProceso


def _iva_tax_rate_string_factus() -> str:
    """tax_rate del ítem gravado (misma tarifa que FACTUS_IVA_PORCENTAJE_GENERAL)."""
    p = float(settings.FACTUS_IVA_PORCENTAJE_GENERAL)
    return f"{p:.2f}"


def _quantize_moneda(v: Decimal) -> Decimal:
    exp = Decimal("1").scaleb(-settings.FACTUS_MONEDA_DECIMALES)  # 10^-n
    return v.quantize(exp)


def _iva_factor_precio_con_iva_incluido_dian() -> Decimal:
    tarifa = Decimal(str(settings.FACTUS_IVA_PORCENTAJE_GENERAL))
    return Decimal("1") + tarifa / Decimal("100")


def _base_gravable_desde_total_con_iva_incluido_dian(total_con_iva: Decimal) -> Decimal:
    """Base cuando el monto ya incluye IVA a la tarifa general (DIAN)."""
    if total_con_iva <= 0:
        raise ValueError("El monto gravado debe ser mayor a 0")
    return _quantize_moneda(total_con_iva / _iva_factor_precio_con_iva_incluido_dian())


def _fmt_cop_nota(v: Decimal) -> str:
    """Formato colombiano $92.436,97 para notas en ítems (sin depender de locale)."""
    v = _quantize_moneda(v)
    neg = v < 0
    v = abs(v)
    whole = int(v)
    cents = int((v - Decimal(whole)) * 100)
    if cents >= 100:
        whole += 1
        cents -= 100
    parts: list[str] = []
    w = whole
    while w >= 1000:
        parts.append(f"{w % 1000:03d}")
        w //= 1000
    parts.append(str(w))
    body = ".".join(reversed(parts))
    return f"{'-' if neg else ''}${body},{cents:02d}"


def _nota_desglose_linea_gravada_iva(bruto_con_iva: Decimal) -> str:
    """Texto corto: base + IVA = total (lo que el PDF no separa en columna Val. unitario)."""
    base = _base_gravable_desde_total_con_iva_incluido_dian(bruto_con_iva)
    iva = _quantize_moneda(bruto_con_iva - base)
    p = int(settings.FACTUS_IVA_PORCENTAJE_GENERAL)
    return (
        f"Base gravable {_fmt_cop_nota(base)} + IVA {p}% {_fmt_cop_nota(iva)} "
        f"= total línea {_fmt_cop_nota(bruto_con_iva)}"
    )[:500]


def _nombre_linea_rtm_con_desglose(bruto_con_iva: Decimal) -> str:
    """Nombre del ítem con base e IVA para la columna Descripción (Factus suele repetir precio con IVA en Val. unit.)."""
    base = _base_gravable_desde_total_con_iva_incluido_dian(bruto_con_iva)
    iva = _quantize_moneda(bruto_con_iva - base)
    p = int(settings.FACTUS_IVA_PORCENTAJE_GENERAL)
    s = (
        f"Revisión técnico-mecánica (RTM) — Base {_fmt_cop_nota(base)} + IVA {p}% {_fmt_cop_nota(iva)}"
    )
    return s[:200]


def _nombre_linea_servicio_unico_con_desglose(bruto_con_iva: Decimal) -> str:
    base = _base_gravable_desde_total_con_iva_incluido_dian(bruto_con_iva)
    iva = _quantize_moneda(bruto_con_iva - base)
    p = int(settings.FACTUS_IVA_PORCENTAJE_GENERAL)
    s = (
        f"Servicios CDA (RTM y terceros) — Base {_fmt_cop_nota(base)} + IVA {p}% {_fmt_cop_nota(iva)}"
    )
    return s[:200]


def _map_metodo_pago_factus(metodo_pago: str) -> str:
    m = (metodo_pago or "efectivo").lower().strip()
    if m == "efectivo":
        return "10"
    if m == "transferencia":
        return "47"
    if m in ("tarjeta_credito", "credismart", "sistecredito"):
        return "48"
    if m == "tarjeta_debito":
        return "49"
    if m == "mixto":
        return "10"
    return "10"


def _solo_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _email_valido_factus(email_raw: str | None) -> bool:
    s = (email_raw or "").strip().lower()
    if not s or "@" not in s:
        return False
    dom = s.split("@", 1)[-1]
    return "." in dom and len(dom) >= 3


def validar_datos_cliente_para_factus(vehiculo: VehiculoProceso) -> None:
    """
    Datos mínimos para adquiriente en factura electrónica DIAN vía Factus (nombre, doc, celular, correo).
    """
    nombre = (vehiculo.cliente_nombre or "").strip()
    if len(nombre) < 2:
        raise ValueError("El cliente debe tener nombre completo registrado para facturar electrónicamente.")
    digits = _solo_digitos(vehiculo.cliente_documento or "")
    if len(digits) < 5:
        raise ValueError("El cliente debe tener documento de identidad válido para facturar electrónicamente.")
    if not _email_valido_factus(vehiculo.cliente_email):
        raise ValueError(
            "Registre un correo electrónico válido del cliente (recepción) para enviar la factura DIAN."
        )
    tel = _solo_digitos(vehiculo.cliente_telefono or "")
    if len(tel) < 7:
        raise ValueError(
            "Registre celular o teléfono del cliente (mínimo 7 dígitos) para la factura electrónica."
        )


def _resolve_municipality_id(sede: Optional[Sucursal], tenant: Tenant) -> int:
    if sede is not None and sede.factus_municipality_id is not None:
        return int(sede.factus_municipality_id)
    if tenant.factus_municipality_id is not None:
        return int(tenant.factus_municipality_id)
    return int(settings.FACTUS_DEFAULT_MUNICIPALITY_ID)


def _resolve_establishment_address(sede: Optional[Sucursal], tenant: Tenant) -> str:
    if sede is not None:
        d = (sede.direccion or "").strip()
        if d:
            return d[:200]
    d2 = (tenant.direccion_facturacion or "").strip()
    if d2:
        return d2[:200]
    return "N/A"


def _customer_payload(
    vehiculo: VehiculoProceso,
    *,
    municipality_id: int,
) -> dict[str, Any]:
    """Cliente persona natural (cédula); documento solo dígitos. Dirección opcional (Factus/DIAN puede ir en blanco)."""
    digits = _solo_digitos(vehiculo.cliente_documento or "")
    if not digits:
        raise ValueError("El cliente no tiene documento válido para emitir factura electrónica")
    names = (vehiculo.cliente_nombre or "Cliente").strip()[:200]
    email = (vehiculo.cliente_email or "").strip().lower()
    if not _email_valido_factus(email):
        email = "cliente@local.invalid"
    phone = _solo_digitos(vehiculo.cliente_telefono or "") or "6000000000"
    addr = (vehiculo.cliente_direccion or "").strip()[:200]
    return {
        "identification_document_id": 3,
        "identification": digits[:20],
        "dv": None,
        "company": "",
        "trade_name": "",
        "names": names,
        "address": addr,
        "email": email[:200],
        "phone": phone[:20],
        "legal_organization_id": 2,
        "tribute_id": 21,
        "municipality_id": municipality_id,
    }


def _establishment_payload(
    tenant: Tenant,
    sede: Optional[Sucursal],
    *,
    municipality_id: int,
    address: str,
) -> dict[str, Any]:
    nombre = tenant.nombre_comercial or tenant.nombre or "CDA"
    direccion = address
    tel = _solo_digitos(tenant.celular or "") or "6000000000"
    mail = (tenant.correo_electronico or "facturacion@cda.local").strip()
    if sede is not None:
        nombre = f"{nombre} — {sede.nombre}"
    return {
        "name": nombre[:200],
        "address": direccion,
        "phone_number": tel,
        "email": mail[:200],
        "municipality_id": municipality_id,
    }


def _item_linea_comun(placa: str, sufijo: str) -> dict[str, Any]:
    ref = f"{(placa or 'X')[:12]}-{sufijo}"[:20]
    return {
        "code_reference": ref,
        "quantity": 1,
        "discount_rate": 0,
        "unit_measure_id": 70,
        "standard_code_id": 1,
        "withholding_taxes": [],
    }


def _items_factura_cobro(
    vehiculo: VehiculoProceso,
    tarifa: Optional[Tarifa],
) -> list[dict[str, Any]]:
    """
    Monto total a facturar = valor almacenado en vehiculo.valor_rtm (en registro es tarifa.valor_total:
    RTM + terceros). No incluye comisión SOAT.

    Si hay tarifa alineada con ese total: línea 1 RTM con IVA (tarifa.valor_rtm = precio con IVA
    incluido), línea 2 terceros sin IVA. Si no, una línea con todo gravado a la misma tarifa.

    Factus exige `price` = precio **con impuestos incluidos**; la API desagrega base e IVA en totales y
    XML DIAN. La representación gráfica suele repetir ese valor en «Valor unitario»; el desglose
    base + IVA se envía en `items.note` para que conste en la factura.
    """
    total_servicio = Decimal(vehiculo.valor_rtm or 0)
    if total_servicio <= 0:
        raise ValueError("El valor del servicio debe ser mayor a 0 para emitir factura electrónica")

    usar_desglose = False
    if tarifa is not None:
        suma_tarifa = Decimal(tarifa.valor_rtm) + Decimal(tarifa.valor_terceros)
        usar_desglose = abs(suma_tarifa - total_servicio) <= Decimal("1")

    items: list[dict[str, Any]] = []

    if usar_desglose and tarifa is not None:
        rtm_bruto = Decimal(tarifa.valor_rtm)
        ter_bruto = Decimal(tarifa.valor_terceros)
        if rtm_bruto > 0:
            items.append(
                {
                    **_item_linea_comun(vehiculo.placa, "RTM"),
                    "name": _nombre_linea_rtm_con_desglose(rtm_bruto),
                    "note": _nota_desglose_linea_gravada_iva(rtm_bruto),
                    "price": float(_quantize_moneda(rtm_bruto)),
                    "tax_rate": _iva_tax_rate_string_factus(),
                    "is_excluded": 0,
                    "tribute_id": 1,
                }
            )
        if ter_bruto > 0:
            items.append(
                {
                    **_item_linea_comun(vehiculo.placa, "TER"),
                    "name": "Servicios de terceros",
                    "note": "Monto sin IVA (exento / 0%).",
                    "price": float(_quantize_moneda(ter_bruto)),
                    "tax_rate": "0.00",
                    "is_excluded": 1,
                    "tribute_id": 1,
                }
            )
        if not items:
            raise ValueError("Tarifa sin valores RTM/terceros para facturar")
        return items

    # Fallback: un solo ítem gravado (p. ej. PREVENTIVA o tarifa desactualizada)
    items.append(
        {
            **_item_linea_comun(vehiculo.placa, "SRV"),
            "name": _nombre_linea_servicio_unico_con_desglose(total_servicio),
            "note": _nota_desglose_linea_gravada_iva(total_servicio),
            "price": float(_quantize_moneda(total_servicio)),
            "tax_rate": _iva_tax_rate_string_factus(),
            "is_excluded": 0,
            "tribute_id": 1,
        }
    )
    return items


def _bill_from_validate_response(resp: dict[str, Any]) -> dict[str, Any]:
    data = resp.get("data")
    if isinstance(data, dict):
        bill = data.get("bill")
        if isinstance(bill, dict):
            return bill
        if "number" in data or "cufe" in data or "id" in data:
            return data
    bill = resp.get("bill")
    if isinstance(bill, dict):
        return bill
    return {}


def resolve_numbering_range_id_for_cobro(
    db: Session,
    *,
    tenant_id: UUID,
    active_sucursal_id: UUID,
    tenant_default_range_id: int | None,
) -> int | None:
    """
    Rango Factus a usar en caja: el de la sede activa si está definido; si no, default del tenant (backoffice).
    """
    sede = (
        db.query(Sucursal)
        .filter(Sucursal.id == active_sucursal_id, Sucursal.tenant_id == tenant_id)
        .first()
    )
    if sede is not None and sede.factus_numbering_range_id is not None:
        return sede.factus_numbering_range_id
    return tenant_default_range_id


def build_validate_body(
    *,
    vehiculo: VehiculoProceso,
    tenant: Tenant,
    db: Session,
    active_sucursal_id: UUID,
    numbering_range_id: int,
    metodo_pago: str,
    tarifa: Optional[Tarifa] = None,
) -> dict[str, Any]:
    # Factura por RTM + terceros (vehiculo.valor_rtm ≈ tarifa.valor_total). Comisión SOAT fuera de Factus.
    items = _items_factura_cobro(vehiculo, tarifa)

    sede = (
        db.query(Sucursal)
        .filter(Sucursal.id == active_sucursal_id, Sucursal.tenant_id == tenant.id)
        .first()
    )
    mid = _resolve_municipality_id(sede, tenant)
    addr_est = _resolve_establishment_address(sede, tenant)

    ref = f"cdsoft-{vehiculo.id.hex[:8]}-{uuid.uuid4().hex[:12]}"
    obs = f"Placa {vehiculo.placa} — RTM + terceros (total servicio)"

    body: dict[str, Any] = {
        "document": "01",
        "numbering_range_id": numbering_range_id,
        "reference_code": ref[:50],
        "observation": obs[:250],
        "payment_method_code": _map_metodo_pago_factus(metodo_pago),
        "send_email": _email_valido_factus(vehiculo.cliente_email),
        "establishment": _establishment_payload(
            tenant, sede, municipality_id=mid, address=addr_est
        ),
        "customer": _customer_payload(vehiculo, municipality_id=mid),
        "items": items,
    }
    return body


def emitir_y_persistir_factura_cobro(
    db: Session,
    *,
    vehiculo: VehiculoProceso,
    tenant: Tenant,
    fs: TenantFactusSettings,
    active_sucursal_id: UUID,
    metodo_pago: str,
    tarifa: Optional[Tarifa] = None,
) -> tuple[str, Optional[str], Optional[str]]:
    """
    Obtiene token, valida factura en Factus, persiste FacturaElectronica.
    Retorna (numero_factura_dian, cufe, public_url).
    """
    numbering_id = resolve_numbering_range_id_for_cobro(
        db,
        tenant_id=vehiculo.tenant_id,
        active_sucursal_id=active_sucursal_id,
        tenant_default_range_id=fs.default_numbering_range_id,
    )
    if not numbering_id:
        raise FactusAPIError(
            "Configure el id de rango Factus para esta sede (Organización → sedes) o un rango predeterminado del tenant en el backoffice SaaS.",
            status_code=400,
        )

    cid, sec_enc, user, pwd_enc = active_auth_encrypted(fs)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    pwd = decrypt_secret(pwd_enc) if pwd_enc else None
    if not cid or not secret or not user or not pwd:
        raise FactusAPIError(
            "Credenciales Factus incompletas para el ambiente configurado (pruebas o producción).",
            status_code=400,
        )

    base = factus_base_url(use_sandbox=fs.use_sandbox)
    tok = obtain_token(
        base_url=base,
        client_id=cid,
        client_secret=secret,
        username=user,
        password=pwd,
    )
    access = tok.get("access_token")
    if not access:
        raise FactusAPIError("Token Factus sin access_token", status_code=502)

    body = build_validate_body(
        vehiculo=vehiculo,
        tenant=tenant,
        db=db,
        active_sucursal_id=active_sucursal_id,
        numbering_range_id=numbering_id,
        metodo_pago=metodo_pago,
        tarifa=tarifa,
    )

    resp = validate_invoice(base_url=base, access_token=access, body=body)
    if not isinstance(resp, dict):
        raise FactusAPIError("Respuesta Factus inesperada", status_code=502, body=resp)

    bill = _bill_from_validate_response(resp)
    numero = bill.get("number") or bill.get("document_number") or ""
    cufe = bill.get("cufe") or ""
    public_url = bill.get("public_url") or ""
    factus_id = bill.get("id")
    ref_code = str(body.get("reference_code", ""))

    fe = FacturaElectronica(
        tenant_id=vehiculo.tenant_id,
        vehiculo_proceso_id=vehiculo.id,
        reference_code=ref_code[:120],
        factus_bill_id=int(factus_id) if factus_id is not None else None,
        numero_documento=str(numero)[:80] if numero else None,
        cufe=str(cufe)[:200] if cufe else None,
        public_url=str(public_url)[:800] if public_url else None,
    )
    db.add(fe)

    display = str(numero) if numero else ref_code
    return (display, str(cufe) if cufe else None, str(public_url) if public_url else None)
