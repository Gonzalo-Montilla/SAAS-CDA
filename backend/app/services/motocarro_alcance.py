"""Alcance ONAC de motocarro por tenant."""
from __future__ import annotations

from fastapi import HTTPException, status


def es_tipo_motocarro(tipo: str | None) -> bool:
    return (tipo or "").strip().lower().startswith("motocarro")


def tenant_inspecciona_motocarro(tenant) -> bool:
    return bool(getattr(tenant, "motocarro_enabled", False)) if tenant is not None else False


def exigir_motocarro_habilitado(tenant, tipo_vehiculo: str | None) -> None:
    if not es_tipo_motocarro(tipo_vehiculo):
        return
    if tenant_inspecciona_motocarro(tenant):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Este CDA no tiene habilitada la inspección de motocarro.",
    )


def activar_motocarro_en_tenant(tenant) -> bool:
    """Prende el alcance si estaba apagado. Devuelve True si cambió."""
    if tenant is None or tenant_inspecciona_motocarro(tenant):
        return False
    tenant.motocarro_enabled = True
    return True
