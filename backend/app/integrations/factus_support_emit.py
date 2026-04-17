"""
Emisión de documento soporte Factus vinculada a egresos de caja o tesorería.
"""
from __future__ import annotations

import html
import logging
import uuid
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.factus_crypto import decrypt_secret
from app.integrations.factus_client import (
    FactusAPIError,
    factus_base_url,
    get_numbering_ranges,
    get_support_document_show,
    obtain_token,
    validate_support_document,
)
from app.integrations.factus_emit import (
    _establishment_payload,
    _map_metodo_pago_factus,
    _resolve_establishment_address,
    _resolve_municipality_id,
)
from app.utils.factus_validators import (
    digito_verificacion_nit_colombia,
    digito_verificacion_nit_colombia_serie_37,
    email_valido_factus,
    normalizar_base_nit_persona_natural_colombia,
    parse_nit_colombiano_identificacion_y_dv,
    solo_digitos,
)
from app.utils.email import enviar_email
from app.utils.egreso_proveedor_dian import normalizar_y_validar_contacto_proveedor_documento_soporte
from app.models.caja import MovimientoCaja
from app.models.factus import DocumentoSoporteElectronico, TenantFactusSettings
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.tesoreria import MetodoPagoTesoreria, MovimientoTesoreria, TipoMovimientoTesoreria
from app.services.factus_tenant_settings import active_auth_encrypted

MODULO_CAJA = "caja"
MODULO_TESORERIA = "tesoreria"
_log_ds = logging.getLogger(__name__)


def _url_descartar_como_no_visor_documento(url: str) -> bool:
    """
    Factus a veces devuelve logos o estáticos en campos genéricos («url»). No abrir eso como «documento».
    """
    s = (url or "").strip()
    if not s.startswith("http"):
        return True
    low = s.split("?", 1)[0].lower()
    if low.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp")):
        return True
    junk = (
        "/logo",
        "/logos/",
        "logo.png",
        "logo.svg",
        "/brand/",
        "/favicon",
        "/icon/",
        "/icons/",
        "/img/",
        "/images/",
        "/static/",
        "/assets/",
        "/uploads/",
        "avatar",
        "/media/",
        "sprite",
        "-icon.",
        "_icon.",
    )
    return any(x in low for x in junk)


def _prioridad_url_visor_documento_soporte(url: str) -> int:
    """Mayor = más probable que sea visor DIAN / PDF del documento (no marca)."""
    if _url_descartar_como_no_visor_documento(url):
        return -100_000
    lo = url.lower()
    n = 0
    if "catalogo-vpfe.dian.gov.co" in lo:
        n += 250
    if "searchqr" in lo or "documentkey=" in lo or "documentkey?" in lo:
        n += 200
    if "vpfe" in lo and "dian" in lo:
        n += 120
    if "cuds" in lo or "cufe" in lo:
        n += 80
    if lo.split("?", 1)[0].rstrip("/").endswith(".pdf"):
        n += 100
    if "mitt" in lo:
        n += 50
    for frag in ("support-document", "supportdocument", "/documents/", "electronic_document", "visor"):
        if frag in lo:
            n += 30
            break
    return n


