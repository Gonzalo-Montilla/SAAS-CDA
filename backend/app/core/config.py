"""
Configuración central de la aplicación
"""
import json
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field


def parse_backend_cors_origins(raw: str) -> List[str]:
    """
    Convierte BACKEND_CORS_ORIGINS del .env (texto) en lista para CORSMiddleware.
    Acepta: JSON array, URLs separadas por comas, o '*' (solo desarrollo / compat).
    Se define como str en Settings para evitar que pydantic-settings haga json.loads
    sobre List[str] antes de poder interpretar el formato con comas.
    """
    s = (raw or "").strip()
    if not s or s == "*":
        return ["*"]
    if s.startswith("["):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(i).strip() for i in parsed if str(i).strip()]
        except Exception:
            pass
    return [i.strip() for i in s.split(",") if i.strip()] or ["*"]


class Settings(BaseSettings):
    """Configuración de la aplicación desde variables de entorno"""
    
    # Información de la aplicación
    APP_NAME: str = "CDASOFT"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "production"
    
    # Base de datos
    DATABASE_URL: str = Field(..., env="DATABASE_URL")
    
    # Seguridad JWT
    SECRET_KEY: str = Field(..., env="SECRET_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Baseline multitenant (Fase 1)
    SAAS_DEFAULT_TENANT_ID: str = "00000000-0000-0000-0000-000000000001"
    SAAS_DEFAULT_TENANT_SLUG: str = "default"
    SAAS_DEFAULT_TENANT_NAME: str = "Tenant Default CDA"
    SAAS_OWNER_EMAIL: str = Field(default="owner@cdasoft.com", env="SAAS_OWNER_EMAIL")
    SAAS_OWNER_PASSWORD: str = Field(default="owner123", env="SAAS_OWNER_PASSWORD")
    SAAS_OWNER_NAME: str = Field(default="Owner CDASOFT", env="SAAS_OWNER_NAME")

    # Seguridad onboarding tenant (registro público)
    ONBOARDING_RATE_LIMIT_WINDOW_MINUTES: int = 60
    ONBOARDING_RATE_LIMIT_MAX_ATTEMPTS_IP: int = 5
    ONBOARDING_RATE_LIMIT_MAX_ATTEMPTS_EMAIL: int = 3
    TURNSTILE_ENABLED: bool = False
    TURNSTILE_SECRET_KEY: str = Field(default="", env="TURNSTILE_SECRET_KEY")
    TURNSTILE_VERIFY_URL: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    BACKEND_PUBLIC_BASE_URL: str = Field(default="http://localhost:8000", env="BACKEND_PUBLIC_BASE_URL")
    TENANT_LOGO_UPLOAD_DIR: str = Field(default="uploads/tenant-logos", env="TENANT_LOGO_UPLOAD_DIR")
    TENANT_LOGO_MAX_SIZE_MB: int = 4
    # Archivos del módulo documental (no se exponen por /uploads estático)
    DOCUMENTOS_STORAGE_DIR: str = Field(default="private_uploads/documentos", env="DOCUMENTOS_STORAGE_DIR")
    DOCUMENTOS_MAX_SIZE_MB: int = Field(default=25, ge=1, le=200, env="DOCUMENTOS_MAX_SIZE_MB")
    # Ruta al ejecutable soffice (LibreOffice). Vacío = buscar en PATH y rutas típicas de Windows.
    DOCUMENTOS_LIBREOFFICE_PATH: str = Field(default="", env="DOCUMENTOS_LIBREOFFICE_PATH")
    # Directorio de perfil headless (UserInstallation). Vacío en Linux = junto al almacén documental
    # (p. ej. private_uploads/.libreoffice-profile) para que systemd ReadWritePaths lo permita.
    DOCUMENTOS_LIBREOFFICE_USER_PROFILE: str = Field(default="", env="DOCUMENTOS_LIBREOFFICE_USER_PROFILE")
    # PDF del RUT (certificación DIAN) en catálogo de proveedores — no confundir con cédula escaneada
    PROVEEDORES_RUT_STORAGE_DIR: str = Field(
        default="private_uploads/proveedores_rut",
        env="PROVEEDORES_RUT_STORAGE_DIR",
    )
    PROVEEDORES_RUT_MAX_MB: int = Field(default=5, ge=1, le=25, env="PROVEEDORES_RUT_MAX_MB")
    ONBOARDING_EMAIL_VERIFICATION_REQUIRED: bool = True
    ONBOARDING_EMAIL_CODE_TTL_MINUTES: int = 15
    ONBOARDING_EMAIL_CODE_MAX_ATTEMPTS: int = 5
    
    # CORS (texto en .env: comas o JSON array; ver parse_backend_cors_origins en main)
    BACKEND_CORS_ORIGINS: str = Field(default="*", env="BACKEND_CORS_ORIGINS")
    
    # URLs sistemas externos
    RUNT_URL: str = "https://b2crunt2prd.b2clogin.com/runtprologin.runt.gov.co/b2c_1a_singin/oauth2/v2.0/authorize?client_id=4e0d509e-3bb5-44b9-b712-53e221b97393&scope=https%3A%2F%2FB2Crunt2prd.onmicrosoft.com%2FRNFTransversalMS%2Faccess.all%20openid%20profile%20offline_access&redirect_uri=https%3A%2F%2Fruntpro.runt.gov.co%2F"
    SICOV_URL: str = "https://sicovindra.com:9093/"
    INDRA_URL: str = "https://indra.paynet.com.co:14443/Login.aspx?ReturnUrl=%2fInformacionSeguridad.aspx"
    
    # Facturación electrónica (Factus) — URLs oficiales en https://developers.factus.com.co/
    FACTUS_SANDBOX_BASE_URL: str = Field(default="https://api-sandbox.factus.com.co", env="FACTUS_SANDBOX_BASE_URL")
    FACTUS_PRODUCTION_BASE_URL: str = Field(default="https://api.factus.com.co", env="FACTUS_PRODUCTION_BASE_URL")
    FACTUS_ENCRYPTION_KEY: Optional[str] = Field(
        default=None,
        env="FACTUS_ENCRYPTION_KEY",
        description="Opcional: cifrar secretos Factus; si vacío se deriva de SECRET_KEY.",
    )
    # Municipio DIAN (tabla Factus) para cliente/establecimiento cuando la sede aún no tiene código propio
    FACTUS_DEFAULT_MUNICIPALITY_ID: int = Field(default=980, env="FACTUS_DEFAULT_MUNICIPALITY_ID")
    # IVA tarifa general (Resolución DIAN: régimen común, p. ej. 19 %). En payloads Factus, `items.price`
    # va con impuestos incluidos; la base la calcula Factus.
    FACTUS_IVA_PORCENTAJE_GENERAL: float = Field(
        default=19.0,
        ge=0,
        le=100,
        env="FACTUS_IVA_PORCENTAJE_GENERAL",
    )
    # Decimales en pesos COP para bases y totales al desagregar IVA (habitual 2).
    FACTUS_MONEDA_DECIMALES: int = Field(default=2, ge=0, le=6, env="FACTUS_MONEDA_DECIMALES")
    # Documento soporte: ISO 3166-1 alpha-2 para tipos extranjeros del catálogo Factus (C.E., pasaporte, PEP, etc.)
    # y NIT otro país. NIT Colombia (6) —incl. C.C./T.I. mapeadas a NIT persona natural— va siempre en CO.
    FACTUS_DOCUMENTO_SOPORTE_PAIS_EXTRANJERO_DEFAULT: str = Field(
        default="US",
        min_length=2,
        max_length=2,
        env="FACTUS_DOCUMENTO_SOPORTE_PAIS_EXTRANJERO_DEFAULT",
    )

    # Localización Colombia
    TIMEZONE: str = "America/Bogota"
    LOCALE: str = "es_CO"
    
    # Paginación
    DEFAULT_PAGE_SIZE: int = 50
    MAX_PAGE_SIZE: int = 100
    
    # Configuración SMTP para envío de emails
    SMTP_HOST: str = Field(default="smtp.gmail.com", env="SMTP_HOST")
    SMTP_PORT: int = Field(default=587, env="SMTP_PORT")
    SMTP_USER: str = Field(default="", env="SMTP_USER")  # Email de Gmail
    SMTP_PASSWORD: str = Field(default="", env="SMTP_PASSWORD")  # Contraseña de aplicación
    FRONTEND_URL: str = Field(default="http://localhost:5173", env="FRONTEND_URL")
    
    class Config:
        env_file = ".env"
        case_sensitive = True


# Instancia global de configuración
settings = Settings()
