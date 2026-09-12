"""ACL Fase 1: gerente vs admin de sede, lista de sucursales (sin BD)."""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.sucursal_scope import (
    es_gerente,
    es_gerente_o_admin,
    resolve_reporte_sucursal_id,
    rol_usa_lista_sedes,
    roles_ambito_marca,
    user_may_manage_usuario,
    user_may_operate_sucursal,
)
from app.models.usuario import RolEnum


TENANT = uuid4()
SEDE_N = uuid4()
SEDE_S = uuid4()
OTHER_TENANT_SEDE = uuid4()


def _user(*, rol, sucursal_id=None, uid=None, tenant_id=TENANT):
    return SimpleNamespace(
        id=uid or uuid4(),
        tenant_id=tenant_id,
        sucursal_id=sucursal_id,
        rol=rol,
    )


def test_roles_ambito_y_lista_sedes():
    assert RolEnum.GERENTE in roles_ambito_marca()
    assert RolEnum.CONTADOR in roles_ambito_marca()
    assert RolEnum.ADMINISTRADOR not in roles_ambito_marca()
    assert rol_usa_lista_sedes(RolEnum.ADMINISTRADOR) is True
    assert rol_usa_lista_sedes(RolEnum.CAJERO) is True
    assert rol_usa_lista_sedes(RolEnum.GERENTE) is False
    assert es_gerente(_user(rol=RolEnum.GERENTE)) is True
    assert es_gerente_o_admin(_user(rol=RolEnum.ADMINISTRADOR)) is True
    assert es_gerente_o_admin(_user(rol=RolEnum.CAJERO)) is False


def test_gerente_opera_cualquier_sede_del_nit(monkeypatch):
    monkeypatch.setattr(
        "app.core.sucursal_scope.sucursal_belongs_to_tenant",
        lambda db, sid, tid: sid in (SEDE_N, SEDE_S) and tid == TENANT,
    )
    gerente = _user(rol=RolEnum.GERENTE, sucursal_id=SEDE_N)
    assert user_may_operate_sucursal(None, gerente, SEDE_N) is True
    assert user_may_operate_sucursal(None, gerente, SEDE_S) is True
    assert user_may_operate_sucursal(None, gerente, OTHER_TENANT_SEDE) is False


def test_cajero_solo_sedes_asignadas(monkeypatch):
    monkeypatch.setattr(
        "app.core.sucursal_scope.sucursal_belongs_to_tenant",
        lambda db, sid, tid: sid in (SEDE_N, SEDE_S) and tid == TENANT,
    )
    monkeypatch.setattr(
        "app.core.sucursal_scope.assigned_sucursal_ids",
        lambda db, user: [SEDE_N],
    )
    cajero = _user(rol=RolEnum.CAJERO, sucursal_id=SEDE_N)
    assert user_may_operate_sucursal(None, cajero, SEDE_N) is True
    assert user_may_operate_sucursal(None, cajero, SEDE_S) is False


def test_admin_sede_no_consolida_reportes(monkeypatch):
    monkeypatch.setattr(
        "app.core.sucursal_scope.resolve_active_sucursal_id",
        lambda db, user, payload: SEDE_N,
    )
    admin = _user(rol=RolEnum.ADMINISTRADOR, sucursal_id=SEDE_N)
    with pytest.raises(HTTPException) as exc:
        resolve_reporte_sucursal_id(
            None, admin, {}, sucursal_id_param=None, consolidar_todas=True
        )
    assert exc.value.status_code == 403

    gerente = _user(rol=RolEnum.GERENTE, sucursal_id=SEDE_N)
    assert (
        resolve_reporte_sucursal_id(
            None, gerente, {}, sucursal_id_param=None, consolidar_todas=True
        )
        is None
    )


def test_admin_no_gestiona_gerente_ni_otra_sede(monkeypatch):
    monkeypatch.setattr(
        "app.core.sucursal_scope.assigned_sucursal_ids",
        lambda db, user: [user.sucursal_id] if user.sucursal_id else [],
    )
    admin_n = _user(rol=RolEnum.ADMINISTRADOR, sucursal_id=SEDE_N)
    cajero_n = _user(rol=RolEnum.CAJERO, sucursal_id=SEDE_N)
    cajero_s = _user(rol=RolEnum.CAJERO, sucursal_id=SEDE_S)
    gerente = _user(rol=RolEnum.GERENTE, sucursal_id=SEDE_N)

    assert user_may_manage_usuario(None, admin_n, cajero_n) is True
    assert user_may_manage_usuario(None, admin_n, cajero_s) is False
    assert user_may_manage_usuario(None, admin_n, gerente) is False
    assert user_may_manage_usuario(None, gerente, admin_n) is True
    assert user_may_manage_usuario(None, gerente, cajero_s) is True
