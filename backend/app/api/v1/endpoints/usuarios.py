"""
Endpoints de Gestión de Usuarios
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import datetime, timezone

from app.core.deps import get_db, get_current_user, get_admin
from app.core.sucursal_scope import assert_sucursal_in_tenant, default_sucursal_id_for_login
from app.models.usuario import Usuario, RolEnum
from app.core.security import get_password_hash, validate_password_strength
from pydantic import BaseModel, EmailStr, field_serializer
from uuid import UUID
from app.utils.audit import create_audit_log
from app.models.audit_log import AuditAction

router = APIRouter()


# ==================== SCHEMAS ====================

class UsuarioCreate(BaseModel):
    email: EmailStr
    password: str
    nombre_completo: str
    rol: RolEnum
    sucursal_id: Optional[UUID] = None


class UsuarioUpdate(BaseModel):
    email: Optional[EmailStr] = None
    nombre_completo: Optional[str] = None
    rol: Optional[RolEnum] = None
    activo: Optional[bool] = None
    sucursal_id: Optional[UUID] = None


class UsuarioChangePassword(BaseModel):
    password: str


class UsuarioResponse(BaseModel):
    id: str
    email: str
    nombre_completo: str
    rol: str
    activo: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True
    
    @field_serializer('id')
    def serialize_id(self, value: UUID, _info):
        return str(value)


# ==================== ENDPOINTS ====================

@router.get("/")
def listar_usuarios(
    skip: int = 0,
    limit: int = 100,
    buscar: Optional[str] = None,
    rol: Optional[RolEnum] = None,
    activo: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Listar todos los usuarios del sistema (solo Admin)
    """
    query = db.query(Usuario).filter(Usuario.tenant_id == current_user.tenant_id)
    
    # Filtro de búsqueda
    if buscar:
        query = query.filter(
            or_(
                Usuario.nombre_completo.ilike(f"%{buscar}%"),
                Usuario.email.ilike(f"%{buscar}%")
            )
        )
    
    # Filtro por rol
    if rol:
        query = query.filter(Usuario.rol == rol)
    
    # Filtro por estado
    if activo is not None:
        query = query.filter(Usuario.activo == activo)
    
    # Ordenar por fecha de creación (más recientes primero)
    query = query.order_by(Usuario.created_at.desc())
    
    usuarios = query.offset(skip).limit(limit).all()
    
    # Convertir manualmente a diccionarios
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "nombre_completo": u.nombre_completo,
            "rol": u.rol.value if hasattr(u.rol, 'value') else u.rol,
            "activo": u.activo,
            "sucursal_id": str(u.sucursal_id) if u.sucursal_id else None,
            "created_at": u.created_at,
            "updated_at": u.updated_at
        }
        for u in usuarios
    ]


