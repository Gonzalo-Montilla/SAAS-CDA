"""

Configuración y pruebas de integración Factus (facturación electrónica DIAN).

Lectura del modo para usuarios del tenant. La edición completa (credenciales) sigue en backoffice SaaS;
el administrador del CDA puede cambiar solo el modo (manual vs Factus) vía PATCH /settings/modo.

"""

from __future__ import annotations



import base64
from typing import Literal, Optional, Any
from uuid import UUID

import httpx

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.orm import Session

from app.core.deps import (
    get_admin,
    get_cajero_contador_or_admin,
    get_contador_or_admin,
    get_current_user,
    get_db,
)
from app.utils.factus_validators import email_valido_factus as _email_valido_factus

from app.integrations.factus_client import (
    FactusAPIError,
    factus_base_url,
    format_factus_error_for_user,
    get_bill_show,
    download_support_document_pdf_resolved,
    obtain_token,
)

from app.integrations.factus_support_emit import (
    emitir_documento_soporte_desde_movimiento,
    resolver_y_guardar_public_url_documento_soporte,
)
from app.models.factus import DocumentoSoporteElectronico
from app.models.tenant import Tenant
from app.models.usuario import Usuario

from app.core.factus_crypto import decrypt_secret

from app.schemas.factus import (
    FactusDocumentoSoporteNotificacionesPatch,
    FactusModoPatch,
    FactusMunicipalityItem,
    FactusNumberingRangeItem,
    FactusSettingsOut,
    FactusTestConnectionResult,
)

from app.services.factus_tenant_settings import (
    active_auth_encrypted,
    creds_complete_for_active_env,
    get_or_create_settings_row,
    list_municipalities_for_tenant,
    list_numbering_ranges_for_tenant,
    row_to_out,
    run_test_connection,
)



router = APIRouter()





@router.get("/settings", response_model=FactusSettingsOut)

def get_factus_settings(

    db: Session = Depends(get_db),

    current_user: Usuario = Depends(get_current_user),

):

    """Lectura para cualquier usuario del tenant (p. ej. caja: modo manual vs Factus)."""

    row = get_or_create_settings_row(db, current_user.tenant_id)

    return row_to_out(row)


@router.patch("/settings/documento-soporte-notificaciones", response_model=FactusSettingsOut)
def patch_factus_documento_soporte_notificaciones(
    body: FactusDocumentoSoporteNotificacionesPatch,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Notificación al proveedor vía Factus (send_email) y copia interna del CDA vía SMTP al emitir documento soporte.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    row.documento_soporte_notificar_proveedor_factus = bool(body.documento_soporte_notificar_proveedor_factus)
    raw = body.documento_soporte_correo_notificacion_cda
    if raw is None or not str(raw).strip():
        row.documento_soporte_correo_notificacion_cda = None
    else:
        ce = str(raw).strip().lower()
        if not _email_valido_factus(ce):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El correo de notificación interna no es válido.",
            )
        row.documento_soporte_correo_notificacion_cda = ce[:255]
    db.commit()
    db.refresh(row)
    return row_to_out(row)


