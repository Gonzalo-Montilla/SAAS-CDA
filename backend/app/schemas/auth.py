"""
Schemas de autenticación
"""
from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    """Token de acceso y refresco"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """Payload del token JWT"""
    sub: str  # user_id
    rol: str | None = None
    tenant_id: str | None = None
    rol_global: str | None = None
    auth_scope: str | None = None
    session_version: int | None = None
    exp: int


class UserLogin(BaseModel):
    """Datos de login"""
    email: EmailStr
    password: str


class UserRegister(BaseModel):
    """Registro de nuevo usuario (solo admin puede crear)"""
    email: EmailStr
    password: str = Field(min_length=6)
    nombre_completo: str = Field(min_length=3, max_length=200)
    rol: str = Field(default="cajero")


class PasswordChange(BaseModel):
    """Cambio de contraseña"""
    current_password: str
    new_password: str = Field(min_length=6)


class RefreshTokenRequest(BaseModel):
    """Request para refrescar token"""
    refresh_token: str
