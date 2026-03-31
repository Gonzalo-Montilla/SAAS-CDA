"""
API Router principal v1
"""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth,
    saas_auth,
    onboarding,
    vehiculos,
    cajas,
    tarifas,
    config,
    tesoreria,
    reportes,
    usuarios,
    notificaciones,
    support,
)

api_router = APIRouter()

# Incluir todos los routers de endpoints
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(saas_auth.router, prefix="/saas/auth", tags=["saas-auth"])
api_router.include_router(onboarding.router, prefix="/onboarding", tags=["onboarding"])
api_router.include_router(vehiculos.router, prefix="/vehiculos", tags=["vehiculos"])
api_router.include_router(cajas.router, prefix="/cajas", tags=["cajas"])
api_router.include_router(tarifas.router, prefix="/tarifas", tags=["tarifas"])
api_router.include_router(tesoreria.router, prefix="/tesoreria", tags=["tesoreria"])
api_router.include_router(reportes.router, prefix="/reportes", tags=["reportes"])
api_router.include_router(usuarios.router, prefix="/usuarios", tags=["usuarios"])
api_router.include_router(config.router, prefix="/config", tags=["config"])
api_router.include_router(notificaciones.router, prefix="/notificaciones", tags=["notificaciones"])
api_router.include_router(support.router, prefix="/support", tags=["support"])