@router.patch("/settings/modo", response_model=FactusSettingsOut)
def patch_factus_modo(
    body: FactusModoPatch,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Conmutar solo entre facturación manual y Factus (administrador del CDA).

    Útil si Factus rechaza cobros (p. ej. factura pendiente DIAN) y no hay soporte SaaS:
    pasar a manual permite que caja ingrese el número DIAN a mano hasta regularizar Factus.
    Volver a «factus» cuando el servicio esté estable.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    row.modo = body.modo
    db.commit()
    db.refresh(row)
    return row_to_out(row)


@router.get("/municipalities", response_model=list[FactusMunicipalityItem])
def get_factus_municipalities(
    name: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_contador_or_admin),
):
    """
    Proxy a GET /v1/municipalities con token del ambiente Factus activo del CDA.
    Guarde el `id` de la fila elegida (no el código DIAN `code`).
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return list_municipalities_for_tenant(row, name=name)


@router.get("/numbering-ranges", response_model=list[FactusNumberingRangeItem])
def get_factus_numbering_ranges(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Rangos de numeración en Factus para el ambiente activo (mismas credenciales que backoffice).
    El `id` es el que se guarda por sede o como predeterminado del tenant.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return list_numbering_ranges_for_tenant(row)


@router.post("/test-connection", response_model=FactusTestConnectionResult)
def post_factus_test_connection(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Prueba OAuth contra Factus con las credenciales guardadas para este CDA (mismo criterio que backoffice SaaS).
    Requiere modo «factus» y credenciales completas.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return run_test_connection(row)


@router.get("/bills/{number}")

def consultar_factura_factus(

    number: str,

    db: Session = Depends(get_db),

    current_user: Usuario = Depends(get_current_user),

):

    """

    Cuerpo **real** de la factura en Factus (no el recibo PDF de caja): `data.customer` (nombre,

    identificación, email, teléfono), `data.bill`, `data.items`, CUFE, totales.

    Documentación Factus: GET `/v1/bills/show/:number`.

    """

    row = get_or_create_settings_row(db, current_user.tenant_id)

    if not creds_complete_for_active_env(row):
        env = "pruebas (sandbox)" if row.use_sandbox else "producción"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configure credenciales Factus completas para el ambiente activo ({env}).",
        )

    cid, sec_enc, user, pwd_enc = active_auth_encrypted(row)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    password = decrypt_secret(pwd_enc) if pwd_enc else None
    if not secret or not password or not cid or not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudieron descifrar las credenciales. Vuelve a guardarlas.",
        )

    base = factus_base_url(use_sandbox=row.use_sandbox)

    try:

        tok = obtain_token(

            base_url=base,

            client_id=cid,

            client_secret=secret,

            username=user,

            password=password,

        )

    except FactusAPIError as e:

        detail = "Error al conectar con Factus."

        if isinstance(e.body, dict) and e.body.get("message"):

            detail = str(e.body.get("message"))

        elif isinstance(e.body, dict) and e.body.get("error_description"):

            detail = str(e.body.get("error_description"))

        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from e



    access = tok.get("access_token")

    if not access:

        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Token Factus sin access_token")



    num = (number or "").strip()

    if not num:

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Número de factura vacío.")



    try:

        return get_bill_show(base_url=base, access_token=access, number=num)

    except FactusAPIError as e:

        detail = str(e)

        if isinstance(e.body, dict):

            detail = str(

                e.body.get("message")

                or e.body.get("error_description")

                or e.body.get("error")

                or detail

            )

        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY

        raise HTTPException(status_code=code, detail=detail) from e


class DocumentoSoporteEmitirIn(BaseModel):
    """Cuerpo POST JSON: ignorar campos extra del cliente; UUID flexible desde string."""

    model_config = ConfigDict(extra="ignore")

    modulo: Literal["caja", "tesoreria"]
    movimiento_id: UUID

    @field_validator("movimiento_id", mode="before")
    @classmethod
    def _parse_movimiento_uuid(cls, v):
        if v is None or v == "":
            raise ValueError("movimiento_id es obligatorio")
        if isinstance(v, UUID):
            return v
        return UUID(str(v).strip())


class DocumentoSoporteEmitirOut(BaseModel):
    numero_documento: Optional[str] = None
    public_url: Optional[str] = None
    reference_code: str


class DocumentoSoporteEnlaceOut(BaseModel):
    public_url: str


def _try_fetch_pdf_bytes_from_json_urls(payload: dict[str, Any], access_token: str) -> Optional[bytes]:
    """Si Factus devuelve JSON con URL directa al PDF, descargarla (p. ej. enlace firmado)."""
    found: list[str] = []

    def collect(obj: object) -> None:
        if isinstance(obj, str) and obj.strip().startswith("http"):
            found.append(obj.strip())
        elif isinstance(obj, dict):
            for v in obj.values():
                collect(v)
        elif isinstance(obj, list):
            for v in obj:
                collect(v)

    collect(payload)
    seen: set[str] = set()
    for u in found:
        if u in seen:
            continue
        seen.add(u)
        lo = u.lower()
        if (lo.endswith(".json") or lo.endswith(".xml")) and "pdf" not in lo:
            continue
        try:
            headers: dict[str, str] = {}
            if "factus" in lo and ("api." in lo or "/v1/" in lo):
                headers["Authorization"] = f"Bearer {access_token}"
            with httpx.Client(timeout=90.0, follow_redirects=True) as client:
                r = client.get(u, headers=headers)
            if r.status_code < 400 and len(r.content) > 50 and r.content[:4] == b"%PDF":
                return r.content
        except Exception:
            continue
    return None


def _find_pdf_base64_in_payload(obj: object) -> str | None:
    """Busca recursivamente un string base64 de PDF en la respuesta Factus."""
    if isinstance(obj, dict):
        for k in ("pdf_base64", "file", "base64_document", "pdf", "document_base64", "base64"):
            v = obj.get(k)
            if isinstance(v, str) and len(v) > 80:
                return v
        for v in obj.values():
            hit = _find_pdf_base64_in_payload(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = _find_pdf_base64_in_payload(v)
            if hit:
                return hit
    return None


def _pdf_bytes_from_factus_support_download(payload: dict) -> tuple[bytes, str]:
    inner = payload.get("data")
    block = inner if isinstance(inner, dict) else payload
    b64 = block.get("pdf_base64") or block.get("file") or block.get("base64_document")
    if not b64 and isinstance(block.get("pdf"), str):
        b64 = block["pdf"]
    if not b64:
        b64 = _find_pdf_base64_in_payload(payload)
    if not b64:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Factus no devolvió el PDF del documento soporte (base64).",
        )
    try:
        raw = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo decodificar el PDF devuelto por Factus.",
        ) from exc
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="PDF vacío desde Factus.",
        )
    fname = block.get("file_name") or block.get("filename") or "documento_soporte.pdf"
    return raw, str(fname)


@router.post("/documentos-soporte/emitir", response_model=DocumentoSoporteEmitirOut)
def post_documento_soporte_emitir(
    body: DocumentoSoporteEmitirIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Emite documento soporte electrónico (DIAN) en Factus para un egreso de caja o tesorería.
    Solo contador o administrador. Una emisión por movimiento (idempotente en backend).
    """
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organización no encontrada.")
    row_settings = get_or_create_settings_row(db, current_user.tenant_id)
    try:
        doc_row = emitir_documento_soporte_desde_movimiento(
            db,
            tenant=tenant,
            fs=row_settings,
            modulo=body.modulo,
            movimiento_id=body.movimiento_id,
        )
    except FactusAPIError as e:
        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=format_factus_error_for_user(e)) from e
    return DocumentoSoporteEmitirOut(
        numero_documento=doc_row.numero_documento,
        public_url=doc_row.public_url,
        reference_code=doc_row.reference_code,
    )


