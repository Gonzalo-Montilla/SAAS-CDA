"""Reinspección exenta nunca debe exponer tarifa llena (regresión MWQ631)."""
from decimal import Decimal

from app.models.vehiculo import enforce_tramite_sin_cobro_montos, VehiculoProceso
from app.api.v1.endpoints.vehiculos import (
    _coaccionar_montos_sin_cobro,
    _es_tramite_sin_cobro,
)


def test_exenta_con_tarifa_llena_devuelve_cero():
    valor, comision, total, tiene_soat = _coaccionar_montos_sin_cobro(
        tipo_vehiculo="liviano_particular",
        reinspeccion_exenta=True,
        valor_rtm=Decimal("368758"),
        comision_soat=Decimal("0"),
        total_cobrado=Decimal("368758"),
        tiene_soat=False,
        placa="MWQ631",
    )
    assert valor == Decimal("0.00")
    assert comision == Decimal("0.00")
    assert total == Decimal("0.00")
    assert tiene_soat is False


def test_auditoria_tambien_queda_en_cero():
    _valor, _comision, total, tiene_soat = _coaccionar_montos_sin_cobro(
        tipo_vehiculo="pruebas_auditoria",
        reinspeccion_exenta=False,
        valor_rtm=Decimal("100000"),
        comision_soat=Decimal("0"),
        total_cobrado=Decimal("100000"),
        tiene_soat=True,
        placa="ABC123",
    )
    assert total == Decimal("0.00")
    assert tiene_soat is False


def test_cobro_normal_no_se_modifica():
    valor, _comision, total, tiene_soat = _coaccionar_montos_sin_cobro(
        tipo_vehiculo="liviano_particular",
        reinspeccion_exenta=False,
        valor_rtm=Decimal("368758"),
        comision_soat=Decimal("0"),
        total_cobrado=Decimal("368758"),
        tiene_soat=False,
        placa="GIR717",
    )
    assert valor == Decimal("368758")
    assert total == Decimal("368758")
    assert tiene_soat is False
    assert _es_tramite_sin_cobro("liviano_particular", False) is False
    assert _es_tramite_sin_cobro("liviano_particular", True) is True


def test_modelo_exenta_no_puede_quedar_con_tarifa():
    vehiculo = VehiculoProceso()
    vehiculo.tipo_vehiculo = "liviano_particular"
    vehiculo.reinspeccion_exenta = True
    vehiculo.valor_rtm = Decimal("368758")
    vehiculo.comision_soat = Decimal("1000")
    vehiculo.total_cobrado = Decimal("369758")
    vehiculo.tiene_soat = True
    enforce_tramite_sin_cobro_montos(vehiculo)
    assert vehiculo.valor_rtm == Decimal("0.00")
    assert vehiculo.comision_soat == Decimal("0.00")
    assert vehiculo.total_cobrado == Decimal("0.00")
    assert vehiculo.tiene_soat is False


def test_modelo_cobro_normal_no_se_toca():
    vehiculo = VehiculoProceso()
    vehiculo.tipo_vehiculo = "moto"
    vehiculo.reinspeccion_exenta = False
    vehiculo.valor_rtm = Decimal("217586")
    vehiculo.comision_soat = Decimal("0")
    vehiculo.total_cobrado = Decimal("217586")
    vehiculo.tiene_soat = False
    enforce_tramite_sin_cobro_montos(vehiculo)
    assert vehiculo.total_cobrado == Decimal("217586")
    assert vehiculo.valor_rtm == Decimal("217586")
