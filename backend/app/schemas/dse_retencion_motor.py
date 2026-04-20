"""Lectura/escritura parámetros motor retención DSE (UVT + tasas %)."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class DseRetencionParametrosOut(BaseModel):
    anio: int
    valor_uvt_cop: Optional[Decimal] = None
    tasas: dict[str, Optional[Decimal]] = Field(
        default_factory=dict,
        description="Por concepto: porcentaje 0–100 o null si no configurado.",
    )


class DseRetencionPreviewIn(BaseModel):
    """Simulación de retención sobre un monto de pago (egreso)."""

    monto: Decimal = Field(gt=0, description="Base del pago en COP (valor positivo).")
    concepto: str = Field(min_length=3, max_length=32)
    anio: int = Field(ge=2000, le=2100, description="Año fiscal para UVT y tasa guardados.")


class DseRetencionPreviewOut(BaseModel):
    retencion_cop: Optional[str] = None
    aplica: bool
    base_minima_cop: Optional[str] = None
    umbral_uvt: str
    tasa_porcentaje: Optional[str] = None
    valor_uvt_cop: Optional[str] = None
    motivo_sin_calculo: Optional[str] = None


class DseRetencionParametrosPut(BaseModel):
    """PATCH parcial: solo campos enviados se actualizan."""

    valor_uvt_cop: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        description="Valor 1 UVT en COP. Enviar null para borrar el valor del año.",
    )
    tasas: Optional[dict[str, Optional[Decimal]]] = Field(
        default=None,
        description="Claves: compras, servicios, arrendamiento, honorarios. null borra la tasa.",
    )
