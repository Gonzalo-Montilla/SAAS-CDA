"""Schemas API Factus."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class FactusSettingsOut(BaseModel):
    modo: Literal["manual", "factus"]
    use_sandbox: bool
    client_id_configured: bool
    client_id_hint: Optional[str] = None  # últimos 4 caracteres si aplica
    client_secret_configured: bool
    api_username: Optional[str] = None
    api_password_configured: bool
    default_numbering_range_id: Optional[int] = None
    base_url_effective: str


class FactusSettingsUpdate(BaseModel):
    modo: Literal["manual", "factus"] = "manual"
    use_sandbox: bool = True
    client_id: Optional[str] = None
    client_secret: Optional[str] = Field(None, description="Si se omite o vacío, no cambia el secreto guardado.")
    api_username: Optional[str] = None
    api_password: Optional[str] = Field(None, description="Si se omite o vacío, no cambia la contraseña guardada.")
    default_numbering_range_id: Optional[int] = None


class FactusTestConnectionResult(BaseModel):
    ok: bool
    message: str
    expires_in: Optional[int] = None
    token_type: Optional[str] = None
    environment: Literal["sandbox", "production"]


class FactusNumberingRangeItem(BaseModel):
    """Rango devuelto por GET /v1/numbering-ranges (Factus). `id` = default_numbering_range_id."""

    id: int
    document: Optional[str] = None
    prefix: Optional[str] = None
    resolution_number: Optional[str] = None
    is_expired: Optional[bool] = None
    is_active: Optional[int] = None
    current: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
