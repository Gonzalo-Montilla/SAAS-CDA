"""
Endpoints de Gestión de Usuarios
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from sqlalchemy.exc import DataError, IntegrityError
from typing import List, Optional
from datetime import datetime, timezone

from app.core.deps import get_db, get_current_user, get_admin
from app.core.sucursal_scope import (
    assert_sucursal_in_tenant,
    assert_user_may_operate_sucursal,
    default_sucursal_id_for_login,
    es_gerente,
    replace_usuario_sucursales,
    rol_usa_lista_sedes,
    assigned_sucursal_ids,
    roles_ambito_marca,
    user_may_manage_usuario,
)
from app.models.usuario import Usuario, RolEnum, UsuarioSucursal
from app.core.security import get_password_hash, validate_password_strength
from pydantic import BaseModel, EmailStr, field_serializer
from uuid import UUID
from app.utils.audit import create_audit_log
from app.models.audit_log import AuditAction

router = APIRouter()


def _ids_desde_payload(
    sucursal_id: Optional[UUID],
    sucursal_ids: Optional[List[UUID]],
) -> list[UUID]:
    out: list[UUID] = []
    seen: set[UUID] = set()
    for sid in list(sucursal_ids or []) + ([sucursal_id] if sucursal_id else []):
        if sid is None or sid in seen:
            continue
        seen.add(sid)
        out.append(sid)
    return out


def _validar_sedes_asignables(
    db: Session,
    current_user: Usuario,
    *,
    rol_nuevo: RolEnum,
    sucursal_ids: list[UUID],
) -> list[UUID]:
    if rol_nuevo in roles_ambito_marca() and not es_gerente(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un gerente puede crear o asignar roles de marca (gerente, contador u oficial).",
        )
    ids = list(sucursal_ids)
    if rol_usa_lista_sedes(rol_nuevo):
        if not ids:
            ids = [default_sucursal_id_for_login(db, current_user)]
        for sid in ids:
            assert_sucursal_in_tenant(db, sid, current_user.tenant_id)
            if not es_gerente(current_user):
                assert_user_may_operate_sucursal(db, current_user, sid)
        return ids
    if ids:
        for sid in ids:
            assert_sucursal_in_tenant(db, sid, current_user.tenant_id)
        return ids
    return [default_sucursal_id_for_login(db, current_user)]


def _usuario_dict(u: Usuario, db: Session) -> dict:
    ids = assigned_sucursal_ids(db, u)
    return {
        "id": str(u.id),
        "email": u.email,
        "nombre_completo": u.nombre_completo,
        "rol": u.rol.value if hasattr(u.rol, "value") else u.rol,
        "activo": u.activo,
        "sucursal_id": str(u.sucursal_id) if u.sucursal_id else None,
        "sucursal_ids": [str(x) for x in ids],
        "created_at": u.created_at,
        "updated_at": u.updated_at,
    }


def _assert_puede_gestionar_usuario(db: Session, actor: Usuario, target: Usuario) -> None:
    if not user_may_manage_usuario(db, actor, target):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No puedes gestionar usuarios fuera de tus sedes.",
        )


def _query_usuarios_visibles(db: Session, current_user: Usuario):
    query = db.query(Usuario).filter(Usuario.tenant_id == current_user.tenant_id)
    if es_gerente(current_user):
        return query
    allowed = list(assigned_sucursal_ids(db, current_user))
    if current_user.sucursal_id and current_user.sucursal_id not in allowed:
        allowed.append(current_user.sucursal_id)
    if not allowed:
        from sqlalchemy import false as sql_false
        return query.filter(sql_false())
    return query.filter(
        Usuario.rol.in_(
            (RolEnum.ADMINISTRADOR, RolEnum.CAJERO, RolEnum.RECEPCIONISTA, RolEnum.COMERCIAL)
        ),
        or_(
            Usuario.sucursal_id.in_(allowed),
            Usuario.id.in_(
                db.query(UsuarioSucursal.usuario_id).filter(UsuarioSucursal.sucursal_id.in_(allowed))
            ),
        ),
    )


# ==================== SCHEMAS ====================

class UsuarioCreate(BaseModel):
    email: EmailStr
    password: str
    nombre_completo: str
    rol: RolEnum
    sucursal_id: Optional[UUID] = None
    sucursal_ids: Optional[List[UUID]] = None


class UsuarioUpdate(BaseModel):
    email: Optional[EmailStr] = None
    nombre_completo: Optional[str] = None
    rol: Optional[RolEnum] = None
    activo: Optional[bool] = None
    sucursal_id: Optional[UUID] = None
    sucursal_ids: Optional[List[UUID]] = None


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
    Listar usuarios visibles según el alcance de sedes
    """
    query = _query_usuarios_visibles(db, current_user)
    
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
    return [_usuario_dict(u, db) for u in usuarios]


