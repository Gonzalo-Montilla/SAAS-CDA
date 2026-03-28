"""
Configuración central de la aplicación
"""
from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field, validator


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
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]
    
    # URLs sistemas externos
    RUNT_URL: str = "https://b2crunt2prd.b2clogin.com/runtprologin.runt.gov.co/b2c_1a_singin/oauth2/v2.0/authorize?client_id=4e0d509e-3bb5-44b9-b712-53e221b97393&scope=https%3A%2F%2FB2Crunt2prd.onmicrosoft.com%2FRNFTransversalMS%2Faccess.all%20openid%20profile%20offline_access&redirect_uri=https%3A%2F%2Fruntpro.runt.gov.co%2F"
    SICOV_URL: str = "https://sicovindra.com:9093/"
    INDRA_URL: str = "https://indra.paynet.com.co:14443/Login.aspx?ReturnUrl=%2fInformacionSeguridad.aspx"
    
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
    
    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            return [i.strip() for i in v.split(",")]
        return v
    
    class Config:
        env_file = ".env"
        case_sensitive = True


# Instancia global de configuración
settings = Settings()
