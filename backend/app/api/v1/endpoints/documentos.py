"""
Documentos del tenant: listado, carga y descarga autenticada.

Trazabilidad y lineamientos de seguridad de la información: ver
``backend/docs/NTC5385_modulo_documental.md`` (NTC 5385, referencia NTC-ISO/IEC 27002).
"""
import html
import logging
import os
import uuid
import hashlib
from urllib.parse import quote
from datetime import date, datetime, time, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_admin, get_current_user, get_db
from app.core.timezone_utils import get_app_timezone
from app.models.documento_auditoria import TenantDocumentoAuditoria
from app.models.documento_tenant import TenantDocumento
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.schemas.documento import (
    CertificacionCuentaVerificacionResponse,
    DocumentoAuditoriaPageResponse,
    DocumentoAuditoriaResponse,
    DocumentoMetadataUpdate,
    DocumentoResponse,
)
from app.services.documento_preview import PREVIEW_OFFICE_EXTENSIONS, schedule_preview_build, try_generate_preview_pdf
from app.utils.certificacion_cuenta_pdf import (
    CertificacionDocumentoItem,
    _sello_electronico_hex,
    generar_certificacion_en_cuenta_pdf,
)

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_DOC_EXTENSIONS = frozenset({
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".txt",
    ".csv",
})


def _storage_dir() -> Path:
    return Path(settings.DOCUMENTOS_STORAGE_DIR)


def _abs_path(relpath: str) -> Path:
    root = _storage_dir().resolve()
    rel = (relpath or "").replace("\\", "/").lstrip("/")
    path = (root / rel).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ruta de documento inválida.",
        )
    return path


def _parse_sucursal_id(db: Session, tenant_id: UUID, raw: str | None) -> UUID | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        sid = UUID(str(raw).strip())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Identificador de sede inválido.",
        )
    suc = db.query(Sucursal).filter(Sucursal.id == sid, Sucursal.tenant_id == tenant_id).first()
    if not suc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La sede indicada no pertenece a su organización.",
        )
    return sid


def _normalize_categoria(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    return s[:120]


def _parse_sustituye_id(raw: str | None) -> UUID | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        return UUID(str(raw).strip())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Identificador de documento a sustituir inválido.",
        )


def _log_documento_auditoria(
    db: Session,
    *,
    tenant_id: UUID,
    documento_id: UUID | None,
    usuario_id: UUID | None,
    accion: str,
    detalle: str | None = None,
) -> None:
    """Registro de auditoría; no hace commit."""
    d = (detalle or "")[:4000] or None
    db.add(
        TenantDocumentoAuditoria(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            documento_id=documento_id,
            usuario_id=usuario_id,
            accion=accion[:40],
            detalle=d,
        )
    )


def _sha256_file_hex(path: Path) -> str | None:
    if not path.is_file():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _parse_certificacion_detalle(detalle: str | None) -> tuple[int | None, bool | None, str | None]:
    raw = (detalle or "").strip()
    if not raw:
        return None, None, None
    parts = [p.strip() for p in raw.split("|")]
    docs_val = None
    hash_val = None
    sello_val = None
    for p in parts:
        if p.startswith("docs="):
            try:
                docs_val = int(p.split("=", 1)[1].strip())
            except ValueError:
                docs_val = None
        elif p.startswith("hash="):
            v = p.split("=", 1)[1].strip().lower()
            if v in {"si", "sí", "true", "1"}:
                hash_val = True
            elif v in {"no", "false", "0"}:
                hash_val = False
        elif p.startswith("sello="):
            sello_val = p.split("=", 1)[1].strip() or None
    return docs_val, hash_val, sello_val


def _accept_prefiere_html(accept: str | None) -> bool:
    if not accept:
        return False
    a = accept.lower()
    return "text/html" in a or "application/xhtml+xml" in a


def _verificacion_usar_html(
    *,
    vista: bool,
    formato: str | None,
    accept: str | None,
) -> bool:
    """Página legible: explícito (vista/formato) o navegador típico vía Accept."""
    f = (formato or "").strip().lower()
    if f == "json":
        return False
    if f == "html":
        return True
    if vista:
        return True
    return _accept_prefiere_html(accept)


def _verificacion_entregar(
    payload: CertificacionCuentaVerificacionResponse,
    *,
    organizacion_nombre: str | None,
    usar_html: bool,
) -> HTMLResponse | CertificacionCuentaVerificacionResponse:
    if usar_html:
        return HTMLResponse(
            content=_html_verificacion_certificacion(payload=payload, organizacion_nombre=organizacion_nombre),
            status_code=200,
            media_type="text/html; charset=utf-8",
        )
    return payload


