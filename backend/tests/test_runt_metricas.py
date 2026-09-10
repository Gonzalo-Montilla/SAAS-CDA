from datetime import datetime, timedelta, timezone

from app.api.v1.endpoints.runt_metricas import _window
from app.core.timezone_utils import get_app_timezone


def test_window_today_starts_at_bogota_midnight():
    start, end = _window(0)
    tz = get_app_timezone()
    start_local = start.replace(tzinfo=timezone.utc).astimezone(tz)
    now_local = datetime.now(timezone.utc).astimezone(tz)
    assert start_local.hour == 0
    assert start_local.minute == 0
    assert start_local.second == 0
    assert start_local.date() == now_local.date()
    assert end <= datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=2)


def test_window_30_days_is_calendar_not_rolling_hours():
    start, _end = _window(30)
    tz = get_app_timezone()
    start_local = start.replace(tzinfo=timezone.utc).astimezone(tz)
    now_local = datetime.now(timezone.utc).astimezone(tz)
    expected = (now_local - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
    assert start_local.replace(tzinfo=None) == expected.replace(tzinfo=None)
