"""
Umbrales mínimos en UVT antes de aplicar retención en la fuente, por concepto agregado.

Valores orientativos según tablas de referencia DIAN (p. ej. compras ≥10 UVT, servicios ≥2 UVT).
El modelo de datos del producto usa un concepto por proveedor; subtipos (declarante / muebles vs inmuebles)
se refinarán cuando haya columnas o reglas adicionales en BD.
"""
from __future__ import annotations

from decimal import Decimal

from app.core.dse_retencion_conceptos import normalizar_concepto_retencion_dse

# Base mínima en UVT (≥) para exigir retención sobre el pago, por concepto simplificado.
UMBRAL_UVT_BASE_MINIMA: dict[str, Decimal] = {
    "compras": Decimal("10"),
    "servicios": Decimal("2"),
    # Arrendamiento inmuebles suele usar 10 UVT; muebles puede ser distinto — revisar con contadora.
    "arrendamiento": Decimal("10"),
    "honorarios": Decimal("0"),
}


def umbral_uvt_para_concepto(concepto: str) -> Decimal:
    c = normalizar_concepto_retencion_dse(concepto)
    return UMBRAL_UVT_BASE_MINIMA.get(c, Decimal("0"))