@router.get("/estadisticas")
def obtener_estadisticas_usuarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Estadísticas de usuarios del sistema
    """
    total_usuarios = db.query(func.count(Usuario.id)).filter(Usuario.tenant_id == current_user.tenant_id).scalar()
    usuarios_activos = db.query(func.count(Usuario.id)).filter(
        Usuario.tenant_id == current_user.tenant_id,
        Usuario.activo == True
    ).scalar()
    usuarios_inactivos = total_usuarios - usuarios_activos
    
    # Contar por rol (solo roles que existen en la base de datos)
    usuarios_por_rol = {}
    for rol in RolEnum:
        try:
            count = db.query(func.count(Usuario.id)).filter(
                Usuario.tenant_id == current_user.tenant_id,
                Usuario.rol == rol
            ).scalar()
            usuarios_por_rol[rol.value] = count
        except Exception as e:
            # Si el rol no existe en el enum de la BD, poner 0
            usuarios_por_rol[rol.value] = 0
    
    return {
        "total_usuarios": total_usuarios,
        "usuarios_activos": usuarios_activos,
        "usuarios_inactivos": usuarios_inactivos,
        "por_rol": usuarios_por_rol
    }


@router.get("/{usuario_id}")
def obtener_usuario(
    usuario_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener detalles de un usuario específico
    """
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_user.tenant_id
    ).first()
    
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )
    
    # Devolver como diccionario con conversión manual de UUID
    return {
        "id": str(usuario.id),
        "email": usuario.email,
        "nombre_completo": usuario.nombre_completo,
        "rol": usuario.rol.value if hasattr(usuario.rol, 'value') else usuario.rol,
        "activo": usuario.activo,
        "sucursal_id": str(usuario.sucursal_id) if usuario.sucursal_id else None,
        "created_at": usuario.created_at,
        "updated_at": usuario.updated_at
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
def crear_usuario(
    request: Request,
    usuario_data: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Crear un nuevo usuario (solo Admin)
    """
    # Verificar que el email no exista
    existing_user = db.query(Usuario).filter(
        Usuario.email == usuario_data.email,
        Usuario.tenant_id == current_user.tenant_id
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un usuario con este email"
        )
    
    try:
        validate_password_strength(usuario_data.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if usuario_data.sucursal_id is not None:
        assert_sucursal_in_tenant(db, usuario_data.sucursal_id, current_user.tenant_id)
        target_sede = usuario_data.sucursal_id
    else:
        target_sede = default_sucursal_id_for_login(db, current_user)

    # Crear usuario
    nuevo_usuario = Usuario(
        tenant_id=current_user.tenant_id,
        sucursal_id=target_sede,
        email=usuario_data.email,
        hashed_password=get_password_hash(usuario_data.password),
        nombre_completo=usuario_data.nombre_completo,
        rol=usuario_data.rol,
        activo=True
    )
    
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    
    # Auditar creación de usuario
    create_audit_log(
        db=db,
        action=AuditAction.CREATE_USER,
        description=f"Usuario creado: {nuevo_usuario.email} - Rol: {nuevo_usuario.rol.value}",
        usuario=current_user,
        request=request,
        metadata={
            "usuario_creado_email": nuevo_usuario.email,
            "usuario_creado_id": str(nuevo_usuario.id),
            "rol": nuevo_usuario.rol.value,
            "sucursal_id": str(target_sede),
        }
    )
    
    # Devolver como diccionario con conversión manual de UUID
    return {
        "id": str(nuevo_usuario.id),
        "email": nuevo_usuario.email,
        "nombre_completo": nuevo_usuario.nombre_completo,
        "rol": nuevo_usuario.rol.value if hasattr(nuevo_usuario.rol, 'value') else nuevo_usuario.rol,
        "activo": nuevo_usuario.activo,
        "sucursal_id": str(nuevo_usuario.sucursal_id) if nuevo_usuario.sucursal_id else None,
        "created_at": nuevo_usuario.created_at,
        "updated_at": nuevo_usuario.updated_at
    }


@router.put("/{usuario_id}")
def actualizar_usuario(
    request: Request,
    usuario_id: str,
    usuario_data: UsuarioUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Actualizar información de un usuario (solo Admin)
    """
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_user.tenant_id
    ).first()
    
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )
    
    # Verificar email único si se está cambiando
    if usuario_data.email and usuario_data.email != usuario.email:
        existing_user = db.query(Usuario).filter(
            Usuario.email == usuario_data.email,
            Usuario.tenant_id == current_user.tenant_id
        ).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un usuario con este email"
            )
        usuario.email = usuario_data.email
    
    # Actualizar campos
    if usuario_data.nombre_completo is not None:
        usuario.nombre_completo = usuario_data.nombre_completo
    
    if usuario_data.rol is not None:
        usuario.rol = usuario_data.rol
    
    if usuario_data.activo is not None:
        usuario.activo = usuario_data.activo

    if usuario_data.sucursal_id is not None:
        assert_sucursal_in_tenant(db, usuario_data.sucursal_id, current_user.tenant_id)
        usuario.sucursal_id = usuario_data.sucursal_id
    
    usuario.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(usuario)
    
    # Auditar actualización
    create_audit_log(
        db=db,
        action=AuditAction.UPDATE_USER,
        description=f"Usuario actualizado: {usuario.email}",
        usuario=current_user,
        request=request,
        metadata={
            "usuario_actualizado_id": str(usuario.id),
            "usuario_actualizado_email": usuario.email,
            "cambios": usuario_data.model_dump(exclude_unset=True)
        }
    )
    
    # Devolver como diccionario con conversión manual de UUID
    return {
        "id": str(usuario.id),
        "email": usuario.email,
        "nombre_completo": usuario.nombre_completo,
        "rol": usuario.rol.value if hasattr(usuario.rol, 'value') else usuario.rol,
        "activo": usuario.activo,
        "sucursal_id": str(usuario.sucursal_id) if usuario.sucursal_id else None,
        "created_at": usuario.created_at,
        "updated_at": usuario.updated_at
    }


