"""Preventiva no abre reinspección RTM ni consume el año de la anual (sin BD)."""
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.endpoints.vehiculos import (
    _build_reinspeccion_context_for_origen,
    _debe_bloquear_duplicidad_en_proceso,
    _es_servicio_obligatorio,
    _es_servicio_preventiva,
    _limpiar_vinculo_reinspeccion,
)
from app.models.vehiculo import EstadoVehiculo, VehiculoProceso


def test_preventiva_no_es_servicio_obligatorio():
    assert _es_servicio_preventiva("preventiva") is True
    assert _es_servicio_obligatorio("preventiva") is False
    assert _es_servicio_obligatorio("liviano_particular") is True
    assert _es_servicio_obligatorio("pruebas_auditoria") is False


def test_pagado_preventiva_permite_nueva_anual():
    existente = SimpleNamespace(estado=EstadoVehiculo.PAGADO, tipo_vehiculo="preventiva")
    assert (
        _debe_bloquear_duplicidad_en_proceso(
            existente, tipo_vehiculo_nuevo="liviano_particular"
        )
        is False
    )


def test_pagado_anual_permite_preventiva():
    existente = SimpleNamespace(estado=EstadoVehiculo.PAGADO, tipo_vehiculo="liviano_particular")
    assert (
        _debe_bloquear_duplicidad_en_proceso(existente, tipo_vehiculo_nuevo="preventiva")
        is False
    )


def test_pagado_anual_bloquea_otra_anual():
    existente = SimpleNamespace(estado=EstadoVehiculo.PAGADO, tipo_vehiculo="liviano_particular")
    assert (
        _debe_bloquear_duplicidad_en_proceso(
            existente, tipo_vehiculo_nuevo="liviano_publico"
        )
        is True
    )


def test_registrado_siempre_bloquea_otra_placa():
    existente = SimpleNamespace(estado=EstadoVehiculo.REGISTRADO, tipo_vehiculo="preventiva")
    assert (
        _debe_bloquear_duplicidad_en_proceso(
            existente, tipo_vehiculo_nuevo="liviano_particular"
        )
        is True
    )
    existente_anual = SimpleNamespace(
        estado=EstadoVehiculo.REGISTRADO, tipo_vehiculo="liviano_particular"
    )
    assert (
        _debe_bloquear_duplicidad_en_proceso(
            existente_anual, tipo_vehiculo_nuevo="preventiva"
        )
        is True
    )


def test_origen_preventiva_no_es_elegible_reinspeccion_sin_db():
    origen = SimpleNamespace(
        tipo_vehiculo="preventiva",
        fecha_registro=datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc),
        id="origen-preventiva",
    )
    ctx = _build_reinspeccion_context_for_origen(
        None,  # type: ignore[arg-type]
        tenant_id="tenant",  # type: ignore[arg-type]
        origen=origen,  # type: ignore[arg-type]
    )
    assert ctx["elegible"] is False
    assert "preventiva" in (ctx["motivo"] or "").lower()


def test_limpiar_vinculo_reinspeccion_quita_exenta():
    vehiculo = VehiculoProceso()
    vehiculo.reinspeccion_origen_id = "adef8898-db1c-4636-bda5-5eadf529ba4a"
    vehiculo.reinspeccion_exenta = True
    vehiculo.reinspeccion_intento = 2
    vehiculo.reinspeccion_vence_at = datetime(2026, 7, 3)
    _limpiar_vinculo_reinspeccion(vehiculo)
    assert vehiculo.reinspeccion_exenta is False
    assert vehiculo.reinspeccion_origen_id is None
    assert vehiculo.reinspeccion_intento == 1
    assert vehiculo.reinspeccion_vence_at is None