def resolver_y_guardar_public_url_documento_soporte(
    db: Session,
    *,
    fs: TenantFactusSettings,
    ds: DocumentoSoporteElectronico,
) -> str | None:
    """
    Si en BD no hay public_url válida, consulta Factus GET support-documents/show y persiste el enlace del visor.
    """
    existing = (ds.public_url or "").strip()
    if existing and not _url_descartar_como_no_visor_documento(existing):
        return existing
    cid, sec_enc, user, pwd_enc = active_auth_encrypted(fs)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    pwd = decrypt_secret(pwd_enc) if pwd_enc else None
    if not cid or not secret or not user or not pwd:
        return None
    base = factus_base_url(use_sandbox=fs.use_sandbox)
    try:
        tok = obtain_token(
            base_url=base,
            client_id=cid,
            client_secret=secret,
            username=user,
            password=pwd,
        )
    except FactusAPIError:
        return None
    access = tok.get("access_token")
    if not access:
        return None
    candidates: list[str] = []
    for x in (
        (ds.numero_documento or "").strip() or None,
        str(ds.factus_document_id) if ds.factus_document_id is not None else None,
        (ds.cuds or "").strip() or None,
    ):
        if x and x not in candidates:
            candidates.append(x)
    if not candidates:
        return None
    for cand in candidates:
        try:
            show = get_support_document_show(base_url=base, access_token=access, number=cand)
        except FactusAPIError:
            continue
        data = show.get("data") if isinstance(show.get("data"), dict) else show
        if not isinstance(data, dict):
            continue
        nested = data.get("support_document") or data.get("supportDocument") or data.get("document")
        doc: dict[str, Any] = nested if isinstance(nested, dict) else data
        url = _resolver_public_url_documento_soporte(show, doc)
        if url:
            ds.public_url = url[:800]
            db.add(ds)
            db.commit()
            db.refresh(ds)
            return url
    if existing and _url_descartar_como_no_visor_documento(existing):
        ds.public_url = None
        db.add(ds)
        db.commit()
        db.refresh(ds)
    return None


def _resolver_numero_visible_documento_soporte(doc: dict[str, Any]) -> str:
    """Número para mostrar y para GET download-pdf/show; Factus usa distintas claves según versión."""
    if not doc:
        return ""
    for key in ("number", "document_number", "consecutive", "document", "full_number", "formatted_number"):
        v = doc.get(key)
        if v is not None and str(v).strip():
            return str(v).strip()[:80]
    pref = doc.get("prefix") or doc.get("prefijo") or ""
    cons = doc.get("consecutive") or doc.get("number")
    if cons is not None and str(cons).strip():
        return f"{pref}{cons}".strip()[:80]
    return ""


def _resolver_public_url_documento_soporte(resp: dict[str, Any], doc: dict[str, Any]) -> str:
    """
    Factus coloca el enlace del visor en distintas claves o anidado; sin esto el front cae al proxy PDF que a veces no trae base64.

    No devolver el primer «http» que contenga «factus»: suele ser logo PNG/CDN. Se puntúan candidatos y se descartan imágenes.

    Nota: muchas `qr_url` / `public_url` de DIAN son del catálogo VPFE (`searchqr`, `documentkey`) y abren la pantalla
    «Buscar documento» con el CUDS/CUFE precargado (paso extra «Buscar»). El front puede preferir el PDF vía Factus.
    """
    key_order = (
        "public_url",
        "publicURL",
        "qr_url",
        "qrUrl",
        "dian_url",
        "viewer_url",
        "electronic_document_url",
        "public",
        "link",
        "url",
    )
    cands: list[str] = []

    def _collect_from_obj(o: Any, depth: int = 0) -> None:
        if depth > 8 or o is None:
            return
        if isinstance(o, str) and o.strip().startswith("http") and len(o.strip()) > 15:
            cands.append(o.strip()[:800])
            return
        if isinstance(o, dict):
            for v in o.values():
                _collect_from_obj(v, depth + 1)
        elif isinstance(o, list):
            for v in o:
                _collect_from_obj(v, depth + 1)

    for src in (
        doc,
        resp,
        resp.get("data") if isinstance(resp.get("data"), dict) else None,
    ):
        if not isinstance(src, dict):
            continue
        for k in key_order:
            v = src.get(k)
            if isinstance(v, str) and v.strip().startswith("http"):
                cands.append(v.strip()[:800])

    _collect_from_obj(resp)
    _collect_from_obj(doc)

    seen: set[str] = set()
    uniq: list[str] = []
    for u in cands:
        if u not in seen:
            seen.add(u)
            uniq.append(u)

    best = ""
    best_p = -10_000_000
    for u in uniq:
        p = _prioridad_url_visor_documento_soporte(u)
        if p > best_p:
            best_p = p
            best = u
    return best if best_p >= 0 else ""