@router.get("/estadisticas")
def obtener_estadisticas_usuarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Estadísticas de usuarios visibles según el alcance de sedes
    """
    base = _query_usuarios_visibles(db, current_user)
    total_usuarios = base.count()
    usuarios_activos = base.filter(Usuario.activo == True).count()
    usuarios_inactivos = total_usuarios - usuarios_activos

    usuarios_por_rol = {}
    for rol in RolEnum:
        try:
            usuarios_por_rol[rol.value] = _query_usuarios_visibles(db, current_user).filter(Usuario.rol == rol).count()
        except Exception:
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
    _assert_puede_gestionar_usuario(db, current_user, usuario)
    
    return _usuario_dict(usuario, db)


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
        Usuario.email == usuario_data.email
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un usuario con este email en la plataforma"
        )
    
    try:
        validate_password_strength(usuario_data.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if usuario_data.sucursal_id is not None or usuario_data.sucursal_ids:
        ids = _ids_desde_payload(usuario_data.sucursal_id, usuario_data.sucursal_ids)
    else:
        ids = []
    ids = _validar_sedes_asignables(
        db, current_user, rol_nuevo=usuario_data.rol, sucursal_ids=ids
    )
    target_sede = ids[0]

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
    db.flush()
    if rol_usa_lista_sedes(usuario_data.rol):
        replace_usuario_sucursales(db, nuevo_usuario, ids)
    else:
        replace_usuario_sucursales(db, nuevo_usuario, [])
    try:
        db.commit()
    except (IntegrityError, DataError):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo crear el usuario. Verifica email, rol y vuelve a intentar.",
        )
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
    
    return _usuario_dict(nuevo_usuario, db)


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
    _assert_puede_gestionar_usuario(db, current_user, usuario)

    # Verificar email único si se está cambiando
    if usuario_data.email and usuario_data.email != usuario.email:
        existing_user = db.query(Usuario).filter(
            Usuario.email == usuario_data.email
        ).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un usuario con este email en la plataforma"
            )
        usuario.email = usuario_data.email
    
    # Actualizar campos
    if usuario_data.nombre_completo is not None:
        usuario.nombre_completo = usuario_data.nombre_completo
    
    if usuario_data.rol is not None:
        usuario.rol = usuario_data.rol
    
    if usuario_data.activo is not None:
        usuario.activo = usuario_data.activo

    rol_final = usuario.rol
    if usuario_data.sucursal_ids is not None or usuario_data.sucursal_id is not None:
        ids = _ids_desde_payload(usuario_data.sucursal_id, usuario_data.sucursal_ids)
        ids = _validar_sedes_asignables(db, current_user, rol_nuevo=rol_final, sucursal_ids=ids)
        if rol_usa_lista_sedes(rol_final):
            replace_usuario_sucursales(db, usuario, ids)
        else:
            replace_usuario_sucursales(db, usuario, [])
            if ids:
                usuario.sucursal_id = ids[0]
    elif usuario_data.rol is not None:
        ids = assigned_sucursal_ids(db, usuario)
        ids = _validar_sedes_asignables(db, current_user, rol_nuevo=rol_final, sucursal_ids=ids)
        if rol_usa_lista_sedes(rol_final):
            replace_usuario_sucursales(db, usuario, ids)
        else:
            replace_usuario_sucursales(db, usuario, [])
    
    usuario.updated_at = datetime.now(timezone.utc)
    
    try:
        db.commit()
    except (IntegrityError, DataError):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo actualizar el usuario. Verifica email/rol y vuelve a intentar.",
        )
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
    
    return _usuario_dict(usuario, db)


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
    _assert_puede_gestionar_usuario(db, current_user, usuario)
    
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
    _assert_puede_gestionar_usuario(db, current_user, usuario)
    
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
    _assert_puede_gestionar_usuario(db, current_user, usuario)
    
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