def _html_verificacion_certificacion(
    *,
    payload: CertificacionCuentaVerificacionResponse,
    organizacion_nombre: str | None,
) -> str:
    """Página pública legible en navegador (sin JSON), alineada a identidad CDASOFT."""
    e = html.escape
    ok = payload.valido
    badge_bg = "#dcfce7" if ok else "#fee2e2"
    badge_fg = "#166534" if ok else "#991b1b"
    badge_tx = "Certificación verificada" if ok else "No es posible verificar esta certificación"
    org = e(organizacion_nombre.strip()) if (organizacion_nombre and organizacion_nombre.strip()) else None
    slug = e(payload.tenant_slug or "")
    code = e(payload.codigo)
    detalle_err = e((payload.detalle or "").strip()) if not ok else ""
    consulta = ""
    if not ok:
        consulta = f"""
        <dl class="grid">
          <dt>Identificador de cuenta (slug)</dt><dd><code>{slug}</code></dd>
          <dt>Código consultado</dt><dd><code class="codigo">{code}</code></dd>
        </dl>
        """
    err_block = f'<p class="err">{detalle_err}</p>' if (not ok and detalle_err) else ""

    bloque_extra = ""
    if ok and payload.generated_at:
        gen = payload.generated_at
        fecha_txt = gen.strftime("%d/%m/%Y %H:%M:%S")
        if gen.tzinfo is not None:
            fecha_txt += f" ({gen.tzname() or 'UTC'})"
        docs_n = payload.total_documentos_certificados
        docs_txt = str(docs_n) if docs_n is not None else "—"
        hash_txt = (
            "Sí (SHA-256 por archivo, cuando el archivo estaba disponible)"
            if payload.hash_incluido is True
            else ("No" if payload.hash_incluido is False else "—")
        )
        sello = e(payload.sello_electronico) if payload.sello_electronico else "—"
        doc_ref = ""
        if payload.documento_titulo or payload.documento_nombre_archivo:
            t = e(payload.documento_titulo or "")
            n = e(payload.documento_nombre_archivo or "")
            doc_ref = f"<p class='muted doc-ref'>Archivo de respaldo en biblioteca: <strong>{t}</strong> — {n}</p>"

        bloque_extra = f"""
        <dl class="grid">
          <dt>Organización</dt><dd>{org or slug}</dd>
          <dt>Identificador de cuenta (slug)</dt><dd><code>{slug}</code></dd>
          <dt>Código de verificación</dt><dd><code class="codigo">{code}</code></dd>
          <dt>Generada</dt><dd>{e(fecha_txt)}</dd>
          <dt>Documentos certificados</dt><dd>{e(docs_txt)}</dd>
          <dt>Huellas en PDF</dt><dd>{e(hash_txt)}</dd>
          <dt>Sello electrónico (PDF)</dt><dd><code class="sello">{sello}</code></dd>
        </dl>
        {doc_ref}
        <p class="muted small legal">
          Este resultado confirma que consta un registro de emisión en el sistema CDASOFT para el código indicado.
          Compare el código y el sello con su PDF. PROMETHEUS TECH SAS / CDASOFT no validan el contenido de los archivos certificados.
        </p>
        """
    elif ok:
        bloque_extra = "<p class='muted'>Registro encontrado; faltan algunos metadatos para mostrar.</p>"

    base_url = (settings.BACKEND_PUBLIC_BASE_URL or "").strip().rstrip("/")
    favicon_link = ""
    logo_block = ""
    if base_url:
        favicon_href = f"{base_url}/cdasoft-favicon.png"
        logo_src = f"{base_url}/cdasoft-brand-logo.png"
        favicon_link = f'  <link rel="icon" type="image/png" href="{e(favicon_href)}" />'
        logo_block = f"""
      <div class="header-brand-row">
        <img src="{e(logo_src)}" alt="CDASOFT" class="header-logo-full" width="280" height="140" loading="lazy" />
        <div class="header-titles">
          <p class="header-sub">Verificación pública · Certificación en cuenta</p>
        </div>
      </div>"""

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f8fbff" />
{favicon_link}
  <title>{e("CDASOFT - sistema integral para administracion de cda · Verificación")}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {{
      --navy: #0a1d3d;
      --slate: #64748b;
      --border: #d9e2ef;
      font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
      color: #0f172a;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(1200px 500px at 10% -10%, rgba(37, 99, 235, 0.14), transparent 60%),
        radial-gradient(900px 420px at 95% 0%, rgba(14, 165, 233, 0.12), transparent 60%),
        linear-gradient(180deg, #f8fbff 0%, #f1f5fb 45%, #eef3f9 100%);
    }}
    .site-header {{
      position: sticky;
      top: 0;
      z-index: 40;
      background-color: rgba(255, 255, 255, 0.92);
      border-bottom: 1px solid rgba(217, 226, 239, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }}
    .site-header-inner {{
      max-width: 80rem;
      margin: 0 auto;
      padding: 0.75rem 1rem;
    }}
    @media (min-width: 640px) {{
      .site-header-inner {{ padding: 1rem 1.5rem; }}
    }}
    .header-brand-row {{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      text-align: center;
    }}
    @media (min-width: 640px) {{
      .header-brand-row {{
        flex-direction: row;
        align-items: center;
        text-align: left;
        gap: 1.25rem;
      }}
    }}
    .header-logo-full {{
      height: 5rem;
      width: auto;
      max-width: min(320px, 90vw);
      object-fit: contain;
      object-position: center;
      border-radius: 1rem;
      box-shadow: 0 10px 30px -18px rgba(15, 23, 42, 0.35);
    }}
    @media (min-width: 640px) {{
      .header-logo-full {{ height: 5.5rem; max-width: 340px; }}
    }}
    .header-titles {{ min-width: 0; }}
    .header-sub {{
      margin: 0.25rem 0 0 0;
      font-size: 0.875rem;
      color: var(--slate);
      font-weight: 500;
    }}
    .main-wrap {{
      flex: 1;
      width: 100%;
      padding: 2rem 1rem 2.5rem;
    }}
    .wrap {{ max-width: 80rem; margin: 0 auto; }}
    .card {{
      background: rgba(255, 255, 255, 0.94);
      border-radius: 1rem;
      border: 1px solid var(--border);
      box-shadow: 0 10px 30px -18px rgba(15, 23, 42, 0.35);
      padding: 1.5rem 1.5rem 1.75rem;
    }}
    @media (min-width: 640px) {{
      .card {{ padding: 1.75rem 2rem 2rem; border-radius: 1.15rem; }}
    }}
    .badge {{
      display: inline-block;
      padding: .4rem .85rem;
      border-radius: 999px;
      font-weight: 600;
      font-size: .82rem;
      background: {badge_bg};
      color: {badge_fg};
      margin-bottom: 1rem;
    }}
    h1 {{
      font-size: 1.125rem;
      font-weight: 700;
      margin: 0 0 1rem 0;
      color: var(--navy);
      letter-spacing: -0.02em;
    }}
    .grid {{
      display: grid;
      grid-template-columns: 10rem 1fr;
      gap: .55rem .85rem;
      font-size: .9rem;
      margin: 1rem 0;
    }}
    @media (max-width: 520px) {{
      .grid {{ grid-template-columns: 1fr; gap: .25rem; }}
      .grid dt {{ padding-top: .5rem; border-top: 1px solid #e2e8f0; }}
      .grid dt:first-child {{ border-top: none; padding-top: 0; }}
    }}
    dt {{ color: var(--slate); font-weight: 600; font-size: .82rem; }}
    dd {{ margin: 0; color: #0f172a; }}
    code {{
      font-size: .82rem;
      background: #f8fafc;
      padding: .15rem .4rem;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }}
    code.codigo, code.sello {{
      display: inline-block;
      word-break: break-all;
      font-size: .78rem;
      line-height: 1.35;
    }}
    .muted {{ color: var(--slate); }}
    .doc-ref {{ margin-top: 1rem; font-size: .88rem; line-height: 1.45; }}
    .small {{ font-size: .8rem; line-height: 1.45; }}
    .legal {{ margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; }}
    .err {{ color: #991b1b; font-size: .9rem; margin-top: .75rem; }}
    .site-footer {{
      text-align: center;
      font-size: .75rem;
      color: #94a3b8;
      padding: 1rem 1.25rem 1.5rem;
    }}
    .site-footer strong {{ color: var(--slate); font-weight: 600; }}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-header-inner">
      {logo_block if logo_block else '<div class="header-brand-row"><p class="header-sub">CDASOFT · Verificación pública</p></div>'}
    </div>
  </header>
  <main class="main-wrap">
    <div class="wrap">
      <div class="card">
        <div class="badge">{e(badge_tx)}</div>
        <h1>Verificación de certificación en cuenta</h1>
        {consulta}
        {err_block}
        {bloque_extra}
      </div>
    </div>
  </main>
  <footer class="site-footer">
    <strong>CDASOFT</strong> · Sistema integral para administración de CDA · Resultado de verificación
  </footer>
</body>
</html>"""


@router.get("/auditoria", response_model=DocumentoAuditoriaPageResponse)
def listar_auditoria_documentos(
    skip: int = 0,
    limit: int = 50,
    q: str | None = Query(default=None, max_length=200),
    accion: str | None = Query(default=None, max_length=40),
    fecha_inicio: date | None = Query(default=None),
    fecha_fin: date | None = Query(default=None),
    sort: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    """Historial de acciones (solo administrador). Util para evidencias ante auditoria."""
    if limit > settings.MAX_PAGE_SIZE:
        limit = settings.MAX_PAGE_SIZE
    if skip < 0:
        skip = 0
    if fecha_inicio and fecha_fin and fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_inicio no puede ser mayor que fecha_fin",
        )

    rows_q = (
        db.query(
            TenantDocumentoAuditoria,
            Usuario.nombre_completo,
            Usuario.email,
        )
        .outerjoin(Usuario, TenantDocumentoAuditoria.usuario_id == Usuario.id)
        .filter(TenantDocumentoAuditoria.tenant_id == admin.tenant_id)
    )

    if accion and accion.strip():
        rows_q = rows_q.filter(TenantDocumentoAuditoria.accion == accion.strip()[:40])

    if fecha_inicio is not None:
        rows_q = rows_q.filter(TenantDocumentoAuditoria.created_at >= datetime.combine(fecha_inicio, time.min))
    if fecha_fin is not None:
        rows_q = rows_q.filter(TenantDocumentoAuditoria.created_at <= datetime.combine(fecha_fin, time.max))

    search_text = (q or "").strip()
    if search_text:
        term = f"%{search_text}%"
        rows_q = rows_q.filter(
            or_(
                TenantDocumentoAuditoria.detalle.ilike(term),
                Usuario.nombre_completo.ilike(term),
                Usuario.email.ilike(term),
            )
        )

    total = rows_q.count()

    if sort == "asc":
        rows_q = rows_q.order_by(TenantDocumentoAuditoria.created_at.asc())
    else:
        rows_q = rows_q.order_by(TenantDocumentoAuditoria.created_at.desc())

    rows = rows_q.offset(skip).limit(limit).all()
    items = [
        DocumentoAuditoriaResponse(
            id=ev.id,
            tenant_id=ev.tenant_id,
            documento_id=ev.documento_id,
            usuario_id=ev.usuario_id,
            usuario_nombre=nombre,
            usuario_email=email,
            accion=ev.accion,
            detalle=ev.detalle,
            created_at=ev.created_at,
        )
        for ev, nombre, email in rows
    ]
    return DocumentoAuditoriaPageResponse(items=items, total=total, skip=skip, limit=limit)


def _resolver_verificacion_certificacion_cuenta(
    db: Session,
    request: Request,
    *,
    tenant_slug: str,
    codigo: str,
    vista: bool = False,
    formato: str | None = None,
) -> HTMLResponse | CertificacionCuentaVerificacionResponse:
    """Lógica compartida: consulta ?… y ruta corta /v/{slug}/{codigo}."""
    usar_html = _verificacion_usar_html(
        vista=vista,
        formato=formato,
        accept=request.headers.get("accept"),
    )
    slug = tenant_slug.strip()
    code = codigo.strip()
    if not slug or not code:
        bad = CertificacionCuentaVerificacionResponse(
            tenant_slug=slug or None,
            codigo=code or "",
            valido=False,
            detalle="Parámetros inválidos: indique organización (slug) y código de verificación.",
        )
        if usar_html:
            return _verificacion_entregar(bad, organizacion_nombre=None, usar_html=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parámetros inválidos.")

    tenant = (
        db.query(Tenant)
        .filter(Tenant.slug == slug, Tenant.activo.is_(True))
        .first()
    )
    if not tenant:
        tenant = (
            db.query(Tenant)
            .filter(func.lower(Tenant.slug) == slug.lower(), Tenant.activo.is_(True))
            .first()
        )
    if not tenant:
        out = CertificacionCuentaVerificacionResponse(
            tenant_slug=slug,
            codigo=code,
            valido=False,
            detalle="Organización no encontrada o inactiva.",
        )
        return _verificacion_entregar(out, organizacion_nombre=None, usar_html=usar_html)

    ev = (
        db.query(TenantDocumentoAuditoria)
        .filter(
            TenantDocumentoAuditoria.tenant_id == tenant.id,
            TenantDocumentoAuditoria.accion == "certificacion_cuenta",
            TenantDocumentoAuditoria.detalle.ilike(f"{code}%"),
        )
        .order_by(TenantDocumentoAuditoria.created_at.desc())
        .first()
    )
    org = tenant.nombre_comercial or tenant.nombre
    if not ev:
        out = CertificacionCuentaVerificacionResponse(
            tenant_slug=tenant.slug,
            codigo=code,
            valido=False,
            detalle="No se encontró una certificación asociada al código suministrado.",
        )
        return _verificacion_entregar(out, organizacion_nombre=org, usar_html=usar_html)

    doc = None
    if ev.documento_id:
        doc = (
            db.query(TenantDocumento)
            .filter(
                TenantDocumento.id == ev.documento_id,
                TenantDocumento.tenant_id == tenant.id,
            )
            .first()
        )
    total_docs, hash_incluido, sello_val = _parse_certificacion_detalle(ev.detalle)
    out = CertificacionCuentaVerificacionResponse(
        tenant_slug=tenant.slug,
        codigo=code,
        valido=True,
        generated_at=ev.created_at,
        documento_id=ev.documento_id,
        documento_titulo=doc.titulo if doc else None,
        documento_nombre_archivo=doc.nombre_archivo_original if doc else None,
        total_documentos_certificados=total_docs,
        hash_incluido=hash_incluido,
        sello_electronico=sello_val,
        detalle=ev.detalle,
    )
    return _verificacion_entregar(out, organizacion_nombre=org, usar_html=usar_html)


@router.get("/certificacion-en-cuenta/v/{tenant_slug}/{codigo}")
def verificar_certificacion_en_cuenta_por_ruta(
    request: Request,
    tenant_slug: str,
    codigo: str,
    vista: bool = Query(
        False,
        description="Si es true, fuerza página HTML (el PDF incluye vista=1).",
    ),
    formato: str | None = Query(
        None,
        description="Forzar salida: json o html.",
        max_length=12,
    ),
    db: Session = Depends(get_db),
):
    """
    Enlace corto para el PDF: evita URLs largas que se cortan al copiar desde el documento.
    Ejemplo: ``/documentos/certificacion-en-cuenta/v/mi-org/CDA-XXXX-20260415120000?vista=1``
    """
    return _resolver_verificacion_certificacion_cuenta(
        db,
        request,
        tenant_slug=tenant_slug,
        codigo=codigo,
        vista=vista,
        formato=formato,
    )


@router.get("/certificacion-en-cuenta/verificar")
def verificar_certificacion_en_cuenta(
    request: Request,
    tenant_slug: str = Query(..., min_length=1, max_length=120),
    codigo: str = Query(..., min_length=8, max_length=120),
    vista: bool = Query(
        False,
        description="Si es true, devuelve página HTML (el PDF incluye vista=1).",
    ),
    formato: str | None = Query(
        None,
        description="Forzar salida: json (API) o html (página). Si se omite, el navegador recibe HTML por Accept.",
        max_length=12,
    ),
    db: Session = Depends(get_db),
):
    """
    Verificación pública sin sesión (query string). Preferir ruta ``/v/{slug}/{codigo}`` en PDFs nuevos.
    """
    return _resolver_verificacion_certificacion_cuenta(
        db,
        request,
        tenant_slug=tenant_slug,
        codigo=codigo,
        vista=vista,
        formato=formato,
    )


@router.get("/categorias", response_model=list[str])
def listar_categorias_documentos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rows = (
        db.query(TenantDocumento.categoria)
        .filter(
            TenantDocumento.tenant_id == current_user.tenant_id,
            TenantDocumento.es_version_actual.is_(True),
            TenantDocumento.categoria.isnot(None),
        )
        .distinct()
        .all()
    )
    vals = sorted({r[0].strip() for r in rows if r[0] and r[0].strip()})
    return vals


@router.get("/", response_model=list[DocumentoResponse])
def listar_documentos(
    skip: int = 0,
    limit: int = 50,
    q: str | None = Query(default=None, max_length=200),
    categoria: str | None = Query(default=None, max_length=120),
    sucursal_id: UUID | None = Query(default=None),
    solo_esta_sede: bool = Query(default=False),
    solo_actuales: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if limit > settings.MAX_PAGE_SIZE:
        limit = settings.MAX_PAGE_SIZE

    query = db.query(TenantDocumento).filter(TenantDocumento.tenant_id == current_user.tenant_id)

    if solo_actuales:
        query = query.filter(TenantDocumento.es_version_actual.is_(True))

    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                TenantDocumento.titulo.ilike(term),
                TenantDocumento.nombre_archivo_original.ilike(term),
            )
        )

    if categoria and categoria.strip():
        query = query.filter(TenantDocumento.categoria == categoria.strip())

    if sucursal_id is not None:
        if solo_esta_sede:
            query = query.filter(TenantDocumento.sucursal_id == sucursal_id)
        else:
            query = query.filter(
                or_(
                    TenantDocumento.sucursal_id.is_(None),
                    TenantDocumento.sucursal_id == sucursal_id,
                )
            )

    rows = query.order_by(TenantDocumento.created_at.desc()).offset(skip).limit(limit).all()
    return rows


@router.post("/", response_model=DocumentoResponse, status_code=status.HTTP_201_CREATED)
def subir_documento(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    titulo: str | None = Form(default=None),
    categoria: str | None = Form(default=None),
    sucursal_id: str | None = Form(default=None),
    sustituye_a_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    raw_name = file.filename or "archivo"
    safe_base = os.path.basename(raw_name) or "archivo"
    extension = Path(safe_base).suffix.lower()
    if extension not in ALLOWED_DOC_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de archivo no permitido para este módulo.",
        )

    content = file.file.read()
    max_bytes = settings.DOCUMENTOS_MAX_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El archivo supera el límite de {settings.DOCUMENTOS_MAX_SIZE_MB} MB.",
        )

    mime = (file.content_type or "application/octet-stream").strip()[:200]

    upload_root = _storage_dir()
    tenant_folder = upload_root / str(current_user.tenant_id)
    tenant_folder.mkdir(parents=True, exist_ok=True)

    file_id = uuid.uuid4()
    stored_name = f"{file_id.hex}{extension}"
    relpath = f"{current_user.tenant_id}/{stored_name}"
    dest = tenant_folder / stored_name

    with open(dest, "wb") as out:
        out.write(content)

    sust_uuid = _parse_sustituye_id(sustituye_a_id)
    prev: TenantDocumento | None = None
    if sust_uuid is not None:
        prev = (
            db.query(TenantDocumento)
            .filter(
                TenantDocumento.id == sust_uuid,
                TenantDocumento.tenant_id == current_user.tenant_id,
            )
            .first()
        )
        if not prev:
            try:
                if dest.is_file():
                    dest.unlink()
            except OSError:
                pass
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El documento a sustituir no existe.",
            )

    if prev is not None:
        grupo_id = prev.grupo_id
        max_seq = (
            db.query(func.max(TenantDocumento.version_seq))
            .filter(
                TenantDocumento.grupo_id == grupo_id,
                TenantDocumento.tenant_id == current_user.tenant_id,
            )
            .scalar()
        )
        next_seq = (max_seq or 0) + 1
        (
            db.query(TenantDocumento)
            .filter(
                TenantDocumento.grupo_id == grupo_id,
                TenantDocumento.tenant_id == current_user.tenant_id,
            )
            .update(
                {TenantDocumento.es_version_actual: False},
                synchronize_session=False,
            )
        )
        display_titulo = (titulo or "").strip() or prev.titulo or safe_base
        if (categoria is not None and str(categoria).strip()):
            cat = _normalize_categoria(categoria)
        else:
            cat = prev.categoria
        if sucursal_id is not None and str(sucursal_id).strip():
            sid = _parse_sucursal_id(db, current_user.tenant_id, sucursal_id)
        else:
            sid = prev.sucursal_id
    else:
        grupo_id = file_id
        next_seq = 1
        display_titulo = (titulo or "").strip() or safe_base
        cat = _normalize_categoria(categoria)
        sid = _parse_sucursal_id(db, current_user.tenant_id, sucursal_id)

    if len(display_titulo) > 300:
        display_titulo = display_titulo[:300]

    doc = TenantDocumento(
        id=file_id,
        tenant_id=current_user.tenant_id,
        sucursal_id=sid,
        grupo_id=grupo_id,
        version_seq=next_seq,
        es_version_actual=True,
        titulo=display_titulo,
        categoria=cat,
        nombre_archivo_original=safe_base[:500],
        mime_type=mime,
        tamano_bytes=len(content),
        storage_relpath=relpath,
        created_by=current_user.id,
    )
    db.add(doc)
    # Persistir el documento antes de auditoría: la FK exige que exista en tenant_documentos.
    db.flush()
    _log_documento_auditoria(
        db,
        tenant_id=current_user.tenant_id,
        documento_id=doc.id,
        usuario_id=current_user.id,
        accion="subir",
        detalle=f"{doc.titulo} (v{doc.version_seq})",
    )
    db.commit()
    db.refresh(doc)
    if extension in PREVIEW_OFFICE_EXTENSIONS:
        background_tasks.add_task(schedule_preview_build, doc.id)
    return doc


@router.post(
    "/certificacion-en-cuenta",
    status_code=status.HTTP_200_OK,
    response_class=Response,
)
def generar_certificacion_en_cuenta(
    incluir_hash: bool = Query(default=True),
    solo_actuales: bool = Query(default=True),
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    tenant_id_for_log = getattr(admin, "tenant_id", None)
    try:
        tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado.")

        docs_q = db.query(TenantDocumento).filter(TenantDocumento.tenant_id == admin.tenant_id)
        if solo_actuales:
            docs_q = docs_q.filter(TenantDocumento.es_version_actual.is_(True))
        docs = docs_q.order_by(TenantDocumento.created_at.desc()).all()
        if not docs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No hay documentos para certificar con los filtros seleccionados.",
            )

        app_tz = get_app_timezone()
        now_local = datetime.now(app_tz)
        codigo_verificacion = f"CDA-{str(admin.tenant_id).split('-')[0].upper()}-{now_local.strftime('%Y%m%d%H%M%S')}"

        items: list[CertificacionDocumentoItem] = []
        for d in docs:
            file_hash = None
            if incluir_hash:
                try:
                    file_hash = _sha256_file_hex(_abs_path(d.storage_relpath))
                except Exception:
                    logger.exception("No fue posible calcular hash para documento %s", d.id)
                    file_hash = None
            fecha_base = d.updated_at or d.created_at
            fecha_local = fecha_base.astimezone(app_tz) if fecha_base.tzinfo else fecha_base
            items.append(
                CertificacionDocumentoItem(
                    identificacion=str(d.id),
                    titulo=d.titulo,
                    nombre_archivo=d.nombre_archivo_original,
                    version=f"v{d.version_seq}",
                    fecha_ultima_modificacion=fecha_local.strftime("%d/%m/%Y %H:%M:%S"),
                    hash_sha256=file_hash,
                )
            )

        principal = (
            db.query(Sucursal)
            .filter(Sucursal.tenant_id == admin.tenant_id, Sucursal.es_principal.is_(True))
            .first()
        )
        ciudad_cert = None
        if principal and principal.ciudad and str(principal.ciudad).strip():
            ciudad_cert = str(principal.ciudad).strip()
        base_url = (settings.BACKEND_PUBLIC_BASE_URL or "").strip().rstrip("/")
        # Ruta corta: menos caracteres y sin query larga (al copiar desde el PDF no se trunca tenant_slug=…).
        verification_url = (
            f"{base_url}/api/v1/documentos/certificacion-en-cuenta/v/"
            f"{quote(tenant.slug, safe='')}/{quote(codigo_verificacion, safe='')}?vista=1"
        )
        sello_hex = _sello_electronico_hex(
            tenant_slug=tenant.slug,
            codigo_verificacion=codigo_verificacion,
            fecha_emision_iso=now_local.isoformat(),
        )

        pdf_buffer = generar_certificacion_en_cuenta_pdf(
            tenant_nombre=tenant.nombre_comercial or tenant.nombre,
            tenant_nit=tenant.nit_cda,
            tenant_slug=tenant.slug,
            fecha_emision=now_local,
            codigo_verificacion=codigo_verificacion,
            documentos=items,
            usuario_emisor=admin.nombre_completo or admin.email,
            tenant_logo_url=tenant.logo_url,
            incluir_hash=incluir_hash,
            ciudad_emision=ciudad_cert,
            verification_url=verification_url,
            format_version="v1.6",
        )
        content = pdf_buffer.getvalue()
        original_name = f"certificacion_en_cuenta_{now_local.strftime('%Y%m%d_%H%M%S')}.pdf"

        # No persistimos el PDF en biblioteca: solo trazabilidad en auditoría y descarga inmediata.
        _log_documento_auditoria(
            db,
            tenant_id=admin.tenant_id,
            documento_id=None,
            usuario_id=admin.id,
            accion="certificacion_cuenta",
            detalle=(
                f"{codigo_verificacion} | docs={len(items)} | hash={'si' if incluir_hash else 'no'} "
                f"| sello={sello_hex}"
            ),
        )
        db.commit()

        return Response(
            content=content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{original_name}"',
                "X-Certificacion-Codigo": codigo_verificacion,
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Error generando certificación en cuenta tenant=%s", tenant_id_for_log)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error interno al generar certificación en cuenta: {type(exc).__name__}: {exc}",
        )


@router.get("/{documento_id}/preview")
def vista_previa_pdf_documento(
    documento_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Sirve el PDF de vista previa (Office→PDF). Si no existía, intenta generarlo con LibreOffice al vuelo."""
    doc = (
        db.query(TenantDocumento)
        .filter(
            TenantDocumento.id == documento_id,
            TenantDocumento.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado.")

    if not doc.preview_pdf_relpath:
        ext = Path(doc.storage_relpath).suffix.lower()
        if ext in PREVIEW_OFFICE_EXTENSIONS:
            relpath = try_generate_preview_pdf(_storage_dir(), doc.storage_relpath)
            if relpath:
                doc.preview_pdf_relpath = relpath[:800]
                db.commit()
                db.refresh(doc)
                logger.info("Vista previa PDF generada bajo demanda para documento %s", documento_id)

    if not doc.preview_pdf_relpath:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se pudo generar la vista previa PDF. Revise LibreOffice y los logs del servidor.",
        )
    path = _abs_path(doc.preview_pdf_relpath)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El archivo de vista previa ya no está en el servidor.",
        )
    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        filename=f"{Path(doc.nombre_archivo_original).stem}_vista_previa.pdf",
    )


@router.get("/{documento_id}/versiones", response_model=list[DocumentoResponse])
def listar_versiones_documento(
    documento_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    base = (
        db.query(TenantDocumento)
        .filter(
            TenantDocumento.id == documento_id,
            TenantDocumento.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not base:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")

    rows = (
        db.query(TenantDocumento)
        .filter(
            TenantDocumento.grupo_id == base.grupo_id,
            TenantDocumento.tenant_id == current_user.tenant_id,
        )
        .order_by(TenantDocumento.version_seq.desc())
        .all()
    )
    return rows


@router.patch("/{documento_id}", response_model=DocumentoResponse)
def actualizar_metadata_documento(
    documento_id: UUID,
    body: DocumentoMetadataUpdate,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    doc = (
        db.query(TenantDocumento)
        .filter(
            TenantDocumento.id == documento_id,
            TenantDocumento.tenant_id == admin.tenant_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")

    data = body.model_dump(exclude_unset=True)
    if not data:
        return doc

    if "titulo" in data:
        t = (data["titulo"] or "").strip()
        if not t:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El título no puede quedar vacío.",
            )
        doc.titulo = t[:300]

    if "categoria" in data:
        doc.categoria = _normalize_categoria(data["categoria"])

    if "sucursal_id" in data:
        sid = data["sucursal_id"]
        if sid is None:
            doc.sucursal_id = None
        else:
            suc = db.query(Sucursal).filter(Sucursal.id == sid, Sucursal.tenant_id == admin.tenant_id).first()
            if not suc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La sede indicada no pertenece a su organización.",
                )
            doc.sucursal_id = sid

    doc.updated_at = datetime.now(timezone.utc)
    doc.updated_by = admin.id
    _log_documento_auditoria(
        db,
        tenant_id=admin.tenant_id,
        documento_id=doc.id,
        usuario_id=admin.id,
        accion="metadata_update",
        detalle=f"título={doc.titulo!r}",
    )
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{documento_id}/download")
def descargar_documento(
    documento_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    doc = (
        db.query(TenantDocumento)
        .filter(
            TenantDocumento.id == documento_id,
            TenantDocumento.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")

    path = _abs_path(doc.storage_relpath)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El archivo ya no está disponible en el servidor.",
        )

    try:
        _log_documento_auditoria(
            db,
            tenant_id=current_user.tenant_id,
            documento_id=doc.id,
            usuario_id=current_user.id,
            accion="descargar",
            detalle=doc.nombre_archivo_original,
        )
        db.commit()
    except Exception:
        logger.exception("auditoría descargar documento %s", documento_id)
        db.rollback()

    return FileResponse(
        path=str(path),
        media_type=doc.mime_type,
        filename=doc.nombre_archivo_original,
    )


@router.delete("/{documento_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_documento(
    documento_id: UUID,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    doc = (
        db.query(TenantDocumento)
        .filter(
            TenantDocumento.id == documento_id,
            TenantDocumento.tenant_id == admin.tenant_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")

    path = _abs_path(doc.storage_relpath)
    preview_path = _abs_path(doc.preview_pdf_relpath) if doc.preview_pdf_relpath else None
    grupo_id = doc.grupo_id
    era_actual = doc.es_version_actual
    doc_id = doc.id
    doc_titulo = doc.titulo
    _log_documento_auditoria(
        db,
        tenant_id=admin.tenant_id,
        documento_id=doc_id,
        usuario_id=admin.id,
        accion="eliminar",
        detalle=doc_titulo,
    )
    db.delete(doc)
    db.flush()

    if era_actual:
        ultimo = (
            db.query(TenantDocumento)
            .filter(
                TenantDocumento.grupo_id == grupo_id,
                TenantDocumento.tenant_id == admin.tenant_id,
            )
            .order_by(TenantDocumento.version_seq.desc())
            .first()
        )
        if ultimo:
            ultimo.es_version_actual = True

    db.commit()

    try:
        if path.is_file():
            path.unlink()
        if preview_path is not None and preview_path.is_file():
            preview_path.unlink()
    except OSError:
        pass

    return None
