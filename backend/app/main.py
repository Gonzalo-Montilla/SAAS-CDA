"""
Aplicación principal FastAPI - CDASOFT
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import parse_backend_cors_origins, settings
from app.db.database import init_db
from app.api.v1.api import api_router

# Swagger/ReDoc solo en desarrollo (ENVIRONMENT por defecto en Settings es "production").
def _is_development_environment() -> bool:
    return (settings.ENVIRONMENT or "").strip().lower() == "development"


_show_api_docs = _is_development_environment()
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Sistema de Punto de Venta para Centro de Diagnóstico Automotor",
    docs_url="/docs" if _show_api_docs else None,
    redoc_url="/redoc" if _show_api_docs else None,
)

# ==================== MIDDLEWARE DE SEGURIDAD ====================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware para agregar headers de seguridad HTTP
    """
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Headers de seguridad
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        # Content Security Policy (páginas HTML del API, p. ej. verificación certificación, usan <style> inline)
        if settings.ENVIRONMENT == "production":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                "font-src https://fonts.gstatic.com 'self' data:; "
                "img-src 'self' https: data:; "
                "base-uri 'self'"
            )
        
        # No revelar información del servidor
        if "server" in response.headers:
            del response.headers["server"]
        
        return response

# Aplicar middleware de seguridad
app.add_middleware(SecurityHeadersMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_backend_cors_origins(settings.BACKEND_CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Certificacion-Codigo", "X-Sarlaft-Certificate-Code"],
)


@app.on_event("startup")
def on_startup():
    """Inicializar base de datos al arrancar"""
    init_db()


@app.get("/health", tags=["health"])
def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT
    }


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _resolve_cdasoft_full_logo_path() -> Path | None:
    """Logo completo (mismo archivo por defecto que BrandContext / Login)."""
    repo = _repo_root()
    candidates = [
        repo / "backend" / "app" / "utils" / "LOGO_CDA_SOFT-SIN FONDO.png",
        repo / "frontend" / "src" / "assets" / "LOGO_CDA_SOFT-SIN FONDO.png",
        repo / "frontend" / "public" / "LOGO_CDA_SOFT-SIN FONDO.png",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def _resolve_cdasoft_favicon_path() -> Path | None:
    """Favicon pestaña (icono pequeño en public/)."""
    repo = _repo_root()
    candidates = [
        repo / "frontend" / "public" / "FAVICON SIAEC - CDASOFT.png",
        repo / "frontend" / "public" / "cdasoft-brand-icon.png",
        repo / "backend" / "app" / "utils" / "LOGO_CDA_SOFT-SIN FONDO.png",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def _file_response_png(path: Path | None) -> FileResponse:
    if path is None:
        raise HTTPException(status_code=404, detail="Recurso de marca no encontrado en el servidor")
    return FileResponse(path, media_type="image/png")


@app.api_route("/cdasoft-brand-logo.png", methods=["GET", "HEAD"], include_in_schema=False)
def cdasoft_brand_logo():
    """Logo completo para cabeceras HTML generadas por el API (p. ej. verificación certificación)."""
    return _file_response_png(_resolve_cdasoft_full_logo_path())


@app.api_route("/cdasoft-favicon.png", methods=["GET", "HEAD"], include_in_schema=False)
def cdasoft_favicon():
    """Favicon para <link rel=\"icon\"> en páginas HTML del API."""
    return _file_response_png(_resolve_cdasoft_favicon_path())


@app.api_route("/cdasoft-brand-icon.png", methods=["GET", "HEAD"], include_in_schema=False)
def cdasoft_brand_icon():
    """Compatibilidad: mismo recurso que el favicon (Nginx/proxy existentes)."""
    return _file_response_png(_resolve_cdasoft_favicon_path())


@app.get("/sarlaft/verificar/{tenant_slug}/{certificate_code}", include_in_schema=False)
def sarlaft_verify_public_shortcut(tenant_slug: str, certificate_code: str):
    dest = f"/api/v1/sarlaft/manual-checks/certificate/v/{tenant_slug}/{certificate_code}?vista=1"
    return RedirectResponse(url=dest, status_code=307)


# Incluir routers de API
app.include_router(api_router, prefix="/api/v1")

# Servir logos/uploads públicos
uploads_dir = Path(settings.TENANT_LOGO_UPLOAD_DIR).resolve().parent
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