def _document_from_support_validate_response(resp: dict[str, Any]) -> dict[str, Any]:
    data = resp.get("data")
    if isinstance(data, dict):
        for key in ("support_document", "supportDocument", "document", "bill"):
            doc = data.get(key)
            if isinstance(doc, dict):
                return doc
        if any(
            k in data
            for k in (
                "number",
                "document_number",
                "consecutive",
                "cuds",
                "cufe",
                "id",
                "public_url",
                "qr_url",
            )
        ):
            return data
    for key in ("support_document", "document", "bill"):
        doc = resp.get(key)
        if isinstance(doc, dict):
            return doc
    return {}


def _resolver_tipo_proveedor_documento_soporte(
    tipo_raw: str | None,
) -> tuple[int, int]:
    """
    Catálogo Factus «documento soporte»: IDs 4–10.
    https://developers.factus.com.co/tablas-de-referencia/tablas/

    Devuelve (identification_document_id, legal_organization_id). 1=jurídica, 2=natural.

    Importante: el id 8 es «Documento de identificación **extranjero**». Si se envía con país CO y municipio
    colombiano, Factus exige NIT. Por eso C.C./T.I. colombianas se envían con **identification_document_id 6**
    (NIT) y **legal_organization_id 2** (persona natural), usando el número de cédula/TI y el **DV** calculado.

    La representación gráfica DIAN suele rotular «NIT» (código 31), no «Cédula» (13): es la forma en que el
    XML de documento soporte identifica al proveedor residente ante Factus/DIAN, no un error de captura en CDASOFT.
    """
    t = (tipo_raw or "").lower().strip()
    if not t:
        raise ValueError("Indique el tipo de identificación del proveedor para el documento soporte.")

    if "nit" in t and ("otro" in t or "país" in t or "pais" in t or "extranj" in t):
        return 10, 2
    if "nit" in t:
        return 6, 1

    if "pep" in t:
        return 9, 2
    if "pasaport" in t:
        return 7, 2
    if "tarjeta" in t and "extranj" in t:
        return 4, 2
    if "extranj" in t or t in ("ce", "c.e", "c.e."):
        return 5, 2

    if (
        "c.c" in t
        or t == "cc"
        or "cedula" in t
        or "cédula" in t
        or ("tarjeta" in t and "identidad" in t)
    ):
        return 6, 2

    raise ValueError(
        f"Tipo de identificación del proveedor no reconocido para Factus documento soporte: «{tipo_raw}». "
        "Use NIT, C.C, TARJETA DE IDENTIDAD, C.E, PASAPORTE o P.E.P."
    )


def _country_code_proveedor_documento_soporte(doc_id: int) -> str:
    """
    NIT Colombia (6) → CO. NIT otro país (10) y demás documentos extranjeros → default .env.
    """
    if doc_id == 6:
        return "CO"
    cc = (settings.FACTUS_DOCUMENTO_SOPORTE_PAIS_EXTRANJERO_DEFAULT or "US").strip().upper()
    if len(cc) == 2 and cc.isascii() and cc.isalpha():
        return cc
    return "US"


