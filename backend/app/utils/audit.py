"""
Utilidades para Auditoría
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional, Dict
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog, AuditAction
from app.models.usuario import Usuario

_audit_logger = logging.getLogger(__name__)


def _sanitize_for_json(value: Any) -> Any:
    """Convierte valores a tipos serializables en JSON (UUID, Enum, fechas, anidados)."""
    if value is None:
        return None
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value if hasattr(value, "value") else str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _sanitize_for_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_for_json(v) for v in value]
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def create_audit_log(
    db: Session,
    action: AuditAction,
    description: str,
    usuario: Optional[Usuario] = None,
    request: Optional[Request] = None,
    metadata: Optional[Dict[str, Any]] = None,
    success: str = "success",
    error_message: Optional[str] = None
) -> AuditLog:
    """
    Crear un registro de auditoría
    
    Args:
        db: Sesión de base de datos
        action: Tipo de acción (enum AuditAction)
        description: Descripción legible de la acción
        usuario: Usuario que realizó la acción (opcional)
        request: Request de FastAPI para obtener IP y User-Agent (opcional)
        metadata: Datos adicionales en formato dict (opcional)
        success: Estado: "success", "failed", "error"
        error_message: Mensaje de error si aplica
    
    Returns:
        AuditLog: El registro creado
    """
    # Extraer información del request
    ip_address = None
    user_agent = None
    
    if request:
        # Obtener IP real (considera proxies)
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            ip_address = forwarded.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else None
        
        user_agent = request.headers.get("User-Agent")

    safe_metadata = _sanitize_for_json(metadata) if metadata is not None else None

    # Crear registro
    audit_log = AuditLog(
        action=action.value if hasattr(action, 'value') else action,
        description=description,
        usuario_id=usuario.id if usuario else None,
        usuario_email=usuario.email if usuario else None,
        usuario_nombre=usuario.nombre_completo if usuario else None,
        usuario_rol=usuario.rol.value if usuario and hasattr(usuario.rol, 'value') else (usuario.rol if usuario else None),
        ip_address=ip_address,
        user_agent=user_agent,
        extra_data=safe_metadata,
        success=success,
        error_message=error_message
    )
    
    db.add(audit_log)
    db.commit()
    
    return audit_log


def audit_login_success(
    db: Session,
    usuario: Usuario,
    request: Request
):
    """Auditar login exitoso"""
    try:
        create_audit_log(
            db=db,
            action=AuditAction.LOGIN,
            description=f"Login exitoso: {usuario.email}",
            usuario=usuario,
            request=request,
            success="success",
        )
    except Exception:
        db.rollback()
        _audit_logger.exception("audit_login_success: fallo al escribir audit_logs (login sigue válido)")


def audit_login_failed(
    db: Session,
    email: str,
    request: Request,
    reason: str = "Credenciales incorrectas"
):
    """Auditar intento de login fallido"""
    try:
        create_audit_log(
            db=db,
            action=AuditAction.FAILED_LOGIN,
            description=f"Intento de login fallido: {email}",
            usuario=None,
            request=request,
            metadata={"email": email, "reason": reason},
            success="failed",
        )
    except Exception:
        db.rollback()
        _audit_logger.exception("audit_login_failed: fallo al escribir audit_logs")


def audit_caja_operation(
    db: Session,
    action: AuditAction,
    description: str,
    usuario: Usuario,
    request: Optional[Request] = None,
    metadata: Optional[Dict[str, Any]] = None
):
    """Auditar operaciones de caja"""
    create_audit_log(
        db=db,
        action=action,
        description=description,
        usuario=usuario,
        request=request,
        metadata=metadata
    )


def audit_tesoreria_operation(
    db: Session,
    action: AuditAction,
    description: str,
    usuario: Usuario,
    request: Optional[Request] = None,
    metadata: Optional[Dict[str, Any]] = None
):
    """Auditar operaciones de tesorería"""
    create_audit_log(
        db=db,
        action=action,
        description=description,
        usuario=usuario,
        request=request,
        metadata=metadata
    )


def audit_tarifa_operation(
    db: Session,
    action: AuditAction,
    description: str,
    usuario: Usuario,
    request: Optional[Request] = None,
    metadata: Optional[Dict[str, Any]] = None
):
    """Auditar operaciones de tarifas"""
    create_audit_log(
        db=db,
        action=action,
        description=description,
        usuario=usuario,
        request=request,
        metadata=metadata
    )
