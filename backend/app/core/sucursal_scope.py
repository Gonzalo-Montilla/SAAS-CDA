"""
Resolución de sede activa (multi-sucursal por tenant).
"""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.sucursal import Sucursal
from app.models.usuario import RolEnum, Usuario


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


def roles_con_sede_elegible() -> set[RolEnum]:
    """Pueden fijar la sede activa vía JWT (selector)."""
    return {RolEnum.ADMINISTRADOR, RolEnum.CONTADOR}


def resolve_active_sucursal_id(db: Session, user: Usuario, payload: dict[str, Any]) -> UUID:
    """
    Sede efectiva para la petición.
    - Administrador y contador: toman `sucursal_id` del JWT si es válido; si no, sede del usuario o principal.
    - Resto: sede asignada al usuario (o principal si aún no tiene).
    """
    principal = get_principal_sucursal_id(db, user.tenant_id)
    assigned = user.sucursal_id or principal

    if user.rol in roles_con_sede_elegible():
        raw = payload.get("sucursal_id")
        if raw:
            try:
                sid = UUID(str(raw))
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Sede activa inválida en el token",
                )
            assert_sucursal_in_tenant(db, sid, user.tenant_id)
            return sid
        return assigned

    if user.sucursal_id and not sucursal_belongs_to_tenant(db, user.sucursal_id, user.tenant_id):
        return principal
    return assigned


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
    """Al refrescar token, conservar sede del refresh si sigue siendo válida."""
    raw = payload.get("sucursal_id")
    if raw:
        try:
            sid = UUID(str(raw))
            if sucursal_belongs_to_tenant(db, sid, user.tenant_id):
                if user.rol in roles_con_sede_elegible():
                    return sid
                assigned = user.sucursal_id or get_principal_sucursal_id(db, user.tenant_id)
                if sid == assigned:
                    return sid
        except ValueError:
            pass
    return resolve_active_sucursal_id(db, user, payload)


def default_sucursal_id_for_login(db: Session, user: Usuario) -> UUID:
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
    None = consolidar todas las sedes (solo admin/contador con consolidar_todas).
    UUID = filtrar por esa sede.
    """
    active = resolve_active_sucursal_id(db, user, payload)
    if user.rol not in (RolEnum.ADMINISTRADOR, RolEnum.CONTADOR):
        return active
    if consolidar_todas:
        return None
    if sucursal_id_param is not None:
        assert_sucursal_in_tenant(db, sucursal_id_param, user.tenant_id)
        return sucursal_id_param
    return active