def _provider_payload_support(
    *,
    beneficiario: str,
    beneficiario_tipo: str | None,
    beneficiario_numero: str | None,
    address: str,
    email: str,
    phone: str,
    municipality_id: int,
) -> dict[str, Any]:
    doc_id, legal_org = _resolver_tipo_proveedor_documento_soporte(beneficiario_tipo)
    ident, dv_parse = parse_nit_colombiano_identificacion_y_dv(beneficiario_numero)
    dv_final: int | None = None

    if doc_id == 6:
        if legal_org == 1:
            if len(ident) < 6:
                raise ValueError(
                    "Indique un NIT del proveedor válido (solo dígitos o con guion y DV) para el documento soporte."
                )
        elif len(ident) < 5:
            raise ValueError(
                "Indique número de cédula o tarjeta de identidad del proveedor (solo dígitos) para el documento soporte."
            )

        if legal_org == 2:
            norm = normalizar_base_nit_persona_natural_colombia(ident)
            if dv_parse is not None:
                d71_i = digito_verificacion_nit_colombia(ident)
                d37_i = digito_verificacion_nit_colombia_serie_37(ident)
                d71_n = digito_verificacion_nit_colombia(norm)
                d37_n = digito_verificacion_nit_colombia_serie_37(norm)
                ok_ident = d71_i == d37_i == dv_parse
                ok_norm = norm != ident and d71_n == d37_n == dv_parse
                if ok_norm and not ok_ident:
                    ident = norm
                elif not ok_ident and not ok_norm:
                    if d71_i == d37_i and d71_i != dv_parse:
                        raise ValueError(
                            "El dígito de verificación no coincide con el número indicado. Revise el **RUT** del proveedor "
                            "(cédula como NIT: a veces lleva ceros a la izquierda hasta 9 dígitos antes del guion)."
                        )
                dv_final = dv_parse
            else:
                ident = norm
                dv_71 = digito_verificacion_nit_colombia(ident)
                dv_37 = digito_verificacion_nit_colombia_serie_37(ident)
                if dv_71 != dv_37:
                    raise ValueError(
                        "Para este número hay dos dígitos de verificación posibles según distintas tablas usadas en Colombia. "
                        "La DIAN (regla DSAJ24b) exige el DV que corresponda al **RUT**. Escriba el documento con guion y "
                        "DV oficial, por ejemplo: 1113695964-1 o 900123456-8 (como en el certificado del proveedor)."
                    )
                dv_final = dv_71
        elif dv_parse is not None:
            dv_final = dv_parse
            d71 = digito_verificacion_nit_colombia(ident)
            d37 = digito_verificacion_nit_colombia_serie_37(ident)
            if d71 == d37 and d71 != dv_parse:
                raise ValueError(
                    "El dígito de verificación no coincide con el NIT indicado. Verifique el número y el DV del **RUT**."
                )
        else:
            dv_71 = digito_verificacion_nit_colombia(ident)
            dv_37 = digito_verificacion_nit_colombia_serie_37(ident)
            if dv_71 != dv_37:
                raise ValueError(
                    "Para este número hay dos dígitos de verificación posibles según distintas tablas usadas en Colombia. "
                    "La DIAN (regla DSAJ24b) exige el DV que corresponda al **RUT**. Escriba el documento con guion y "
                    "DV oficial, por ejemplo: 1113695964-1 o 900123456-8 (como en el certificado del proveedor)."
                )
            dv_final = dv_71
    elif len(ident) < 5:
        raise ValueError("Indique documento del proveedor válido para el documento soporte.")
    name = (beneficiario or "").strip()[:200]
    if len(name) < 2:
        raise ValueError("Indique el nombre o razón social del proveedor (beneficiario).")
    base: dict[str, Any] = {
        "identification_document_id": doc_id,
        "identification": ident[:20],
        "dv": str(dv_final) if dv_final is not None else None,
        "municipality_id": municipality_id,
        "trade_name": "",
        "graphic_representation_name": name,
        "address": (address or "").strip()[:200],
        "email": (email or "").strip().lower()[:200],
        "phone": (phone or "").strip()[:20],
        "tribute_id": 21,
    }
    base["country_code"] = _country_code_proveedor_documento_soporte(doc_id)
    base["legal_organization_id"] = legal_org
    if legal_org == 1:
        base["company"] = name
        # Factus valida provider.names como obligatorio («nombre cliente») aun con NIT / persona jurídica.
        base["names"] = name
    else:
        base["company"] = ""
        base["names"] = name
    return base


