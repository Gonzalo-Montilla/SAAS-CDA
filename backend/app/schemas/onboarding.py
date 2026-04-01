"""
Schemas para onboarding/autoregistro de tenant CDA.
"""
from pydantic import BaseModel, EmailStr, Field


class TenantSelfRegisterRequest(BaseModel):
    nombre_cda: str = Field(min_length=3, max_length=200)
    nit_cda: str = Field(min_length=5, max_length=30)
    correo_electronico: EmailStr
    nombre_representante_legal_o_administrador: str = Field(min_length=3, max_length=200)
    celular: str = Field(min_length=7, max_length=30)
    sedes_totales: int = Field(default=1, ge=1, le=100)
    admin_password: str = Field(min_length=6, max_length=128)
    logo_url: str | None = Field(default=None, max_length=500)
    codigo_verificacion_email: str | None = Field(default=None, min_length=6, max_length=6)
    captcha_token: str | None = Field(default=None, max_length=2048)


class TenantSelfRegisterResponse(BaseModel):
    tenant_id: str
    tenant_slug: str
    admin_email: EmailStr
    login_url: str


class OnboardingSendCodeRequest(BaseModel):
    correo_electronico: EmailStr
    nombre_cda: str = Field(min_length=3, max_length=200)


class OnboardingSendCodeResponse(BaseModel):
    message: str
