"""
Endpoints de autenticación global SaaS (backoffice).
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.deps import (
    get_db,
    get_current_saas_user,
    get_saas_owner,
    require_saas_role,
)
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.models.saas_user import SaaSUser
from app.schemas.auth import Token, RefreshTokenRequest
from app.schemas.saas_auth import SaaSUserCreate, SaaSUserResponse

router = APIRouter()


ALLOWED_GLOBAL_ROLES = {"owner", "finanzas", "comercial", "soporte"}
GLOBAL_ROLE_PERMISSIONS = {
    "owner": ["tenants:read", "tenants:write", "billing:read", "billing:write", "support:read", "support:write", "audit:read", "users:manage"],
    "finanzas": ["billing:read", "billing:write", "audit:read"],
    "comercial": ["tenants:read", "tenants:write", "billing:read"],
    "soporte": ["support:read", "support:write", "tenants:read", "audit:read"],
}


@router.post("/login", response_model=Token)
def saas_login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(SaaSUser).filter(SaaSUser.email == form_data.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.bloqueado_hasta and user.bloqueado_hasta > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Usuario global bloqueado temporalmente",
        )

    if not verify_password(form_data.password, user.hashed_password):
        user.intentos_fallidos += 1
        if user.intentos_fallidos >= 5:
            # Lockout básico para backoffice global (15 minutos).
            from datetime import timedelta
            user.bloqueado_hasta = datetime.now(timezone.utc) + timedelta(minutes=15)
            user.intentos_fallidos = 0
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario global inactivo",
        )

    user.intentos_fallidos = 0
    user.bloqueado_hasta = None
    db.commit()

    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "rol_global": user.rol_global,
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )
    refresh_token = create_refresh_token(
        data={
            "sub": str(user.id),
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/refresh", response_model=Token)
def saas_refresh_token(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    payload = decode_token(request.refresh_token)
    if payload is None or payload.get("type") != "refresh" or payload.get("auth_scope") != "saas":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    user_id = payload.get("sub")
    token_session_version = payload.get("session_version")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    try:
        user_uuid = UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    user = db.query(SaaSUser).filter(SaaSUser.id == user_uuid).first()
    if not user or not user.activo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario global no encontrado o inactivo",
        )

    if token_session_version is not None and user.session_version != token_session_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión global invalidada",
        )

    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "rol_global": user.rol_global,
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )
    refresh_token = create_refresh_token(
        data={
            "sub": str(user.id),
            "auth_scope": "saas",
            "session_version": user.session_version,
        }
    )

    return Token(access_token=access_token, refresh_token=refresh_token, token_type="bearer")


@router.get("/me", response_model=SaaSUserResponse)
def saas_me(current_user: SaaSUser = Depends(get_current_saas_user)):
    return current_user


@router.get("/permissions/me")
def saas_my_permissions(current_user: SaaSUser = Depends(get_current_saas_user)):
    return {
        "role": current_user.rol_global,
        "permissions": GLOBAL_ROLE_PERMISSIONS.get(current_user.rol_global, []),
    }


@router.get("/users", response_model=list[SaaSUserResponse])
def list_saas_users(
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(require_saas_role(["owner", "soporte"])),
):
    return db.query(SaaSUser).order_by(SaaSUser.created_at.desc()).all()


@router.post("/users", response_model=SaaSUserResponse, status_code=status.HTTP_201_CREATED)
def create_saas_user(
    user_data: SaaSUserCreate,
    db: Session = Depends(get_db),
    _: SaaSUser = Depends(get_saas_owner),
):
    if user_data.rol_global not in ALLOWED_GLOBAL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rol global inválido",
        )

    exists = db.query(SaaSUser).filter(SaaSUser.email == user_data.email).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email global ya está registrado",
        )

    user = SaaSUser(
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        nombre_completo=user_data.nombre_completo,
        rol_global=user_data.rol_global,
        activo=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/logout-all")
def saas_logout_all_sessions(
    db: Session = Depends(get_db),
    current_user: SaaSUser = Depends(get_current_saas_user),
):
    current_user.session_version += 1
    db.commit()
    return {"message": "Todas las sesiones globales fueron invalidadas"}
