"""
Factura de suscripción del SaaS (PROMETHEUS → tenant CDA) — **línea independiente** de Factus.

- Estas emisiones usan **solo** `SAAS_BILLING_FACTUS_*` y credenciales del **emisor** (PROMETHEUS TECH
  S.A.S) que acuerde la empresa con Factus/Plan de facturación. Es la cuenta con la que ustedes
  **cobran la licencia** al CDA.
- `tenant_factus_settings` / `SaasTenantFactusPanel` es **otro circuito**: credenciales que cada
  **CDA (tenant) configura** para facturar a **sus** clientes (RTM, caja, DSE, etc.). No se mezclan
  con el emisor de la factura de licencia.

No deshace el cobro si la DIAN/Factus falla. IVA/ítems del emisor: validar con contador (p. ej. SIM).
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations.factus_client import (
    FactusAPIError,
    download_bill_pdf_resolved,
    factus_base_url,
    format_factus_error_detail,
    obtain_token,
    validate_invoice,
)
from app.integrations.factus_emit import (
    _bill_from_validate_response,
    _iva_tax_rate_string_factus,
    _nota_desglose_linea_gravada_iva,
    _quantize_moneda,
)
from app.models.factus import FacturaElectronica
from app.models.tenant import Tenant
from app.models.tenant_billing_checkout import TenantBillingCheckoutSession
from app.services.saas_billing_plans import PLAN_DEFINITIONS, calculate_chargeable_branches_for_tenant
from app.utils.archivo_fiscal_pdf import guardar_pdf_archivo_fiscal
from app.utils.factus_validators import (
    digito_verificacion_nit_colombia,
    digito_verificacion_nit_colombia_serie_37,
    email_valido_factus,
    parse_nit_colombiano_identificacion_y_dv,
    solo_digitos,
)

_log = logging.getLogger(__name__)


def _factus_saas_configured() -> bool:
    return bool(
        settings.SAAS_BILLING_FACTUS_ENABLED
        and (settings.SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID or 0) > 0
        and (settings.SAAS_BILLING_FACTUS_CLIENT_ID or "").strip()
        and (settings.SAAS_BILLING_FACTUS_CLIENT_SECRET or "").strip()
        and (settings.SAAS_BILLING_FACTUS_API_USERNAME or "").strip()
        and (settings.SAAS_BILLING_FACTUS_API_PASSWORD or "").strip()
    )


def _item_common_saas(*, ref_code: str) -> dict[str, Any]:
    return {
        "code_reference": (ref_code or "SaaS")[:20],
        "quantity": 1,
        "discount_rate": 0,
        "unit_measure_id": 70,
        "standard_code_id": 1,
        "withholding_taxes": [],
    }


def _issuer_establishment_payload() -> dict[str, Any]:
    tel = solo_digitos(settings.SAAS_BILLING_ISSUER_PHONE) or "3000000000"
    return {
        "name": (settings.SAAS_BILLING_ISSUER_NAME or "Emisor")[:200],
        "address": (settings.SAAS_BILLING_ISSUER_ADDRESS or "N/A")[:200],
        "phone_number": tel[:20],
        "email": (settings.SAAS_BILLING_ISSUER_EMAIL or "facturacion@local")[:200].lower(),
        "municipality_id": int(settings.SAAS_BILLING_ISSUER_MUNICIPALITY_ID),
    }


def _resolve_tenant_nit_and_dv(nit_raw: str) -> tuple[str, int]:
    """
    Resuelve NIT base + DV para el receptor (tenant) con reglas robustas:
    - Acepta formato con guion (900123456-8).
    - Si llega sin guion pero parece incluir DV al final, lo detecta.
    - Si no hay forma inequívoca de DV, exige capturarlo explícitamente.
    """
    s = (nit_raw or "").strip()
    ident, dv_parse = parse_nit_colombiano_identificacion_y_dv(s)
    if len(ident) < 6:
        raise ValueError("NIT del CDA insuficiente para Factus.")

    digits = solo_digitos(s)
    if "-" not in s and dv_parse is None and len(digits) >= 7:
        base_guess = digits[:-1]
        dv_guess = int(digits[-1])
        d71_guess = digito_verificacion_nit_colombia(base_guess)
        d37_guess = digito_verificacion_nit_colombia_serie_37(base_guess)
        if dv_guess == d71_guess or dv_guess == d37_guess:
            ident = base_guess
            dv_parse = dv_guess

    if dv_parse is not None:
        d71 = digito_verificacion_nit_colombia(ident)
        d37 = digito_verificacion_nit_colombia_serie_37(ident)
        if d71 == d37 and d71 != dv_parse:
            raise ValueError(
                "El DV no coincide con el NIT del CDA. Verifique en el RUT y regístrelo como 900123456-8."
            )
        return ident, int(dv_parse)

    d71 = digito_verificacion_nit_colombia(ident)
    d37 = digito_verificacion_nit_colombia_serie_37(ident)
    if d71 != d37:
        raise ValueError(
            "No fue posible inferir un DV único para el NIT del CDA. Registre el NIT con guion y DV oficial del RUT (ej: 900123456-8)."
        )
    return ident, int(d71)


def _customer_tenant_cda_nit(tenant: Tenant) -> dict[str, Any]:
    nit_raw = (tenant.nit_cda or "").strip()
    if len(solo_digitos(nit_raw)) < 5:
        raise ValueError("Registre NIT del CDA (receptor) para la factura electrónica de suscripción.")
    ident, dv_final = _resolve_tenant_nit_and_dv(nit_raw)
    legal_name = (tenant.nombre or "").strip()
    trade_name = (tenant.nombre_comercial or legal_name).strip()
    name = (legal_name or trade_name or "Cliente CDA").strip()[:200]
    if len(name) < 2:
        raise ValueError("Razón social del CDA requerida para facturar (debe coincidir con el RUT).")
    if not (tenant.direccion_facturacion or "").strip():
        raise ValueError("Registre dirección de facturación (matriz) del CDA para la FE de suscripción.")
    em = (tenant.correo_electronico or "").strip().lower()
    if not email_valido_factus(em):
        raise ValueError("Correo del CDA no válido para notificación DIAN; actualícelo en el perfil.")
    ph = solo_digitos(tenant.celular or "") or "6000000000"
    if len(ph) < 7:
        raise ValueError("Celular del CDA requerido (mín. 7 dígitos) para la factura DIAN.")
    mid = int(tenant.factus_municipality_id or settings.FACTUS_DEFAULT_MUNICIPALITY_ID)
    return {
        "identification_document_id": 6,
        "identification": ident[:20],
        "dv": str(dv_final),
        "company": name,
        "trade_name": (trade_name or name)[:200],
        "names": name,
        "address": (tenant.direccion_facturacion or "").strip()[:200],
        "email": em[:200],
        "phone": ph[:20],
        "legal_organization_id": 1,
        "tribute_id": 21,
        "municipality_id": mid,
    }


def _build_items_saas(*, plan_code: str, sedes: int, total_with_iva: Decimal) -> list[dict[str, Any]]:
    code = plan_code.strip().lower()
    plan = PLAN_DEFINITIONS[code]
    ch, _inc = calculate_chargeable_branches_for_tenant(code, sedes)
    pre_base = Decimal(str(plan["base_price"]))
    pre_sedes = Decimal(str(ch)) * Decimal(str(plan["additional_branch_price"]))
    sub = pre_base + pre_sedes
    if sub <= 0 or total_with_iva <= 0:
        raise ValueError("Monto de facturación inválido.")
    ref = f"saas-{uuid.uuid4().hex[:12]}"
    tax = _iva_tax_rate_string_factus()
    if ch < 1 or pre_sedes < Decimal("0.01"):
        bruto = _quantize_moneda(total_with_iva)
        return [
            {
                **_item_common_saas(ref_code=f"SUB-{ref[:6]}"),
                "name": (
                    f"Suscripción licencia CDASOFT — {plan['label'][:80]} (periodo según plan contratado)"
                )[:200],
                "note": _nota_desglose_linea_gravada_iva(bruto)[:500],
                "price": float(bruto),
                "tax_rate": tax,
                "is_excluded": 0,
                "tribute_id": 1,
            }
        ]
    # Dos líneas: prorrateo del total con IVA para coincidir con el cobro
    t1 = _quantize_moneda((pre_base / sub) * total_with_iva)
    t2 = _quantize_moneda(total_with_iva - t1)
    return [
        {
            **_item_common_saas(ref_code=f"SUB-{ref[:5]}"),
            "name": f"Suscripción plan {plan['label'][:80]} — servicio de software"[:200],
            "note": _nota_desglose_linea_gravada_iva(t1)[:500],
            "price": float(t1),
            "tax_rate": tax,
            "is_excluded": 0,
            "tribute_id": 1,
        },
        {
            **_item_common_saas(ref_code=f"SDS-{ref[:5]}"),
            "name": f"Sedes adicionales facturables ({ch})"[:200],
            "note": _nota_desglose_linea_gravada_iva(t2)[:500],
            "price": float(t2),
            "tax_rate": tax,
            "is_excluded": 0,
            "tribute_id": 1,
        },
    ]


def _saas_checkout_reference_code(checkout_id: uuid.UUID) -> str:
    """
    Código de referencia determinístico por sesión de checkout para:
    - facilitar soporte en Factus (borrado/reintento por API/Postman),
    - evitar perder trazabilidad cuando hay reintentos.
    """
    return f"saas-sub-{checkout_id.hex}"[:50]


def try_emit_saas_billing_electronic_invoice(
    db: Session, *, tenant: Tenant, checkout: TenantBillingCheckoutSession
) -> None:
    """
    Idempotente: si ya existe factura vinculada, no hace nada. Errores → checkout.saas_fe_error (no excepción hacia pago).
    """
    if not _factus_saas_configured():
        checkout.saas_fe_status = "skipped"
        checkout.saas_fe_error = "Habilite SAAS_BILLING_FACTUS_ENABLED y credenciales emisor en .env"
        db.add(checkout)
        db.commit()
        return

    existing = (
        db.query(FacturaElectronica)
        .filter(FacturaElectronica.billing_checkout_session_id == checkout.id)
        .first()
    )
    if existing is not None:
        return

    pnorm = (checkout.plan_code or "").strip().lower()
    if pnorm not in PLAN_DEFINITIONS or pnorm == "demo":
        checkout.saas_fe_status = "error"
        checkout.saas_fe_error = "Plan de sesión inválido para FE."
        db.add(checkout)
        db.commit()
        return
    try:
        ref = _saas_checkout_reference_code(checkout.id)
        total_d = _quantize_moneda(Decimal(str(checkout.total_cop)))
        items = _build_items_saas(
            plan_code=checkout.plan_code, sedes=int(checkout.sedes_totales or 1), total_with_iva=total_d
        )
        body: dict[str, Any] = {
            "document": "01",
            "numbering_range_id": int(settings.SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID or 0),
            "reference_code": ref,
            "observation": (
                f"Licencia CDASOFT — {PLAN_DEFINITIONS[pnorm]['label'][:60]}; sedes: {checkout.sedes_totales}"
            )[:250],
            "payment_method_code": "48",
            "send_email": email_valido_factus(tenant.correo_electronico or ""),
            "establishment": _issuer_establishment_payload(),
            "customer": _customer_tenant_cda_nit(tenant),
            "items": items,
        }
        use_sandbox = bool(settings.SAAS_BILLING_FACTUS_USE_SANDBOX)
        base = factus_base_url(use_sandbox=use_sandbox)
        tok = obtain_token(
            base_url=base,
            client_id=settings.SAAS_BILLING_FACTUS_CLIENT_ID.strip(),
            client_secret=settings.SAAS_BILLING_FACTUS_CLIENT_SECRET.strip(),
            username=settings.SAAS_BILLING_FACTUS_API_USERNAME.strip(),
            password=settings.SAAS_BILLING_FACTUS_API_PASSWORD.strip(),
        )
        access = tok.get("access_token")
        if not access:
            raise FactusAPIError("Token Factus SaaS sin access_token", status_code=502)
        resp = validate_invoice(base_url=base, access_token=str(access), body=body)
        if not isinstance(resp, dict):
            raise FactusAPIError("Respuesta Factus inesperada", status_code=502)
        bill = _bill_from_validate_response(resp)
        numero = bill.get("number") or bill.get("document_number") or ""
        cufe = bill.get("cufe") or ""
        public_url = bill.get("public_url") or ""
        factus_id = bill.get("id")
        fe = FacturaElectronica(
            tenant_id=tenant.id,
            vehiculo_proceso_id=None,
            billing_checkout_session_id=checkout.id,
            reference_code=ref[:120],
            factus_bill_id=int(factus_id) if factus_id is not None else None,
            numero_documento=str(numero)[:80] if numero else None,
            cufe=str(cufe)[:200] if cufe else None,
            public_url=str(public_url)[:800] if public_url else None,
            emitido_por_usuario_id=None,
        )
        db.add(fe)
        db.flush()
        try:
            pdf_bytes = download_bill_pdf_resolved(
                base_url=base,
                access_token=str(access),
                numero_documento=fe.numero_documento,
                factus_bill_id=fe.factus_bill_id,
            )
            rel, sha = guardar_pdf_archivo_fiscal(
                tenant_id=tenant.id,
                prefijo="fe_saas",
                entity_id=fe.id,
                pdf_bytes=pdf_bytes,
            )
            fe.pdf_storage_relpath = rel
            fe.pdf_sha256_hex = sha
            db.flush()
        except Exception as exc:
            _log.warning("FE SaaS: PDF no archivado (%s)", exc)
        checkout.saas_fe_status = "ok"
        checkout.saas_fe_error = None
        db.add(checkout)
        db.commit()
    except Exception as exc:
        _log.exception("FE SaaS no emitida para checkout %s", checkout.id)
        err_txt = str(exc)
        if isinstance(exc, FactusAPIError):
            err_txt = format_factus_error_detail(exc)[:4000]
        try:
            ref_ctx = _saas_checkout_reference_code(checkout.id)
            err_txt = f"{err_txt} | ref:{ref_ctx}"
        except Exception:
            pass
        checkout.saas_fe_status = "error"
        checkout.saas_fe_error = err_txt[:2000]
        db.add(checkout)
        try:
            db.commit()
        except Exception:
            db.rollback()
            _log.error("No se pudo guardar saas_fe_error en checkout %s", checkout.id)