def validar_identificacion_proveedor_catalogo_documento_soporte(
    tipo_identificacion: str,
    numero_identificacion: str,
) -> None:
    """
    Mismas reglas de NIT/DV que al armar el proveedor para Factus, para validar el catálogo al guardar
    y no fallar solo al emitir documento soporte (p. ej. dos DV posibles sin guion).
    """
    _provider_payload_support(
        beneficiario="Validación catálogo proveedor",
        beneficiario_tipo=tipo_identificacion,
        beneficiario_numero=numero_identificacion,
        address="Calle validación catálogo # 1-00 ext",
        email="validacion@catalogo.cd",
        phone="3000000000",
        municipality_id=1,
    )


def _resolve_documento_soporte_numbering_range_id(
    *,
    fs: TenantFactusSettings,
    base_url: str,
    access_token: str,
) -> int:
    if fs.documento_soporte_numbering_range_id:
        return int(fs.documento_soporte_numbering_range_id)
    ranges = get_numbering_ranges(base_url=base_url, access_token=access_token, is_active=1)
    for r in ranges:
        doc = str(r.get("document") or r.get("document_type") or "").strip()
        if doc == "24":
            rid = r.get("id")
            if rid is not None:
                return int(rid)
    raise FactusAPIError(
        "No hay rango activo de documento soporte (documento 24) en Factus. "
        "Cree un rango en Factus o asigne documento_soporte_numbering_range_id en configuración.",
        status_code=400,
    )


def _metodo_pago_codigo_tesoreria(metodo: MetodoPagoTesoreria) -> str:
    m = metodo.value if hasattr(metodo, "value") else str(metodo)
    if m == "efectivo":
        return "10"
    if m == "transferencia":
        return "47"
    if m == "cheque":
        return "13"
    if m == "consignacion":
        return "47"
    return "10"


def _items_documento_soporte(
    *, ref_code: str, concepto: str, monto: Decimal, beneficiario: str
) -> list[dict[str, Any]]:
    ref = f"{ref_code[:12]}-ds"[:20]
    return [
        {
            "code_reference": ref,
            "quantity": 1,
            "discount_rate": 0,
            "unit_measure_id": 70,
            "standard_code_id": 1,
            "withholding_taxes": [],
            "name": (concepto or "Compra / servicio documento soporte")[:200],
            "note": f"Egreso. Proveedor: {(beneficiario or '')[:200]}",
            "price": float(monto.quantize(Decimal("0.01"))),
            "tax_rate": "0.00",
            "is_excluded": 1,
            "tribute_id": 1,
        }
    ]


def build_reference_code_documento_soporte(modulo: str, movimiento_id: UUID) -> str:
    m = modulo.strip().lower()[:1]
    return f"dse-{m}-{movimiento_id.hex}"[:50]


def _sede_documento_soporte(
    db: Session,
    *,
    tenant: Tenant,
    modulo: str,
    mov: MovimientoCaja | MovimientoTesoreria,
) -> Sucursal | None:
    """Sede operativa del egreso: caja diaria (caja.sucursal_id) o tesorería (mov.sucursal_id)."""
    sid: UUID | None = None
    if modulo == MODULO_CAJA:
        caja = getattr(mov, "caja", None)
        if caja is not None:
            sid = caja.sucursal_id
    else:
        sid = getattr(mov, "sucursal_id", None)
    if sid is None:
        return None
    return (
        db.query(Sucursal)
        .filter(Sucursal.id == sid, Sucursal.tenant_id == tenant.id)
        .first()
    )