@router.get(
    "/documentos-soporte/enlace-publico/{modulo}/{movimiento_id}",
    response_model=DocumentoSoporteEnlaceOut,
)
def get_documento_soporte_enlace_publico(
    modulo: str,
    movimiento_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """
    Devuelve la URL del visor Factus/DIAN. Si no está en BD, la pide con GET support-documents/show y la guarda.
    """
    if modulo not in ("caja", "tesoreria"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El módulo debe ser «caja» o «tesoreria».",
        )
    ds = (
        db.query(DocumentoSoporteElectronico)
        .filter(
            DocumentoSoporteElectronico.tenant_id == current_user.tenant_id,
            DocumentoSoporteElectronico.source_module == modulo,
            DocumentoSoporteElectronico.movimiento_id == movimiento_id,
        )
        .first()
    )
    if not ds:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay documento soporte emitido para este movimiento.",
        )
    row_settings = get_or_create_settings_row(db, current_user.tenant_id)
    url = resolver_y_guardar_public_url_documento_soporte(db, fs=row_settings, ds=ds)
    if not url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "No se pudo obtener el enlace público desde Factus. "
                "Abra el documento en el panel Factus o revise credenciales y ambiente (sandbox/producción)."
            ),
        )
    return DocumentoSoporteEnlaceOut(public_url=url)


@router.get("/documentos-soporte/pdf/{modulo}/{movimiento_id}")
def get_documento_soporte_pdf(
    modulo: str,
    movimiento_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    """Descarga el PDF del documento soporte ya emitido (proxy Factus)."""
    if modulo not in ("caja", "tesoreria"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El módulo debe ser «caja» o «tesoreria».",
        )
    ds = (
        db.query(DocumentoSoporteElectronico)
        .filter(
            DocumentoSoporteElectronico.tenant_id == current_user.tenant_id,
            DocumentoSoporteElectronico.source_module == modulo,
            DocumentoSoporteElectronico.movimiento_id == movimiento_id,
        )
        .first()
    )
    if not ds:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay documento soporte emitido para este movimiento.",
        )
    tiene_ref = bool(
        (ds.numero_documento or "").strip()
        or ds.factus_document_id is not None
        or (ds.cuds or "").strip()
    )
    if not tiene_ref:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento soporte sin número ni id Factus guardados; vuelva a emitir o revise en Factus.",
        )
    row_settings = get_or_create_settings_row(db, current_user.tenant_id)
    if not creds_complete_for_active_env(row_settings):
        env = "pruebas (sandbox)" if row_settings.use_sandbox else "producción"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configure credenciales Factus completas para el ambiente activo ({env}).",
        )
    cid, sec_enc, user, pwd_enc = active_auth_encrypted(row_settings)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    password = decrypt_secret(pwd_enc) if pwd_enc else None
    if not secret or not password or not cid or not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudieron descifrar las credenciales. Vuelve a guardarlas.",
        )
    base = factus_base_url(use_sandbox=row_settings.use_sandbox)
    try:
        tok = obtain_token(
            base_url=base,
            client_id=cid,
            client_secret=secret,
            username=user,
            password=password,
        )
    except FactusAPIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=format_factus_error_for_user(e),
        ) from e
    access = tok.get("access_token")
    if not access:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Token Factus sin access_token")
    try:
        raw_out = download_support_document_pdf_resolved(
            base_url=base,
            access_token=access,
            numero_documento=(ds.numero_documento or "").strip() or None,
            factus_document_id=ds.factus_document_id,
            cuds=(ds.cuds or "").strip() or None,
        )
    except FactusAPIError as e:
        raise HTTPException(
            status_code=e.status_code if e.status_code and 100 <= e.status_code < 600 else 502,
            detail=format_factus_error_for_user(e),
        ) from e
    if isinstance(raw_out, (bytes, bytearray)):
        pdf_bytes = bytes(raw_out)
        safe_name = f"documento_soporte_{movimiento_id.hex[:8]}.pdf"
    else:
        fetched_url_pdf = _try_fetch_pdf_bytes_from_json_urls(raw_out, access)
        if fetched_url_pdf:
            pdf_bytes = fetched_url_pdf
            safe_name = f"documento_soporte_{movimiento_id.hex[:8]}.pdf"
        else:
            pdf_bytes, filename = _pdf_bytes_from_factus_support_download(raw_out)
            safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ") or "documento_soporte.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{safe_name}"',
        },
    )