@router.patch("/{usuario_id}/cambiar-password")
def cambiar_password(
    request: Request,
    usuario_id: str,
    password_data: UsuarioChangePassword,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Cambiar contraseña de un usuario (solo Admin)
    """
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_user.tenant_id
    ).first()
    
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )
    
    try:
        validate_password_strength(password_data.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    # Actualizar contraseña
    usuario.hashed_password = get_password_hash(password_data.password)
    usuario.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    
    # Auditar cambio de contraseña
    create_audit_log(
        db=db,
        action=AuditAction.CHANGE_PASSWORD,
        description=f"Admin cambió contraseña de usuario: {usuario.email}",
        usuario=current_user,
        request=request,
        metadata={
            "usuario_afectado_id": str(usuario.id),
            "usuario_afectado_email": usuario.email
        }
    )
    
    return {"message": "Contraseña actualizada exitosamente"}


@router.patch("/{usuario_id}/toggle-estado")
def toggle_estado_usuario(
    request: Request,
    usuario_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Activar/Desactivar un usuario (solo Admin)
    """
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_user.tenant_id
    ).first()
    
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )
    
    # No permitir desactivar al propio admin
    if usuario.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes desactivar tu propia cuenta"
        )
    
    estado_anterior = usuario.activo

    # Toggle estado
    usuario.activo = not usuario.activo
    usuario.updated_at = datetime.now(timezone.utc)
    
    db.commit()
    db.refresh(usuario)

    create_audit_log(
        db=db,
        action=AuditAction.UPDATE_USER,
        description=f"Estado de usuario cambiado: {usuario.email} ({'activo' if estado_anterior else 'inactivo'} -> {'activo' if usuario.activo else 'inactivo'})",
        usuario=current_user,
        request=request,
        metadata={
            "usuario_afectado_id": str(usuario.id),
            "usuario_afectado_email": usuario.email,
            "estado_anterior": estado_anterior,
            "estado_nuevo": usuario.activo,
        },
    )
    
    return {
        "message": f"Usuario {'activado' if usuario.activo else 'desactivado'} exitosamente",
        "activo": usuario.activo
    }


@router.delete("/{usuario_id}")
def eliminar_usuario(
    request: Request,
    usuario_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Eliminar un usuario (solo Admin)
    ADVERTENCIA: Esto eliminará permanentemente el usuario
    """
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_user.tenant_id
    ).first()
    
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado"
        )
    
    # No permitir eliminar al propio admin
    if usuario.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminar tu propia cuenta"
        )
    
    # Auditar eliminación antes de borrar
    create_audit_log(
        db=db,
        action=AuditAction.DELETE_USER,
        description=f"Usuario eliminado: {usuario.email} - Rol: {usuario.rol.value if hasattr(usuario.rol, 'value') else usuario.rol}",
        usuario=current_user,
        request=request,
        metadata={
            "usuario_eliminado_id": str(usuario.id),
            "usuario_eliminado_email": usuario.email,
            "usuario_eliminado_rol": usuario.rol.value if hasattr(usuario.rol, 'value') else usuario.rol
        }
    )
    
    db.delete(usuario)
    db.commit()
    
    return {"message": "Usuario eliminado exitosamente"}
