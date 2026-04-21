"""
Catálogo y cotización de planes SaaS (CDASOFT). Compartido por backoffice SaaS y app tenant.
"""
from __future__ import annotations

from fastapi import HTTPException, status

IVA_RATE = 0.19

# Tres planes de pago + demo. Montos COP; IVA se calcula sobre subtotal.
PLAN_DEFINITIONS: dict[str, dict] = {
    "demo": {
        "label": "DEMO",
        "duration_days": 15,
        "base_price": 0.0,
        "additional_branch_price": 0.0,
        "included_branches": 1,
        "is_prepay": False,
    },
    "basico": {
        "label": "BÁSICO",
        "duration_days": 90,
        "base_price": 450000.0,
        "additional_branch_price": 250000.0,
        "included_branches": 1,
        "is_prepay": True,
    },
    "emprendedor": {
        "label": "EMPRENDEDOR",
        "duration_days": 180,
        "base_price": 850000.0,
        "additional_branch_price": 450000.0,
        "included_branches": 1,
        "is_prepay": True,
    },
    "empresa": {
        "label": "EMPRESA",
        "duration_days": 365,
        "base_price": 1500000.0,
        "additional_branch_price": 650000.0,
        "included_branches": 1,
        "is_prepay": True,
    },
}


def plan_codes_for_public_checkout() -> list[str]:
    """Planes que el tenant puede contratar (excluye demo)."""
    return [c for c in PLAN_DEFINITIONS if c != "demo"]


def calculate_plan_quote(plan_code: str, sedes_totales: int) -> tuple[dict, int, float, float, float]:
    normalized_code = plan_code.strip().lower()
    if normalized_code not in PLAN_DEFINITIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan inválido")
    if sedes_totales < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sedes_totales debe ser mayor o igual a 1")

    plan = PLAN_DEFINITIONS[normalized_code]
    chargeable_additional = max(sedes_totales - (1 + plan["included_branches"]), 0)
    subtotal = plan["base_price"] + (chargeable_additional * plan["additional_branch_price"])
    iva = round(subtotal * IVA_RATE, 2)
    total = round(subtotal + iva, 2)
    return plan, chargeable_additional, round(subtotal, 2), iva, total


def calculate_chargeable_branches_for_tenant(plan_code: str, sedes_totales: int) -> tuple[int, int]:
    normalized_code = (plan_code or "demo").strip().lower()
    plan = PLAN_DEFINITIONS.get(normalized_code, PLAN_DEFINITIONS["demo"])
    included_branches = int(plan["included_branches"])
    chargeable_additional = max(int(sedes_totales) - (1 + included_branches), 0)
    return chargeable_additional, included_branches
