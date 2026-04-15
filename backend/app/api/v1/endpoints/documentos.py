"""
Documentos del tenant: listado, carga y descarga autenticada.

Trazabilidad y lineamientos de seguridad de la información: ver
``backend/docs/NTC5385_modulo_documental.md`` (NTC 5385, referencia NTC-ISO/IEC 27002).
"""
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_admin, get_current_user, get_db
from app.models.documento_auditoria import TenantDocumentoAuditoria
from app.models.documento_tenant import TenantDocumento
from app.models.sucursal import Sucursal
from app.models.usuario import Usuario
from app.schemas.documento import (
    DocumentoAuditoriaResponse,
    DocumentoMetadataUpdate,
    DocumentoResponse,
)
from app.services.documento_preview import PREVIEW_OFFICE_EXTENSIONS, schedule_preview_build, try_generate_preview_pdf

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
    return _storage_dir() / relpath


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


@router.get("/auditoria", response_model=list[DocumentoAuditoriaResponse])
def listar_auditoria_documentos(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin),
):
    """Historial de acciones (solo administrador). Util para evidencias ante auditoria."""
    if limit > settings.MAX_PAGE_SIZE:
        limit = settings.MAX_PAGE_SIZE
    q = (
        db.query(
            TenantDocumentoAuditoria,
            Usuario.nombre_completo,
            Usuario.email,
        )
        .outerjoin(Usuario, TenantDocumentoAuditoria.usuario_id == Usuario.id)
        .filter(TenantDocumentoAuditoria.tenant_id == admin.tenant_id)
        .order_by(TenantDocumentoAuditoria.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = q.all()
    return [
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
            .filter(TenantDocumento.grupo_id == grupo_id)
            .scalar()
        )
        next_seq = (max_seq or 0) + 1
        db.query(TenantDocumento).filter(TenantDocumento.grupo_id == grupo_id).update(
            {TenantDocumento.es_version_actual: False},
            synchronize_session=False,
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
    db.commit()
    db.refresh(doc)
    if extension in PREVIEW_OFFICE_EXTENSIONS:
        background_tasks.add_task(schedule_preview_build, doc.id)
    return doc


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
