"""
Dependencias de autenticación y permisos
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID

from app.db.database import get_db
from app.core.security import decode_token
from app.models.usuario import Usuario, RolEnum

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
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
