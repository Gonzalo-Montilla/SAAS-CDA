"""
Endpoints de Configuración
"""
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_admin, get_cajero_or_admin, get_current_user, get_db
from app.core.config import settings
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.utils.tenant_logo_remote import fetch_remote_tenant_logo

router = APIRouter()


class TurnstilePublicOut(BaseModel):
    """Configuración pública del widget (evita site key fija en VITE_* del build)."""

    enabled: bool = Field(description="True si el backend exige captcha y hay site key + secret configurados.")
    site_key: str = Field(default="", description="Clave pública del widget Turnstile; vacía si está desactivado.")


class PosReceiptSettingsOut(BaseModel):
    tenant_enabled: bool
    ticket_width: str
    auto_prompt_after_payment: bool
    tenant_name: str
    tenant_logo_url: str | None = None
    tenant_nit: str | None = None
    tenant_direccion: str | None = None
    tenant_telefono: str | None = None


class PosReceiptSettingsPatch(BaseModel):
    tenant_enabled: bool | None = None
    ticket_width: str | None = Field(default=None, max_length=10)
    auto_prompt_after_payment: bool | None = None


@router.get("/turnstile-public", response_model=TurnstilePublicOut)
def obtener_turnstile_publico():
    """
    Sin autenticación. Expone la site key pública solo cuando Turnstile está realmente activo
    (mismas variables que usa el servidor al verificar el token).
    """
    sk = (settings.TURNSTILE_SITE_KEY or "").strip()
    secret_ok = bool((settings.TURNSTILE_SECRET_KEY or "").strip())
    enabled = bool(settings.TURNSTILE_ENABLED and sk and secret_ok)
    return TurnstilePublicOut(enabled=enabled, site_key=sk if enabled else "")


def _resolve_tenant_logo_bytes(logo_url: str | None) -> tuple[bytes, str] | None:
    if not logo_url:
        return None

    raw = str(logo_url).strip()
    if not raw:
        return None
    if raw.startswith("//"):
        raw = "https:" + raw

    uploads_root = Path(settings.TENANT_LOGO_UPLOAD_DIR).resolve().parent
    normalized = raw.replace("\\", "/")
    local_candidates: list[Path] = []

    # Ruta absoluta local.
    direct_path = Path(raw)
    if direct_path.is_file():
        local_candidates.append(direct_path)

    # URL/ruta pública de uploads.
    if normalized.startswith("/uploads/"):
        rel = normalized[len("/uploads/"):]
        local_candidates.append(uploads_root / rel)
    elif normalized.startswith("uploads/"):
        rel = normalized[len("uploads/"):]
        local_candidates.append(uploads_root / rel)

    # URL absoluta hacia /uploads.
    if normalized.startswith("http://") or normalized.startswith("https://"):
        parsed = urlparse(normalized)
        parsed_path = (parsed.path or "").replace("\\", "/")
        if parsed_path.startswith("/uploads/"):
            rel = parsed_path[len("/uploads/"):]
            local_candidates.append(uploads_root / rel)

    # Fragmento tenant-logos en rutas locales heredadas.
    idx = normalized.lower().find("tenant-logos/")
    if idx >= 0:
        rel = normalized[idx + len("tenant-logos/") :]
        local_candidates.append(uploads_root / "tenant-logos" / rel)

    seen: set[str] = set()
    for candidate in local_candidates:
        candidate_key = str(candidate.resolve()) if candidate.exists() else str(candidate)
        if candidate_key in seen:
            continue
        seen.add(candidate_key)
        if candidate.is_file():
            content = candidate.read_bytes()
            if content:
                ext = candidate.suffix.lower()
                media_type = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                }.get(ext, "application/octet-stream")
                return content, media_type

    # Último intento: descargar URL remota (User-Agent + tipo imagen por firma/extensión).
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return fetch_remote_tenant_logo(normalized)

    return None


