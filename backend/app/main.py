"""
Aplicación principal FastAPI - CDASOFT
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from app.db.database import init_db
from app.api.v1.api import api_router

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Sistema de Punto de Venta para Centro de Diagnóstico Automotor",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None
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
        
        # Content Security Policy
        if settings.ENVIRONMENT == "production":
            response.headers["Content-Security-Policy"] = "default-src 'self'"
        
        # No revelar información del servidor
        if "server" in response.headers:
            del response.headers["server"]
        
        return response

# Aplicar middleware de seguridad
app.add_middleware(SecurityHeadersMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
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


# Incluir routers de API
app.include_router(api_router, prefix="/api/v1")
