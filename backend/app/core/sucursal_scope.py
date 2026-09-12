"""
Resolución de sede activa (multi-sucursal por tenant).
Gerente / contador / oficial: todas las sedes activas.
Administrador, cajero, recepción, comercial: solo sedes de usuario_sucursales.
"""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.sucursal import Sucursal
from app.models.usuario import RolEnum, Usuario, UsuarioSucursal


def _rol(user: Usuario) -> RolEnum | str:
    return user.rol


def es_gerente(user: Usuario) -> bool:
    return _rol(user) == RolEnum.GERENTE


def es_gerente_o_admin(user: Usuario) -> bool:
    return _rol(user) in (RolEnum.GERENTE, RolEnum.ADMINISTRADOR)


def user_may_manage_usuario(db: Session, actor: Usuario, target: Usuario) -> bool:
    """Gerente gestiona a cualquiera del NIT. Admin de sede: solo personal de sus locales."""
    if actor.tenant_id != target.tenant_id:
        return False
    if es_gerente(actor):
        return True
    if _rol(target) in roles_ambito_marca():
        return False
    allowed = set(assigned_sucursal_ids(db, actor))
    if actor.sucursal_id:
        allowed.add(actor.sucursal_id)
    target_ids = set(assigned_sucursal_ids(db, target))
    if target.sucursal_id:
        target_ids.add(target.sucursal_id)
    return bool(allowed and (allowed & target_ids))


def roles_ambito_marca() -> set[RolEnum]:
    """Ven y pueden operar cualquier sede activa del NIT."""
    return {RolEnum.GERENTE, RolEnum.CONTADOR, RolEnum.OFICIAL_CUMPLIMIENTO}


def rol_usa_lista_sedes(rol: RolEnum | str | None) -> bool:
    return rol in (
        RolEnum.ADMINISTRADOR,
        RolEnum.CAJERO,
        RolEnum.RECEPCIONISTA,
        RolEnum.COMERCIAL,
    )


def get_principal_sucursal_id(db: Session, tenant_id: UUID) -> UUID:
    row = (
        db.query(Sucursal)
        .filter(Sucursal.tenant_id == tenant_id, Sucursal.es_principal.is_(True))
        .first()
    )
    if row is None:
        row = db.query(Sucursal).filter(Sucursal.tenant_id == tenant_id).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El tenant no tiene sedes configuradas. Contacte al administrador.",
        )
    return row.id


def sucursal_belongs_to_tenant(db: Session, sucursal_id: UUID, tenant_id: UUID) -> bool:
    return (
        db.query(Sucursal)
        .filter(Sucursal.id == sucursal_id, Sucursal.tenant_id == tenant_id, Sucursal.activa.is_(True))
        .first()
        is not None
    )


def assert_sucursal_in_tenant(db: Session, sucursal_id: UUID, tenant_id: UUID) -> None:
    if not sucursal_belongs_to_tenant(db, sucursal_id, tenant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La sede no existe, no está activa o no pertenece a su organización",
        )


def assigned_sucursal_ids(db: Session, user: Usuario) -> list[UUID]:
    rows = (
        db.query(UsuarioSucursal.sucursal_id)
        .filter(UsuarioSucursal.usuario_id == user.id)
        .all()
    )
    return [r[0] for r in rows if r[0] is not None]


def user_may_operate_sucursal(db: Session, user: Usuario, sucursal_id: UUID) -> bool:
    if not sucursal_belongs_to_tenant(db, sucursal_id, user.tenant_id):
        return False
    if _rol(user) in roles_ambito_marca():
        return True
    ids = assigned_sucursal_ids(db, user)
    if ids:
        return sucursal_id in ids
    # Legado: aún no hay filas en usuario_sucursales
    return bool(user.sucursal_id and user.sucursal_id == sucursal_id)


def assert_user_may_operate_sucursal(db: Session, user: Usuario, sucursal_id: UUID) -> None:
    if not user_may_operate_sucursal(db, user, sucursal_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para operar en esa sede.",
        )


def sucursales_visibles_query(db: Session, user: Usuario, *, solo_activas: bool = True):
    q = db.query(Sucursal).filter(Sucursal.tenant_id == user.tenant_id)
    if solo_activas:
        q = q.filter(Sucursal.activa.is_(True))
    if _rol(user) in roles_ambito_marca():
        return q
    ids = assigned_sucursal_ids(db, user)
    if ids:
        return q.filter(Sucursal.id.in_(ids))
    if user.sucursal_id:
        return q.filter(Sucursal.id == user.sucursal_id)
    from sqlalchemy import false as sql_false
    return q.filter(sql_false())