@router.get("/urls-externas")
def obtener_urls_externas(
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener URLs de sistemas externos (RUNT, SICOV, INDRA)
    """
    return {
        "runt_url": settings.RUNT_URL,
        "sicov_url": settings.SICOV_URL,
        "indra_url": settings.INDRA_URL
    }


def _normalize_pos_ticket_width(value: str | None) -> str:
    width = (value or "").strip().lower()
    if width not in {"58mm", "80mm"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ancho POS inválido. Use 58mm o 80mm.",
        )
    return width


@router.get("/pos-receipt-settings", response_model=PosReceiptSettingsOut)
def obtener_pos_receipt_settings(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    ticket_width = (tenant.pos_receipt_width or "80mm").strip().lower()
    if ticket_width not in {"58mm", "80mm"}:
        ticket_width = "80mm"
    return PosReceiptSettingsOut(
        tenant_enabled=bool(tenant.pos_receipt_enabled),
        ticket_width=ticket_width,
        auto_prompt_after_payment=bool(current_user.pos_auto_print_prompt),
        tenant_name=(tenant.nombre_comercial or tenant.nombre or "CDASOFT").strip(),
        tenant_logo_url=tenant.logo_url,
        tenant_nit=tenant.nit_cda,
        tenant_direccion=tenant.direccion_facturacion,
        tenant_telefono=tenant.celular,
    )


@router.patch("/pos-receipt-settings", response_model=PosReceiptSettingsOut)
def actualizar_pos_receipt_settings(
    payload: PosReceiptSettingsPatch,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    data = payload.model_dump(exclude_unset=True)
    if "tenant_enabled" in data:
        tenant.pos_receipt_enabled = bool(data["tenant_enabled"])
    if "ticket_width" in data and data["ticket_width"] is not None:
        tenant.pos_receipt_width = _normalize_pos_ticket_width(data["ticket_width"])
    if "auto_prompt_after_payment" in data:
        current_user.pos_auto_print_prompt = bool(data["auto_prompt_after_payment"])

    db.commit()
    db.refresh(tenant)
    db.refresh(current_user)
    return PosReceiptSettingsOut(
        tenant_enabled=bool(tenant.pos_receipt_enabled),
        ticket_width=(tenant.pos_receipt_width or "80mm").strip().lower(),
        auto_prompt_after_payment=bool(current_user.pos_auto_print_prompt),
        tenant_name=(tenant.nombre_comercial or tenant.nombre or "CDASOFT").strip(),
        tenant_logo_url=tenant.logo_url,
        tenant_nit=tenant.nit_cda,
        tenant_direccion=tenant.direccion_facturacion,
        tenant_telefono=tenant.celular,
    )


@router.get("/tenant-logo")
def obtener_logo_tenant(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado",
        )

    resolved = _resolve_tenant_logo_bytes(tenant.logo_url)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logo del tenant no disponible",
        )

    content, media_type = resolved
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


class TenantBrandingUpdate(BaseModel):
    nombre_comercial: str = Field(min_length=3, max_length=200)
    logo_url: str | None = Field(default=None, max_length=500)
    color_primario: str = Field(default="#2563eb", max_length=20)
    color_secundario: str = Field(default="#0f172a", max_length=20)


@router.get("/tenant-branding")
def obtener_tenant_branding(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado"
        )

    return {
        "tenant_slug": tenant.slug,
        "nombre_comercial": tenant.nombre_comercial,
        "logo_url": tenant.logo_url,
        "color_primario": tenant.color_primario,
        "color_secundario": tenant.color_secundario,
    }


@router.get("/public-tenant-branding/{tenant_slug}")
def obtener_tenant_branding_publico(
    tenant_slug: str,
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug, Tenant.activo == True).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado o inactivo",
        )

    login_url = f"{settings.FRONTEND_URL.rstrip('/')}/{tenant.slug}"
    return {
        "tenant_slug": tenant.slug,
        "nombre_comercial": tenant.nombre_comercial,
        "logo_url": tenant.logo_url,
        "color_primario": tenant.color_primario,
        "color_secundario": tenant.color_secundario,
        "login_url": login_url,
    }


@router.put("/tenant-branding")
def actualizar_tenant_branding(
    payload: TenantBrandingUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no encontrado"
        )

    tenant.nombre_comercial = payload.nombre_comercial
    tenant.logo_url = payload.logo_url
    tenant.color_primario = payload.color_primario
    tenant.color_secundario = payload.color_secundario
    db.commit()

    return {
        "message": "Branding del tenant actualizado exitosamente"
    }


class TenantFacturacionUbicacionOut(BaseModel):
    factus_municipality_id: int | None = None
    direccion_facturacion: str | None = None


class TenantFacturacionUbicacionUpdate(BaseModel):
    factus_municipality_id: int | None = Field(default=None, ge=1)
    direccion_facturacion: str | None = Field(default=None, max_length=500)


@router.get("/facturacion-ubicacion", response_model=TenantFacturacionUbicacionOut)
def obtener_facturacion_ubicacion_tenant(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return TenantFacturacionUbicacionOut(
        factus_municipality_id=tenant.factus_municipality_id,
        direccion_facturacion=tenant.direccion_facturacion,
    )


@router.patch("/facturacion-ubicacion", response_model=TenantFacturacionUbicacionOut)
def actualizar_facturacion_ubicacion_tenant(
    payload: TenantFacturacionUbicacionUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    data = payload.model_dump(exclude_unset=True)
    if "factus_municipality_id" in data:
        tenant.factus_municipality_id = data["factus_municipality_id"]
    if "direccion_facturacion" in data:
        d = data["direccion_facturacion"]
        if d is None:
            tenant.direccion_facturacion = None
        else:
            tenant.direccion_facturacion = d.strip() or None

    db.commit()
    db.refresh(tenant)
    return TenantFacturacionUbicacionOut(
        factus_municipality_id=tenant.factus_municipality_id,
        direccion_facturacion=tenant.direccion_facturacion,
    )
