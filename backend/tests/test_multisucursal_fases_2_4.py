"""Fases 2–4: cola por sede, tarifas override, agenda y calidad JWT."""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.appointments import _resolve_public_sucursal_id
from app.api.v1.endpoints.quality import (
    _calidad_invite_visible_for_user,
    _calidad_puede_elegir_sede,
)
from app.models.usuario import RolEnum
from app.services.tarifas_resolver import resolver_tarifa_vigente


SEDE_N = uuid4()
SEDE_S = uuid4()


class _QuerySedes:
    def __init__(self, sedes):
        self._sedes = sedes

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self._sedes


class _DbSedes:
    def __init__(self, sedes):
        self._sedes = sedes

    def query(self, *_args, **_kwargs):
        return _QuerySedes(self._sedes)


def test_calidad_solo_gerente_contador_elige_sede():
    assert _calidad_puede_elegir_sede(SimpleNamespace(rol=RolEnum.GERENTE)) is True
    assert _calidad_puede_elegir_sede(SimpleNamespace(rol=RolEnum.CONTADOR)) is True
    assert _calidad_puede_elegir_sede(SimpleNamespace(rol=RolEnum.ADMINISTRADOR)) is False
    assert _calidad_puede_elegir_sede(SimpleNamespace(rol=RolEnum.CAJERO)) is False


def test_calidad_operador_filtra_por_jwt_no_casa():
    invite = SimpleNamespace(sucursal_id=SEDE_N)
    cajero = SimpleNamespace(rol=RolEnum.CAJERO, sucursal_id=SEDE_S)
    assert _calidad_invite_visible_for_user(invite, cajero, SEDE_N) is True
    assert _calidad_invite_visible_for_user(invite, cajero, SEDE_S) is False


def test_agenda_publica_una_sede_no_pide_selector():
    sede = SimpleNamespace(id=SEDE_N, nombre="Única")
    resolved = _resolve_public_sucursal_id(_DbSedes([sede]), uuid4(), None)
    assert resolved == SEDE_N


def test_agenda_publica_multi_exige_sede():
    sedes = [
        SimpleNamespace(id=SEDE_N, nombre="Norte"),
        SimpleNamespace(id=SEDE_S, nombre="Sur"),
    ]
    db = _DbSedes(sedes)
    tenant = uuid4()
    with pytest.raises(HTTPException) as exc:
        _resolve_public_sucursal_id(db, tenant, None)
    assert exc.value.status_code == 400
    assert _resolve_public_sucursal_id(db, tenant, SEDE_S) == SEDE_S


def test_resolver_override_gana_al_catalogo(monkeypatch):
    catalogo = SimpleNamespace(id="cat")
    override = SimpleNamespace(id="ov")

    def fake_buscar(_db, **kwargs):
        if kwargs.get("sucursal_id") is not None:
            return override
        return catalogo

    monkeypatch.setattr("app.services.tarifas_resolver._buscar_tarifa", fake_buscar)
    encontrada = resolver_tarifa_vigente(
        None,
        tenant_id=uuid4(),
        tipo_vehiculo="moto",
        ano_modelo=2020,
        sucursal_id=SEDE_N,
    )
    assert encontrada is override


def test_resolver_sin_override_usa_catalogo(monkeypatch):
    catalogo = SimpleNamespace(id="cat")

    def fake_buscar(_db, **kwargs):
        if kwargs.get("sucursal_id") is not None:
            return None
        return catalogo

    monkeypatch.setattr("app.services.tarifas_resolver._buscar_tarifa", fake_buscar)
    encontrada = resolver_tarifa_vigente(
        None,
        tenant_id=uuid4(),
        tipo_vehiculo="moto",
        ano_modelo=2020,
        sucursal_id=SEDE_N,
    )
    assert encontrada is catalogo
