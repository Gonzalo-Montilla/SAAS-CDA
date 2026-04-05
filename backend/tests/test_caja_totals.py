"""
Regresión de totales de caja (modelo ORM, sin BD).

La API `/cajas/activa/resumen` expone `saldo_esperado` desde `Caja.saldo_esperado`:
  monto_inicial + total_ingresos_efectivo - total_egresos

Donde `total_ingresos_efectivo` solo suma movimientos con monto > 0 e ingresa_efectivo=True.
"""
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models.caja import Caja, MovimientoCaja, TipoMovimiento


def _ingreso(
    monto: str | float | Decimal,
    *,
    ingresa_efectivo: bool = True,
    tipo: TipoMovimiento = TipoMovimiento.RTM,
    metodo: str = "efectivo",
) -> MovimientoCaja:
    return MovimientoCaja(
        tenant_id=uuid4(),
        caja_id=uuid4(),
        monto=Decimal(str(monto)),
        tipo=tipo,
        metodo_pago=metodo,
        concepto="test",
        ingresa_efectivo=ingresa_efectivo,
    )


def test_saldo_esperado_solo_monto_inicial():
    caja = Caja(monto_inicial=Decimal("250000"))
    caja.movimientos = []
    assert caja.total_egresos == Decimal("0")
    assert caja.total_ingresos_efectivo == Decimal("0")
    assert caja.saldo_esperado == Decimal("250000")


def test_saldo_esperado_ingresos_efectivo_y_egreso():
    caja = Caja(monto_inicial=Decimal("100000"))
    caja.movimientos = [
        _ingreso("80000"),
        _ingreso("-20000", tipo=TipoMovimiento.GASTO),
    ]
    assert caja.total_ingresos_efectivo == Decimal("80000")
    assert caja.total_egresos == Decimal("20000")
    assert caja.saldo_esperado == Decimal("160000")


def test_credismart_no_cuenta_para_efectivo_en_caja():
    """Ventas que no ingresan efectivo físico no aumentan el saldo esperado."""
    caja = Caja(monto_inicial=Decimal("50000"))
    caja.movimientos = [
        _ingreso("120000", ingresa_efectivo=False, metodo="credismart"),
    ]
    assert caja.total_ingresos_efectivo == Decimal("0")
    assert caja.saldo_esperado == Decimal("50000")


def test_desglose_efectivo_cierre_total():
    from app.models.caja import DesgloseEfectivoCierre

    d = DesgloseEfectivoCierre(
        tenant_id=uuid4(),
        caja_id=uuid4(),
        billetes_100000=1,
        billetes_50000=1,
        monedas_50=4,
    )
    assert d.calcular_total() == 100000 + 50000 + 200


@pytest.mark.parametrize(
    "monto,esperado_egreso",
    [
        ("-1", Decimal("1")),
        ("-15000.50", Decimal("15000.50")),
    ],
)
def test_total_egresos_valor_absoluto(monto, esperado_egreso):
    caja = Caja(monto_inicial=Decimal("100000"))
    caja.movimientos = [_ingreso(monto, tipo=TipoMovimiento.GASTO)]
    assert caja.total_egresos == esperado_egreso
