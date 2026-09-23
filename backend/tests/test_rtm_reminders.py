from datetime import datetime

from app.utils.email import (
    generar_email_recordatorio_control_preventivo,
    generar_email_recordatorio_proxima_rtm,
)
from app.utils.rtm_reminders import (
    PREVENTIVA_STEPS,
    RTM_STEPS,
    _bogota_naive_to_utc_naive,
    pick_next_step,
)


def _utc_from_bogota(year, month, day, hour=12, minute=0):
    return _bogota_naive_to_utc_naive(datetime(year, month, day, hour, minute, 0))


def test_rtm_whatsapp_solo_tres_toques_y_correo_en_quince_y_ocho():
    wa = {step.key for step in RTM_STEPS if step.whatsapp}
    mail_only = {step.key for step in RTM_STEPS if step.email and not step.whatsapp}
    assert [step.key for step in RTM_STEPS] == ["d30", "d15", "d8", "d2", "overdue"]
    assert wa == {"d30", "d2", "overdue"}
    assert mail_only == {"d15", "d8"}


def test_preventiva_no_usa_pasos_de_rtm():
    keys = [step.key for step in PREVENTIVA_STEPS]
    assert keys == ["d7", "d2", "overdue"]
    assert "d30" not in keys
    assert "d15" not in keys
    assert "d8" not in keys
    assert all(step.whatsapp and step.email for step in PREVENTIVA_STEPS)


def test_pick_rtm_empieza_en_30_y_salta_ventanas_cerradas():
    due = _utc_from_bogota(2026, 11, 15, 15, 0)

    step, _ = pick_next_step("moto", due, [], _utc_from_bogota(2026, 9, 1))
    assert step is not None and step.key == "d30"

    step, _ = pick_next_step("moto", due, [], _utc_from_bogota(2026, 11, 1, 10, 0))
    assert step is not None and step.key == "d15"
    assert step.whatsapp is False

    step, _ = pick_next_step("moto", due, ["d30", "d15"], _utc_from_bogota(2026, 11, 10, 10, 0))
    assert step is not None and step.key == "d8"
    assert step.whatsapp is False

    step, _ = pick_next_step("liviano_particular", due, ["d30", "d15", "d8"], _utc_from_bogota(2026, 11, 14, 10, 0))
    assert step is not None and step.key == "d2"
    assert step.whatsapp is True


def test_pick_overdue_dentro_de_gracia_y_fuera():
    due = _utc_from_bogota(2026, 11, 15, 15, 0)
    sent = ["d30", "d15", "d8", "d2"]
    step, _ = pick_next_step("moto", due, sent, _utc_from_bogota(2026, 11, 17, 10, 0))
    assert step is not None and step.key == "overdue" and step.vencido is True

    step, send_at = pick_next_step("moto", due, sent, _utc_from_bogota(2026, 12, 10, 10, 0))
    assert step is None and send_at is None


def test_pick_preventiva_no_elige_d30():
    due = _utc_from_bogota(2026, 11, 15, 15, 0)
    step, _ = pick_next_step("preventiva", due, [], _utc_from_bogota(2026, 9, 1))
    assert step is not None and step.key == "d7"
    step, _ = pick_next_step("preventiva", due, ["d7"], _utc_from_bogota(2026, 11, 14, 10, 0))
    assert step is not None and step.key == "d2"


def test_emails_vencido_no_mezclan_rtm_y_preventiva():
    rtm = generar_email_recordatorio_proxima_rtm(
        "CDA Quitamelsueño",
        "Ana Pérez",
        "ABC123",
        "Revisión técnico-mecánica de moto",
        "15 de noviembre de 2026",
        etapa="vencido",
    )
    assert "ya venció" in rtm.lower()
    assert "preventiva" not in rtm.lower()

    preventiva = generar_email_recordatorio_control_preventivo(
        "CDA Quitamelsueño",
        "Ana Pérez",
        "ABC123",
        "Control preventivo",
        "15 de noviembre de 2026",
        etapa="vencido",
    )
    assert "preventiva" in preventiva.lower()
    assert "técnico-mecánica" not in preventiva.lower()
    assert "tecnico-mecanica" not in preventiva.lower()
