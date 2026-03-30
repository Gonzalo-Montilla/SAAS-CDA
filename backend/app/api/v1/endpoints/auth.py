"""
Endpoints de autenticación
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta, timezone
import secrets
from uuid import UUID

from app.core.deps import get_db, get_current_user, get_admin
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token, decode_token
from app.core.config import settings
from app.models.usuario import Usuario
from app.models.password_reset_token import PasswordResetToken
from app.schemas.auth import Token, UserRegister, PasswordChange, RefreshTokenRequest
from app.schemas.usuario import UsuarioResponse
from app.utils.email import enviar_email, generar_email_recuperacion_password
from app.utils.audit import audit_login_success, audit_login_failed, create_audit_log
from app.models.audit_log import AuditAction

router = APIRouter()


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(
    user_data: UserRegister,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_admin)  # Solo admin puede crear usuarios
):
    """
    Registrar nuevo usuario (solo administradores)
    """
    # Verificar si el email ya existe
    existing_user = db.query(Usuario).filter(Usuario.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email ya está registrado"
        )
    
    # Crear usuario
    hashed_password = get_password_hash(user_data.password)
    new_user = Usuario(
        tenant_id=admin.tenant_id,
        email=user_data.email,
        hashed_password=hashed_password,
        nombre_completo=user_data.nombre_completo,
        rol=user_data.rol,
        activo=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Generar tokens
    access_token = create_access_token(
        data={
            "sub": str(new_user.id),
            "rol": new_user.rol,
            "tenant_id": str(new_user.tenant_id),
            "auth_scope": "tenant",
        }
    )
    refresh_token = create_refresh_token(
        data={
            "sub": str(new_user.id),
            "tenant_id": str(new_user.tenant_id),
            "auth_scope": "tenant",
        }
    )
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer"
    )


@router.post("/login", response_model=Token)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    Login de usuario con email y contraseña
    """
    # Buscar usuario por email
    user = db.query(Usuario).filter(Usuario.email == form_data.username).first()
    
    if not user:
        # Auditar login fallido
        audit_login_failed(db, form_data.username, request, "Usuario no encontrado")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verificar contraseña
    if not verify_password(form_data.password, user.hashed_password):
        # Auditar login fallido
        audit_login_failed(db, form_data.username, request, "Contraseña incorrecta")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verificar que el usuario esté activo
    if not user.activo:
        # Auditar intento de login con usuario inactivo
        audit_login_failed(db, form_data.username, request, "Usuario inactivo")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo"
        )
    
    # Auditar login exitoso
    audit_login_success(db, user, request)
    
    # Generar tokens
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "rol": user.rol,
            "tenant_id": str(user.tenant_id),
            "auth_scope": "tenant",
        }
    )
    refresh_token = create_refresh_token(
        data={
            "sub": str(user.id),
            "tenant_id": str(user.tenant_id),
            "auth_scope": "tenant",
        }
    )
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer"
    )


@router.post("/refresh", response_model=Token)
def refresh_token(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Renovar access token usando refresh token
    """
    # Decodificar refresh token
    payload = decode_token(request.refresh_token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )
    
    # Verificar que es un refresh token
    if payload.get("type") != "refresh" or payload.get("auth_scope") != "tenant":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )
    
    user_id = payload.get("sub")
    token_tenant_id = payload.get("tenant_id")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )
    if token_tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )
    
    # Buscar usuario
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user or not user.activo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado o inactivo"
        )

    try:
        if user.tenant_id != UUID(token_tenant_id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido para este tenant"
            )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )
    
    # Generar nuevos tokens
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "rol": user.rol,
            "tenant_id": str(user.tenant_id),
            "auth_scope": "tenant",
        }
    )
    new_refresh_token = create_refresh_token(
        data={
            "sub": str(user.id),
            "tenant_id": str(user.tenant_id),
            "auth_scope": "tenant",
        }
    )
    
    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer"
    )


@router.get("/me", response_model=UsuarioResponse)
def get_current_user_info(
    current_user: Usuario = Depends(get_current_user)
):
    """
    Obtener información del usuario actual
    """
    return current_user


@router.post("/change-password")
def change_password(
    request: Request,
    password_data: PasswordChange,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Cambiar contraseña del usuario actual
    """
    # Verificar contraseña actual
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contraseña actual incorrecta"
        )
    
    # Actualizar contraseña
    current_user.hashed_password = get_password_hash(password_data.new_password)
    db.commit()
    
    # Auditar cambio de contraseña
    create_audit_log(
        db=db,
        action=AuditAction.CHANGE_PASSWORD,
        description=f"Usuario cambió su propia contraseña: {current_user.email}",
        usuario=current_user,
        request=request
    )
    
    return {"message": "Contraseña actualizada exitosamente"}


# ==================== RECUPERACIÓN DE CONTRASEÑA ====================

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/forgot-password")
def forgot_password(
    request: ForgotPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Solicitar recuperación de contraseña. Envía un email con enlace de recuperación.
    """
    # Buscar usuario por email
    usuario = db.query(Usuario).filter(Usuario.email == request.email).first()
    
    # Por seguridad, siempre devolvemos el mismo mensaje aunque el email no exista
    if not usuario:
        return {
            "message": "Si el email existe en el sistema, recibirás instrucciones para recuperar tu contraseña"
        }
    
    # Generar token único y seguro
    token = secrets.token_urlsafe(32)
    expira_en = datetime.now(timezone.utc) + timedelta(minutes=30)  # Válido por 30 minutos
    
    # Guardar token en la base de datos
    reset_token = PasswordResetToken(
        usuario_id=usuario.id,
        token=token,
        expira_en=expira_en,
        usado=False
    )
    db.add(reset_token)
    db.commit()
    
    # Generar enlace de recuperación
    enlace_reset = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    
    # Generar y enviar email
    cuerpo_email = generar_email_recuperacion_password(
        nombre=usuario.nombre_completo,
        enlace_reset=enlace_reset
    )
    
    envio_exitoso = enviar_email(
        destinatario=usuario.email,
        asunto="Recuperación de Contraseña - CDASOFT",
        cuerpo_html=cuerpo_email
    )
    
    if not envio_exitoso:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al enviar el email. Intenta nuevamente más tarde"
        )
    
    return {
        "message": "Si el email existe en el sistema, recibirás instrucciones para recuperar tu contraseña"
    }


@router.post("/reset-password")
def reset_password(
    request: ResetPasswordRequest,
    db: Session = Depends(get_db)
):
    """
    Restablecer contraseña usando token válido
    """
    # Buscar token en la base de datos
    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == request.token
    ).first()
    
    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token inválido o expirado"
        )
    
    # Verificar que no haya sido usado
    if reset_token.usado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este token ya fue utilizado"
        )
    
    # Verificar que no haya expirado
    if datetime.now(timezone.utc) > reset_token.expira_en:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El token ha expirado. Solicita una nueva recuperación"
        )
    
    # Buscar usuario asociado
    usuario = db.query(Usuario).filter(Usuario.id == reset_token.usuario_id).first()
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )
    
    # Actualizar contraseña
    usuario.hashed_password = get_password_hash(request.new_password)
    usuario.updated_at = datetime.now(timezone.utc)
    
    # Marcar token como usado
    reset_token.usado = True
    
    db.commit()
    
    return {"message": "Contraseña actualizada exitosamente"}
