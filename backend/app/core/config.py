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
    # Secreto (solo servidor) y site key pública del mismo widget en Cloudflare Turnstile.
    # La site key también puede leerse en GET /config/turnstile-public para no depender del build del front.
    TURNSTILE_SECRET_KEY: str = Field(default="", env="TURNSTILE_SECRET_KEY")
    TURNSTILE_SITE_KEY: str = Field(default="", env="TURNSTILE_SITE_KEY")
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
    # Copias PDF archivadas en disco (documento soporte / factura) para trazabilidad y conservación.
    ARCHIVOS_FISCALES_DIR: str = Field(default="private_uploads/archivos_fiscales", env="ARCHIVOS_FISCALES_DIR")
    ONBOARDING_EMAIL_VERIFICATION_REQUIRED: bool = True
    ONBOARDING_EMAIL_CODE_TTL_MINUTES: int = 15
    ONBOARDING_EMAIL_CODE_MAX_ATTEMPTS: int = 5
    
    # CORS (texto en .env: comas o JSON array; ver parse_backend_cors_origins en main)
    BACKEND_CORS_ORIGINS: str = Field(default="*", env="BACKEND_CORS_ORIGINS")
    
    # URLs sistemas externos
    RUNT_URL: str = "https://b2crunt2prd.b2clogin.com/runtprologin.runt.gov.co/b2c_1a_singin/oauth2/v2.0/authorize?client_id=4e0d509e-3bb5-44b9-b712-53e221b97393&scope=https%3A%2F%2FB2Crunt2prd.onmicrosoft.com%2FRNFTransversalMS%2Faccess.all%20openid%20profile%20offline_access&redirect_uri=https%3A%2F%2Fruntpro.runt.gov.co%2F"
    SICOV_URL: str = "https://sicovindra.com:9093/"
    INDRA_URL: str = "https://indra.paynet.com.co:14443/Login.aspx?ReturnUrl=%2fInformacionSeguridad.aspx"
    # Integración RUNT vía proveedor externo (Verifik)
    VERIFIK_ENABLED: bool = Field(default=False, env="VERIFIK_ENABLED")
    VERIFIK_BASE_URL: str = Field(default="https://api.verifik.co", env="VERIFIK_BASE_URL")
    VERIFIK_TOKEN: str = Field(default="", env="VERIFIK_TOKEN")
    VERIFIK_TIMEOUT_SECONDS: float = Field(default=15.0, ge=1.0, le=60.0, env="VERIFIK_TIMEOUT_SECONDS")
    VERIFIK_RUNT_SERVICE_PATH: str = Field(
        default="/v2/co/runt/vehicle-by-plate",
        env="VERIFIK_RUNT_SERVICE_PATH",
    )
    VERIFIK_RUNT_DEFAULT_DOCUMENT_TYPE: str = Field(
        default="CC",
        env="VERIFIK_RUNT_DEFAULT_DOCUMENT_TYPE",
    )
    VERIFIK_RUNT_CACHE_TTL_SECONDS: int = Field(default=600, ge=0, le=86400, env="VERIFIK_RUNT_CACHE_TTL_SECONDS")
    # Integración RUNT alternativa (CoreSoft) para fallback de costo controlado.
    CORESOFT_ENABLED: bool = Field(default=False, env="CORESOFT_ENABLED")
    CORESOFT_BASE_URL: str = Field(default="https://coresoft.solutions", env="CORESOFT_BASE_URL")
    CORESOFT_API_KEY: str = Field(default="", env="CORESOFT_API_KEY")
    CORESOFT_TIMEOUT_SECONDS: float = Field(default=15.0, ge=1.0, le=60.0, env="CORESOFT_TIMEOUT_SECONDS")
    CORESOFT_RUNT_SERVICE_PATH: str = Field(default="/api/runt", env="CORESOFT_RUNT_SERVICE_PATH")
    CORESOFT_RUNT_CACHE_TTL_SECONDS: int = Field(default=600, ge=0, le=86400, env="CORESOFT_RUNT_CACHE_TTL_SECONDS")
    # Proveedor alterno económico para autocompletar datos técnicos del vehículo por placa.
    RUNT_LOOKUP_PROVIDER: str = Field(default="verifik", env="RUNT_LOOKUP_PROVIDER")
    RUNT_FALLBACK_TO_CORESOFT_ON_EMPTY: bool = Field(default=True, env="RUNT_FALLBACK_TO_CORESOFT_ON_EMPTY")
    RUNT_FALLBACK_TO_VERIFIK_ON_EMPTY: bool = Field(default=True, env="RUNT_FALLBACK_TO_VERIFIK_ON_EMPTY")
    PLACAAPI_ENABLED: bool = Field(default=False, env="PLACAAPI_ENABLED")
    PLACAAPI_BASE_URL: str = Field(default="https://www.regcheck.org.uk", env="PLACAAPI_BASE_URL")
    PLACAAPI_SERVICE_PATH: str = Field(default="/api/reg.asmx/CheckColombia", env="PLACAAPI_SERVICE_PATH")
    PLACAAPI_USERNAME: str = Field(default="", env="PLACAAPI_USERNAME")
    PLACAAPI_TIMEOUT_SECONDS: float = Field(default=15.0, ge=1.0, le=60.0, env="PLACAAPI_TIMEOUT_SECONDS")
    PLACAAPI_CACHE_TTL_SECONDS: int = Field(default=600, ge=0, le=86400, env="PLACAAPI_CACHE_TTL_SECONDS")
    RUNT_INTERNAL_CACHE_TTL_SECONDS: int = Field(
        default=2592000,
        ge=0,
        le=7776000,
        env="RUNT_INTERNAL_CACHE_TTL_SECONDS",
    )
    RUNT_FX_MODE: str = Field(default="auto", env="RUNT_FX_MODE")  # auto | manual
    RUNT_FX_USD_COP: float = Field(default=4000.0, ge=0.0, env="RUNT_FX_USD_COP")
    RUNT_FX_AUTO_TTL_SECONDS: int = Field(default=21600, ge=60, le=86400, env="RUNT_FX_AUTO_TTL_SECONDS")
    RUNT_FX_AUTO_URL: str = Field(
        default="https://www.datos.gov.co/resource/32sa-8pi3.json?$select=valor&$order=vigenciadesde%20DESC&$limit=1",
        env="RUNT_FX_AUTO_URL",
    )
    RUNT_COST_PLACAAPI_USD: float = Field(default=0.02, ge=0.0, env="RUNT_COST_PLACAAPI_USD")
    RUNT_COST_CORESOFT_USD: float = Field(default=0.0, ge=0.0, env="RUNT_COST_CORESOFT_USD")
    RUNT_COST_VERIFIK_USD: float = Field(default=0.20, ge=0.0, env="RUNT_COST_VERIFIK_USD")
    # Compatibilidad temporal: fallback si no hay costos USD configurados.
    RUNT_COST_PLACAAPI_COP: float = Field(default=74.0, ge=0.0, env="RUNT_COST_PLACAAPI_COP")
    RUNT_COST_CORESOFT_COP: float = Field(default=79.33, ge=0.0, env="RUNT_COST_CORESOFT_COP")
    RUNT_COST_VERIFIK_COP: float = Field(default=740.0, ge=0.0, env="RUNT_COST_VERIFIK_COP")

    # SARLAFT - OpenSanctions (screening externo)
    OPENSANCTIONS_ENABLED: bool = Field(default=False, env="OPENSANCTIONS_ENABLED")
    OPENSANCTIONS_BASE_URL: str = Field(default="https://api.opensanctions.org", env="OPENSANCTIONS_BASE_URL")
    OPENSANCTIONS_API_KEY: str = Field(default="", env="OPENSANCTIONS_API_KEY")
    OPENSANCTIONS_TIMEOUT_SECONDS: float = Field(
        default=20.0,
        ge=2.0,
        le=60.0,
        env="OPENSANCTIONS_TIMEOUT_SECONDS",
    )
    OPENSANCTIONS_MATCH_DATASET: str = Field(default="sanctions", env="OPENSANCTIONS_MATCH_DATASET")
    OPENSANCTIONS_MATCH_ALGORITHM: str = Field(default="best", env="OPENSANCTIONS_MATCH_ALGORITHM")
    OPENSANCTIONS_MATCH_LIMIT: int = Field(default=5, ge=1, le=20, env="OPENSANCTIONS_MATCH_LIMIT")
    OPENSANCTIONS_ALERT_SCORE_THRESHOLD: float = Field(
        default=0.75,
        ge=0.0,
        le=1.0,
        env="OPENSANCTIONS_ALERT_SCORE_THRESHOLD",
    )
    OPENSANCTIONS_AUTO_RED_SCORE_THRESHOLD: float = Field(
        default=0.95,
        ge=0.0,
        le=1.0,
        env="OPENSANCTIONS_AUTO_RED_SCORE_THRESHOLD",
    )
    # SARLAFT - Motor interno (operación inusual)
    SARLAFT_UNUSUAL_FREQ_THRESHOLD: int = Field(default=4, ge=2, le=100, env="SARLAFT_UNUSUAL_FREQ_THRESHOLD")
    SARLAFT_UNUSUAL_FREQ_WINDOW_DAYS: int = Field(default=365, ge=1, le=3650, env="SARLAFT_UNUSUAL_FREQ_WINDOW_DAYS")
    SARLAFT_UNUSUAL_FREQ_DISTINCT_PLACAS_THRESHOLD: int = Field(
        default=4, ge=1, le=100, env="SARLAFT_UNUSUAL_FREQ_DISTINCT_PLACAS_THRESHOLD"
    )
    SARLAFT_UNUSUAL_CASH_COUNT_THRESHOLD: int = Field(default=4, ge=1, le=100, env="SARLAFT_UNUSUAL_CASH_COUNT_THRESHOLD")
    SARLAFT_UNUSUAL_CASH_WINDOW_DAYS: int = Field(default=365, ge=1, le=3650, env="SARLAFT_UNUSUAL_CASH_WINDOW_DAYS")
    SARLAFT_UNUSUAL_CASH_RATIO_THRESHOLD: float = Field(
        default=0.7, ge=0.0, le=1.0, env="SARLAFT_UNUSUAL_CASH_RATIO_THRESHOLD"
    )
    SARLAFT_UNUSUAL_CRITICAL_COUNT_THRESHOLD: int = Field(
        default=10, ge=2, le=500, env="SARLAFT_UNUSUAL_CRITICAL_COUNT_THRESHOLD"
    )
    # SARLAFT - Señal inter-CDA (anonimizada)
    SARLAFT_INTERCDA_ENABLED: bool = Field(default=True, env="SARLAFT_INTERCDA_ENABLED")
    SARLAFT_INTERCDA_WINDOWS_DAYS: str = Field(default="30,90,365", env="SARLAFT_INTERCDA_WINDOWS_DAYS")
    SARLAFT_INTERCDA_MIN_DISTINCT_TENANTS: int = Field(
        default=2, ge=2, le=1000, env="SARLAFT_INTERCDA_MIN_DISTINCT_TENANTS"
    )
    SARLAFT_INTERCDA_MIN_TOTAL_OPS: int = Field(default=4, ge=2, le=50000, env="SARLAFT_INTERCDA_MIN_TOTAL_OPS")
    SARLAFT_INTERCDA_MIN_CASH_RATIO: float = Field(
        default=0.6, ge=0.0, le=1.0, env="SARLAFT_INTERCDA_MIN_CASH_RATIO"
    )
    SARLAFT_INTERCDA_ALERT_COOLDOWN_HOURS: int = Field(
        default=72, ge=1, le=720, env="SARLAFT_INTERCDA_ALERT_COOLDOWN_HOURS"
    )
    SARLAFT_INTERCDA_DOC_HASH_PEPPER: str = Field(default="", env="SARLAFT_INTERCDA_DOC_HASH_PEPPER")
    SARLAFT_INTERCDA_ASYNC_ENABLED: bool = Field(default=True, env="SARLAFT_INTERCDA_ASYNC_ENABLED")
    SARLAFT_INTERCDA_ASYNC_BATCH_LIMIT: int = Field(
        default=200, ge=1, le=5000, env="SARLAFT_INTERCDA_ASYNC_BATCH_LIMIT"
    )
    # OpenSanctions - estrategia comercial backoffice
    OPENSANCTIONS_COST_PER_CALL_EUR: float = Field(
        default=0.10, ge=0.0, env="OPENSANCTIONS_COST_PER_CALL_EUR"
    )
    OPENSANCTIONS_PREPAID_UNIT_PRICE_COP: float = Field(
        default=450.0, ge=0.0, env="OPENSANCTIONS_PREPAID_UNIT_PRICE_COP"
    )
    OPENSANCTIONS_PREPAID_PACKAGE_EXPIRES_DAYS: int = Field(
        default=365, ge=1, le=3650, env="OPENSANCTIONS_PREPAID_PACKAGE_EXPIRES_DAYS"
    )
    
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

    # Wompi (pasarela única) — pago de suscripción tenant
    WOMPI_PUBLIC_KEY: str = Field(default="", env="WOMPI_PUBLIC_KEY")
    WOMPI_INTEGRITY_SECRET: str = Field(default="", env="WOMPI_INTEGRITY_SECRET")
    WOMPI_EVENTS_SECRET: str = Field(default="", env="WOMPI_EVENTS_SECRET")
    WOMPI_USE_SANDBOX: bool = Field(default=True, env="WOMPI_USE_SANDBOX")
    WOMPI_SANDBOX_BASE_URL: str = Field(default="https://sandbox.wompi.co", env="WOMPI_SANDBOX_BASE_URL")
    WOMPI_PRODUCTION_BASE_URL: str = Field(default="https://production.wompi.co", env="WOMPI_PRODUCTION_BASE_URL")
    # Solo desarrollo: simular aprobación sin webhook real (nunca en producción)
    PAYMENT_DEV_MOCK_ENABLE: bool = Field(default=False, env="PAYMENT_DEV_MOCK_ENABLE")
    # Compatibilidad temporal: permitir variables legacy en .env sin usarlas en rutas activas.
    EPAYCO_PUBLIC_KEY: str = Field(default="", env="EPAYCO_PUBLIC_KEY")
    EPAYCO_PRIVATE_KEY: str = Field(default="", env="EPAYCO_PRIVATE_KEY")
    EPAYCO_CLIENT_ID: str = Field(default="", env="EPAYCO_CLIENT_ID")
    EPAYCO_P_KEY: str = Field(default="", env="EPAYCO_P_KEY")
    EPAYCO_TEST_MODE: bool = Field(default=True, env="EPAYCO_TEST_MODE")
    EPAYCO_TEST_OVERRIDE_AMOUNT_COP: float = Field(default=0, env="EPAYCO_TEST_OVERRIDE_AMOUNT_COP")
    EPAYCO_DEV_MOCK_ENABLE: bool = Field(default=False, env="EPAYCO_DEV_MOCK_ENABLE")

    # Factus — factura de **licencia/suscripción** (emisión: PROMETHEUS; adquirente: tenant). Distinto
    # de `tenant_factus_settings`, que es lo que el CDA usa para su propio comercio. Se cargan al
    # tener el plan de facturación / credenciales del emisor (no reutilizan el Factus del CDA).
    SAAS_BILLING_FACTUS_ENABLED: bool = Field(default=False, env="SAAS_BILLING_FACTUS_ENABLED")
    SAAS_BILLING_FACTUS_USE_SANDBOX: bool = Field(default=True, env="SAAS_BILLING_FACTUS_USE_SANDBOX")
    SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID: Optional[int] = Field(
        default=None, env="SAAS_BILLING_FACTUS_NUMBERING_RANGE_ID"
    )
    SAAS_BILLING_FACTUS_CLIENT_ID: str = Field(default="", env="SAAS_BILLING_FACTUS_CLIENT_ID")
    SAAS_BILLING_FACTUS_CLIENT_SECRET: str = Field(default="", env="SAAS_BILLING_FACTUS_CLIENT_SECRET")
    SAAS_BILLING_FACTUS_API_USERNAME: str = Field(default="", env="SAAS_BILLING_FACTUS_API_USERNAME")
    SAAS_BILLING_FACTUS_API_PASSWORD: str = Field(default="", env="SAAS_BILLING_FACTUS_API_PASSWORD")
    # Datos de establecimiento emisor (deben alinearse con el RUT en Factus)
    SAAS_BILLING_ISSUER_NAME: str = Field(default="PROMETHEUS TECH S.A.S", env="SAAS_BILLING_ISSUER_NAME")
    SAAS_BILLING_ISSUER_ADDRESS: str = Field(
        default="CL 5A 31 30 SENDEROS DE LA ITALIA", env="SAAS_BILLING_ISSUER_ADDRESS"
    )
    SAAS_BILLING_ISSUER_PHONE: str = Field(default="3235492939", env="SAAS_BILLING_ISSUER_PHONE")
    SAAS_BILLING_ISSUER_EMAIL: str = Field(
        default="gerencia@prometheustech.com.co", env="SAAS_BILLING_ISSUER_EMAIL"
    )
    SAAS_BILLING_ISSUER_MUNICIPALITY_ID: int = Field(default=520, env="SAAS_BILLING_ISSUER_MUNICIPALITY_ID")
    
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
