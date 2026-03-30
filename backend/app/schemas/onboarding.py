"""
Schemas para onboarding/autoregistro de tenant CDA.
"""
from pydantic import BaseModel, EmailStr, Field


class TenantSelfRegisterRequest(BaseModel):
    nombre_cda: str = Field(min_length=3, max_length=200)
    admin_nombre_completo: str = Field(min_length=3, max_length=200)
    admin_email: EmailStr
    admin_password: str = Field(min_length=6, max_length=128)
    logo_url: str | None = Field(default=None, max_length=500)


class TenantSelfRegisterResponse(BaseModel):
    tenant_id: str
    tenant_slug: str
    admin_email: EmailStr