def replace_usuario_sucursales(db: Session, usuario: Usuario, sucursal_ids: list[UUID]) -> None:
    db.query(UsuarioSucursal).filter(UsuarioSucursal.usuario_id == usuario.id).delete(
        synchronize_session=False
    )
    seen: set[UUID] = set()
    ordered: list[UUID] = []
    for sid in sucursal_ids:
        if sid in seen:
            continue
        seen.add(sid)
        ordered.append(sid)
        db.add(UsuarioSucursal(usuario_id=usuario.id, sucursal_id=sid))
    if ordered:
        home = usuario.sucursal_id if usuario.sucursal_id in seen else ordered[0]
        usuario.sucursal_id = home


def roles_con_sede_elegible() -> set[RolEnum]:
    """Roles que pueden fijar la sede activa vía JWT (login, selector o refresh)."""
    return set(RolEnum)


def resolve_active_sucursal_id(db: Session, user: Usuario, payload: dict[str, Any]) -> UUID:
    """
    Sede efectiva para la petición.
    JWT sucursal_id gana solo si el usuario puede operar esa sede.
    """
    fallback = default_sucursal_id_for_login(db, user)

    if user.rol not in roles_con_sede_elegible():
        return fallback

    raw = payload.get("sucursal_id")
    if raw:
        try:
            sid = UUID(str(raw))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sede activa inválida en el token",
            )
        if user_may_operate_sucursal(db, user, sid):
            return sid
        return fallback
    return fallback


def tenant_token_claims(user: Usuario, sucursal_id: UUID) -> dict[str, Any]:
    rol_val = user.rol.value if hasattr(user.rol, "value") else str(user.rol)
    return {
        "sub": str(user.id),
        "rol": rol_val,
        "tenant_id": str(user.tenant_id),
        "sucursal_id": str(sucursal_id),
        "auth_scope": "tenant",
    }


def resolve_refresh_sucursal_id(db: Session, user: Usuario, payload: dict[str, Any]) -> UUID:
    """Al refrescar token, conservar sede del refresh si sigue siendo válida y permitida."""
    raw = payload.get("sucursal_id")
    if raw:
        try:
            sid = UUID(str(raw))
            if user_may_operate_sucursal(db, user, sid) and user.rol in roles_con_sede_elegible():
                return sid
        except ValueError:
            pass
    return resolve_active_sucursal_id(db, user, payload)


def default_sucursal_id_for_login(db: Session, user: Usuario) -> UUID:
    if _rol(user) in roles_ambito_marca():
        if user.sucursal_id and sucursal_belongs_to_tenant(db, user.sucursal_id, user.tenant_id):
            return user.sucursal_id
        return get_principal_sucursal_id(db, user.tenant_id)
    ids = assigned_sucursal_ids(db, user)
    if user.sucursal_id and user.sucursal_id in ids and sucursal_belongs_to_tenant(
        db, user.sucursal_id, user.tenant_id
    ):
        return user.sucursal_id
    for sid in ids:
        if sucursal_belongs_to_tenant(db, sid, user.tenant_id):
            return sid
    if user.sucursal_id and sucursal_belongs_to_tenant(db, user.sucursal_id, user.tenant_id):
        return user.sucursal_id
    return get_principal_sucursal_id(db, user.tenant_id)


def parse_optional_sucursal_uuid(raw: Optional[str]) -> Optional[UUID]:
    if raw is None or raw == "":
        return None
    try:
        return UUID(str(raw).strip())
    except ValueError:
        return None


def resolve_reporte_sucursal_id(
    db: Session,
    user: Usuario,
    payload: dict,
    *,
    sucursal_id_param: Optional[UUID],
    consolidar_todas: bool,
) -> Optional[UUID]:
    """
    Alcance para reportes gerenciales.
    None = consolidar todas (solo gerente/contador).
    """
    active = resolve_active_sucursal_id(db, user, payload)
    puede_consolidar = _rol(user) in (RolEnum.GERENTE, RolEnum.CONTADOR)
    if not puede_consolidar and _rol(user) != RolEnum.ADMINISTRADOR:
        return active
    if consolidar_todas:
        if not puede_consolidar:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo gerente o contador pueden consolidar todas las sedes.",
            )
        return None
    if sucursal_id_param is not None:
        assert_user_may_operate_sucursal(db, user, sucursal_id_param)
        return sucursal_id_param
    return active


def comprobante_egreso_scope_sid(
    db: Session,
    user: Usuario,
    *,
    consolidar_todas: bool,
    active_sucursal_id: UUID,
    sucursal_id_param: Optional[UUID],
) -> Optional[UUID]:
    """
    Alcance al descargar comprobante PDF (tesorería / caja).
    """
    if consolidar_todas:
        if _rol(user) not in (RolEnum.GERENTE, RolEnum.CONTADOR):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No autorizado para consolidar sedes en esta descarga.",
            )
        return None
    if sucursal_id_param is not None:
        if _rol(user) not in (RolEnum.GERENTE, RolEnum.CONTADOR, RolEnum.ADMINISTRADOR):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No autorizado para filtrar por sede en esta descarga.",
            )
        assert_user_may_operate_sucursal(db, user, sucursal_id_param)
        return sucursal_id_param
    return active_sucursal_id
