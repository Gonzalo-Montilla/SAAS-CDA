"""Schemas API Factus."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class FactusEnvCredentialsOut(BaseModel):
    """Credenciales de un ambiente (solo metadatos; nunca secretos en claro)."""

    client_id_configured: bool
    client_id_hint: Optional[str] = None
    client_secret_configured: bool
    api_username: Optional[str] = None
    api_password_configured: bool
    base_url: str


class FactusSettingsOut(BaseModel):
    modo: Literal["manual", "factus"]
    use_sandbox: bool
    sandbox: FactusEnvCredentialsOut
    production: FactusEnvCredentialsOut
    # Campos «activos» (mismo ambiente que use_sandbox) — compatibilidad con clientes que solo leen estos
    client_id_configured: bool
    client_id_hint: Optional[str] = None
    client_secret_configured: bool
    api_username: Optional[str] = None
    api_password_configured: bool
    default_numbering_range_id: Optional[int] = None
    base_url_effective: str


class FactusModoPatch(BaseModel):
    """Solo conmutar manual ↔ factus (admin del tenant, sin backoffice SaaS)."""

    modo: Literal["manual", "factus"]


class FactusSettingsUpdate(BaseModel):
    modo: Literal["manual", "factus"] = "manual"
    use_sandbox: bool = True
    # Sandbox (pruebas)
    client_id: Optional[str] = None
    client_secret: Optional[str] = Field(None, description="Si se omite o vacío, no cambia el secreto guardado.")
    api_username: Optional[str] = None
    api_password: Optional[str] = Field(None, description="Si se omite o vacío, no cambia la contraseña guardada.")
    # Producción
    production_client_id: Optional[str] = None
    production_client_secret: Optional[str] = Field(
        None, description="Si se omite o vacío, no cambia el secreto de producción guardado."
    )
    production_api_username: Optional[str] = None
    production_api_password: Optional[str] = Field(
        None, description="Si se omite o vacío, no cambia la contraseña API de producción guardada."
    )
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


class FactusMunicipalityItem(BaseModel):
    """Municipio GET /v1/municipalities — usar `id` en factus_municipality_id / payload Factus (no confundir con `code` DIAN)."""

    id: int
    code: Optional[str] = None
    name: Optional[str] = None
    department: Optional[str] = None
