"""
Conceptos de retención en documento soporte (fase 1: selección por tenant y por proveedor).
El cálculo numérico (UVT, %) se implementará en fase 2.
"""
from __future__ import annotations

# Valores persistidos en BD (snake_case estable)
CONCEPTOS_RETENCION_DSE: tuple[str, ...] = ("compras", "servicios", "arrendamiento", "honorarios")

LABEL_CONCEPTO_RETENCION_DSE: dict[str, str] = {
    "compras": "Compras",
    "servicios": "Servicios",
    "arrendamiento": "Arrendamiento",
    "honorarios": "Honorarios",
}


def normalizar_concepto_retencion_dse(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if s in CONCEPTOS_RETENCION_DSE:
        return s
    raise ValueError(
        f"Concepto de retención no válido. Use uno de: {', '.join(CONCEPTOS_RETENCION_DSE)}."
    )


def conceptos_habilitados_desde_tenant(row: TenantFactusSettings) -> set[str]:
    """Qué conceptos el CDA habilitó para documento soporte / motor futuro."""
    out: set[str] = set()
    if getattr(row, "dse_retencion_usar_compras", True):
        out.add("compras")
    if getattr(row, "dse_retencion_usar_servicios", True):
        out.add("servicios")
    if getattr(row, "dse_retencion_usar_arrendamiento", True):
        out.add("arrendamiento")
    if getattr(row, "dse_retencion_usar_honorarios", True):
        out.add("honorarios")
    return out


def validar_concepto_para_tenant(row: object, concepto: str) -> None:
    ok = conceptos_habilitados_desde_tenant(row)
    if concepto not in ok:
        hab = ", ".join(LABEL_CONCEPTO_RETENCION_DSE[c] for c in CONCEPTOS_RETENCION_DSE if c in ok) or "ninguno"
        raise ValueError(
            f"El concepto «{LABEL_CONCEPTO_RETENCION_DSE.get(concepto, concepto)}» no está habilitado "
            f"para su organización (habilitados: {hab}). Ajuste el entorno en Catálogo de proveedores o contacte al administrador."
        )


def entorno_tiene_al_menos_un_concepto(row: object) -> bool:
    return len(conceptos_habilitados_desde_tenant(row)) >= 1
