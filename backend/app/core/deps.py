"""
Dependencias de autenticación y permisos
"""
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID

from app.db.database import get_db
from app.core.security import decode_token
from app.models.usuario import Usuario, RolEnum
from app.models.saas_user import SaaSUser
from app.models.tenant import Tenant

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
oauth2_scheme_saas = OAuth2PasswordBearer(tokenUrl="/api/v1/saas/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> Usuario:
    """
    Obtener usuario actual desde token JWT
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Decodificar token
    payload = decode_token(token)
    if payload is None:
        raise credentials_exception
    
    # Verificar que es access token
    if payload.get("type") != "access":
        raise credentials_exception

    # Verificar scope tenant
    if payload.get("auth_scope") != "tenant":
        raise credentials_exception
    
    # Obtener user_id
    user_id: Optional[str] = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    token_tenant_id: Optional[str] = payload.get("tenant_id")
    if token_tenant_id is None:
        raise credentials_exception
    
    # Buscar usuario en base de datos
    try:
        user_uuid = UUID(user_id)
        token_tenant_uuid = UUID(token_tenant_id)
    except ValueError:
        raise credentials_exception
    
    user = db.query(Usuario).filter(Usuario.id == user_uuid).first()
    
    if user is None:
        raise credentials_exception
    
    if not user.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo"
        )

    if user.tenant_id != token_tenant_uuid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Contexto de tenant inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )

    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant no encontrado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)
    if tenant.plan_actual == "demo" and tenant.demo_ends_at and tenant.demo_ends_at < now_ts:
        tenant.subscription_status = "pending_plan"
        db.commit()

    request_method = request.method if request else "GET"
    is_write_operation = request_method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
    if tenant.subscription_status == "pending_plan" and is_write_operation:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                "El tenant está en estado pendiente_de_plan. "
                "La operación de escritura está bloqueada hasta asignar un plan de pago."
            ),
        )
    
    return user


def get_current_saas_user(
    token: str = Depends(oauth2_scheme_saas),
    db: Session = Depends(get_db)
) -> SaaSUser:
    """Obtener usuario global SaaS desde JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales globales",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(token)
    if payload is None:
        raise credentials_exception

    if payload.get("type") != "access" or payload.get("auth_scope") != "saas":
        raise credentials_exception

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise credentials_exception

    user = db.query(SaaSUser).filter(SaaSUser.id == user_uuid).first()
    if user is None or not user.activo:
        raise credentials_exception

    token_session_version = payload.get("session_version")
    if token_session_version is not None and user.session_version != token_session_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión global invalidada",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def require_role(allowed_roles: list[str]):
    """
    Dependency para verificar rol de usuario
    """
    def role_checker(current_user: Usuario = Depends(get_current_user)) -> Usuario:
        if current_user.rol not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso denegado. Roles permitidos: {', '.join(allowed_roles)}"
            )
        return current_user
    
    return role_checker


def require_saas_role(allowed_roles: list[str]):
    """Dependency para verificar rol global SaaS."""
    def role_checker(current_user: SaaSUser = Depends(get_current_saas_user)) -> SaaSUser:
        if current_user.rol_global not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso denegado. Roles globales permitidos: {', '.join(allowed_roles)}"
            )
        return current_user

    return role_checker


# Dependencias específicas por rol
def get_admin(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Solo administradores"""
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden realizar esta acción"
        )
    return current_user


def get_cajero_or_admin(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Cajeros o administradores"""
    if current_user.rol not in [RolEnum.CAJERO, RolEnum.ADMINISTRADOR]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo cajeros o administradores pueden realizar esta acción"
        )
    return current_user


def get_recepcionista_or_admin(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Recepcionistas o administradores"""
    if current_user.rol not in [RolEnum.RECEPCIONISTA, RolEnum.ADMINISTRADOR]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo recepcionistas o administradores pueden realizar esta acción"
        )
    return current_user


def get_contador_or_admin(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Contadores o administradores"""
    if current_user.rol not in [RolEnum.CONTADOR, RolEnum.ADMINISTRADOR]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo contadores o administradores pueden realizar esta acción"
        )
    return current_user


def get_saas_owner(current_user: SaaSUser = Depends(get_current_saas_user)) -> SaaSUser:
    """Solo owner global SaaS."""
    if current_user.rol_global != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo owner SaaS puede realizar esta acción"
        )
    return current_user