def _enviar_correo_copia_cda_documento_soporte(
    *,
    destinatario: str,
    tenant: Tenant,
    numero_documento: str,
    public_url: str,
    reference_code: str,
) -> None:
    """Copia interna vía SMTP del CDA (no sustituye el envío Factus al proveedor)."""
    nombre = html.escape((tenant.nombre_comercial or tenant.nombre or "CDA").strip())
    num = html.escape((numero_documento or "").strip() or "—")
    ref = html.escape((reference_code or "").strip())
    url = (public_url or "").strip()
    link = f'<p><a href="{html.escape(url)}">Abrir documento en el visor DIAN / Factus</a></p>' if url else ""
    cuerpo = f"""<p>Se emitió y validó un <strong>documento soporte electrónico</strong> para su organización.</p>
<p><strong>Organización:</strong> {nombre}<br/>
<strong>Número:</strong> {num}<br/>
<strong>Referencia interna:</strong> {ref}</p>
{link}
<p>Este mensaje se envía porque configuró un correo de notificación en Factus (documento soporte).</p>"""
    enviar_email(destinatario.strip().lower(), f"Documento soporte emitido — {nombre}", cuerpo)


def emitir_documento_soporte_desde_movimiento(
    db: Session,
    *,
    tenant: Tenant,
    fs: TenantFactusSettings,
    modulo: Literal["caja", "tesoreria"],
    movimiento_id: UUID,
) -> DocumentoSoporteElectronico:
    if fs.modo != "factus":
        raise FactusAPIError(
            "Configure el modo Factus activo (ajustes de facturación) para emitir documentos soporte.",
            status_code=400,
        )

    existing = (
        db.query(DocumentoSoporteElectronico)
        .filter(
            DocumentoSoporteElectronico.tenant_id == tenant.id,
            DocumentoSoporteElectronico.source_module == modulo,
            DocumentoSoporteElectronico.movimiento_id == movimiento_id,
        )
        .first()
    )
    if existing:
        raise FactusAPIError(
            "Este movimiento ya tiene un documento soporte electrónico emitido.",
            status_code=409,
        )

    if modulo == MODULO_CAJA:
        mov = (
            db.query(MovimientoCaja)
            .options(joinedload(MovimientoCaja.caja))
            .filter(MovimientoCaja.id == movimiento_id, MovimientoCaja.tenant_id == tenant.id)
            .first()
        )
        if not mov:
            raise FactusAPIError("Movimiento de caja no encontrado.", status_code=404)
        if mov.monto >= 0:
            raise FactusAPIError(
                "Solo los egresos de caja pueden generar documento soporte.", status_code=400
            )
        concepto = mov.concepto or ""
        monto = Decimal(str(abs(mov.monto)))
        beneficiario = mov.beneficiario or ""
        btipo = mov.beneficiario_tipo_identificacion
        bnum = mov.beneficiario_numero_identificacion
        pay_code = _map_metodo_pago_factus(mov.metodo_pago or "efectivo")
    elif modulo == MODULO_TESORERIA:
        mov = (
            db.query(MovimientoTesoreria)
            .filter(
                MovimientoTesoreria.id == movimiento_id,
                MovimientoTesoreria.tenant_id == tenant.id,
            )
            .first()
        )
        if not mov:
            raise FactusAPIError("Movimiento de tesorería no encontrado.", status_code=404)
        if mov.tipo != TipoMovimientoTesoreria.EGRESO:
            raise FactusAPIError(
                "Solo los egresos de tesorería pueden generar documento soporte.", status_code=400
            )
        if mov.anulado:
            raise FactusAPIError(
                "No se puede emitir documento soporte para un movimiento anulado.", status_code=400
            )
        concepto = mov.concepto or ""
        monto = Decimal(str(abs(mov.monto)))
        beneficiario = mov.beneficiario or ""
        btipo = mov.beneficiario_tipo_identificacion
        bnum = mov.beneficiario_numero_identificacion
        pay_code = _metodo_pago_codigo_tesoreria(mov.metodo_pago)
    else:
        raise FactusAPIError("Módulo inválido.", status_code=400)

    if monto <= 0:
        raise FactusAPIError("El monto del egreso debe ser mayor a cero.", status_code=400)

    try:
        addr, mail_prov, phone, mid_prov = normalizar_y_validar_contacto_proveedor_documento_soporte(
            direccion=getattr(mov, "beneficiario_direccion", None),
            email=getattr(mov, "beneficiario_email", None),
            telefono=getattr(mov, "beneficiario_telefono", None),
            factus_municipality_id=getattr(mov, "beneficiario_factus_municipality_id", None),
        )
    except ValueError as e:
        raise FactusAPIError(str(e), status_code=400) from e

    try:
        provider = _provider_payload_support(
            beneficiario=beneficiario,
            beneficiario_tipo=btipo,
            beneficiario_numero=bnum,
            address=addr,
            email=mail_prov,
            phone=phone,
            municipality_id=mid_prov,
        )
    except ValueError as e:
        raise FactusAPIError(str(e), status_code=400) from e

    ref = build_reference_code_documento_soporte(modulo, movimiento_id)
    items = _items_documento_soporte(
        ref_code=ref,
        concepto=concepto,
        monto=monto,
        beneficiario=beneficiario,
    )
    observation = f"{concepto[:180]} | Ref interna {modulo} {movimiento_id.hex[:8]}"

    cid, sec_enc, user, pwd_enc = active_auth_encrypted(fs)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    pwd = decrypt_secret(pwd_enc) if pwd_enc else None
    if not cid or not secret or not user or not pwd:
        raise FactusAPIError(
            "Credenciales Factus incompletas para el ambiente configurado.",
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

    numbering_id = _resolve_documento_soporte_numbering_range_id(
        fs=fs, base_url=base, access_token=access
    )

    notificar_factus = fs.documento_soporte_notificar_proveedor_factus is not False

    sede = _sede_documento_soporte(db, tenant=tenant, modulo=modulo, mov=mov)
    mid_est = _resolve_municipality_id(sede, tenant)
    addr_est = _resolve_establishment_address(sede, tenant)
    establishment = _establishment_payload(
        tenant, sede, municipality_id=mid_est, address=addr_est
    )

    # Igual que factura 01: `establishment` lleva nombre, dirección, municipio y contacto del tenant/sede en CDASOFT.
    # El NIT tributario del adquiriente y la resolución de numeración siguen ligados al contribuyente habilitado en Factus
    # (credenciales); en producción ese contribuyente debe ser el mismo CDA (Organización → NIT y datos en Factus).
    body: dict[str, Any] = {
        "reference_code": ref[:50],
        "numbering_range_id": numbering_id,
        "payment_method_code": pay_code,
        "observation": observation[:250],
        "establishment": establishment,
        "provider": provider,
        "items": items,
        "send_email": bool(notificar_factus and email_valido_factus(mail_prov)),
    }

    resp = validate_support_document(base_url=base, access_token=access, body=body)
    doc = _document_from_support_validate_response(resp)
    numero = _resolver_numero_visible_documento_soporte(doc)
    cuds = str(doc.get("cuds") or doc.get("cufe") or "").strip()
    public_url = _resolver_public_url_documento_soporte(resp, doc)
    factus_id = doc.get("id")

    row = DocumentoSoporteElectronico(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        source_module=modulo,
        movimiento_id=movimiento_id,
        reference_code=ref[:120],
        factus_document_id=int(factus_id) if factus_id is not None else None,
        numero_documento=numero[:80] if numero else None,
        cuds=cuds[:200] if cuds else None,
        public_url=public_url[:800] if public_url else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    copy_cda = (getattr(fs, "documento_soporte_correo_notificacion_cda", None) or "").strip()
    if copy_cda and email_valido_factus(copy_cda):
        try:
            _enviar_correo_copia_cda_documento_soporte(
                destinatario=copy_cda,
                tenant=tenant,
                numero_documento=numero[:80] if numero else "",
                public_url=public_url[:800] if public_url else "",
                reference_code=ref[:120],
            )
        except Exception:
            _log_ds.exception(
                "documento_soporte: no se pudo enviar copia SMTP al correo CDA (%s)",
                copy_cda,
            )

    return row
