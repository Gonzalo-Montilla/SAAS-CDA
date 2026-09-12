"""Ventanas de reportes en America/Bogota, no en el calendario UTC del servidor."""
from datetime import date, datetime, timezone

from app.api.v1.endpoints.reportes import resolve_report_date_window
from app.core.timezone_utils import get_app_timezone


def test_dia_colombia_no_cruza_medianoche_utc():
    """12 sep 2026 Colombia = 05:00 UTC ese día hasta 04:59:59 UTC del 13."""
    inicio, fin, label = resolve_report_date_window(
        fecha=date(2026, 9, 12),
        fecha_inicio=None,
        fecha_fin=None,
    )
    tz = get_app_timezone()
    assert label == "2026-09-12"
    inicio_local = inicio.replace(tzinfo=timezone.utc).astimezone(tz)
    fin_local = fin.replace(tzinfo=timezone.utc).astimezone(tz)
    assert inicio_local.date() == date(2026, 9, 12)
    assert inicio_local.hour == 0
    assert inicio_local.minute == 0
    assert fin_local.date() == date(2026, 9, 12)
    assert fin_local.hour == 23
    # Un movimiento a las 23:30 Colombia del 12 entra; uno a las 00:10 UTC del 13 (19:10 Colombia 12) también.
    las_2330_co = datetime(2026, 9, 13, 4, 30, tzinfo=timezone.utc).replace(tzinfo=None)
    assert inicio <= las_2330_co <= fin
    # 00:30 UTC del 12 es 19:30 del 11 en Colombia: queda fuera.
    las_0030_utc = datetime(2026, 9, 12, 0, 30, tzinfo=timezone.utc).replace(tzinfo=None)
    assert las_0030_utc < inicio


def test_rango_inclusive_extremos_colombia():
    inicio, fin, label = resolve_report_date_window(
        fecha=None,
        fecha_inicio=date(2026, 9, 1),
        fecha_fin=date(2026, 9, 7),
    )
    assert label == "2026-09-01 a 2026-09-07"
    tz = get_app_timezone()
    assert inicio.replace(tzinfo=timezone.utc).astimezone(tz).date() == date(2026, 9, 1)
    assert fin.replace(tzinfo=timezone.utc).astimezone(tz).date() == date(2026, 9, 7)
    # El 7 a las 23:45 Colombia sigue dentro (04:45 UTC del 8).
    tarde_del_7 = datetime(2026, 9, 8, 4, 45, tzinfo=timezone.utc).replace(tzinfo=None)
    assert tarde_del_7 <= fin
