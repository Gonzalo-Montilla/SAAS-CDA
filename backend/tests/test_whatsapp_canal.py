from types import SimpleNamespace

from app.integrations.whatsapp_client import build_template_payload
from app.services.whatsapp_pack import PACK
from app.services.whatsapp_tenant import (
    _enlace_publico_whatsapp,
    creds_listas,
    listo_para_calidad,
    listo_para_operativo,
)
from app.utils.whatsapp_phone import normalizar_celular_co


def test_normaliza_celular_diez_digitos_colombia():
    assert normalizar_celular_co("3001234567") == "573001234567"
    assert normalizar_celular_co("+57 300 123 4567") == "573001234567"
    assert normalizar_celular_co("573001234567") == "573001234567"
    assert normalizar_celular_co("") is None
    assert normalizar_celular_co("6012345678") is None


def test_payload_plantilla_tres_variables():
    payload = build_template_payload(
        "573001234567",
        "encuesta_calidad",
        "es",
        ["Ana", "CDA Putumayo", "https://cdasoft.com.co/calidad/encuesta/abc"],
    )
    assert payload["to"] == "573001234567"
    assert payload["type"] == "template"
    assert payload["template"]["name"] == "encuesta_calidad"
    params = payload["template"]["components"][0]["parameters"]
    assert params[0]["text"] == "Ana"
    assert params[2]["text"].startswith("https://")


def test_sin_credenciales_no_esta_listo():
    row = SimpleNamespace(
        habilitado=True,
        avisos_calidad=True,
        plantilla_calidad="encuesta_calidad",
        proveedor="cloud_api",
        phone_number_id="",
        access_token_encrypted=None,
        dialog360_api_key_encrypted=None,
    )
    assert creds_listas(row) is False
    assert listo_para_calidad(row) is False


def test_listo_solo_si_habilitado_plantilla_y_token():
    row = SimpleNamespace(
        habilitado=True,
        avisos_calidad=True,
        plantilla_calidad="encuesta_calidad",
        proveedor="cloud_api",
        phone_number_id="123",
        access_token_encrypted="enc",
        dialog360_api_key_encrypted=None,
    )
    assert creds_listas(row) is True
    assert listo_para_calidad(row) is True
    row.avisos_calidad = False
    assert listo_para_calidad(row) is False


def test_listo_operativo_con_canal_y_key():
    row = SimpleNamespace(
        habilitado=True,
        avisos_operativos=True,
        proveedor="dialog360",
        phone_number_id="",
        access_token_encrypted=None,
        dialog360_api_key_encrypted="enc",
    )
    assert listo_para_operativo(row) is True
    row.avisos_operativos = False
    assert listo_para_operativo(row) is False


def test_enlace_whatsapp_no_usa_localhost():
    assert _enlace_publico_whatsapp("http://localhost:5173/calidad/encuesta/abc123") == (
        "https://www.cdasoft.com.co/calidad/encuesta/abc123"
    )
    assert _enlace_publico_whatsapp("https://www.cdasoft.com.co/calidad/encuesta/xyz").endswith("/xyz")


def test_paquete_cliente_tiene_plantillas_unicas():
    nombres = [item["nombre"] for item in PACK]
    assert len(nombres) == 11
    assert len(set(nombres)) == 11
    assert "cdasoft_recibo_fe" in nombres
    assert "cdasoft_aprobado" in nombres
    visita = [item["nombre"] for item in PACK if item["grupo"] == "visita"]
    assert visita.index("cdasoft_aprobado") < visita.index("cdasoft_reinspeccion")
    assert "cdasoft_rtm" in nombres
    assert "cdasoft_preventiva" in nombres


def test_email_aprobacion_usa_plantilla_corporativa_sin_mezclar_tramites():
    from app.utils.email import generar_email_aprobacion_inspeccion_cliente

    html = generar_email_aprobacion_inspeccion_cliente(
        "CDA QUITAMELSUEÑO", "LUZ ADRIANA GUERRERO PAZ", "QQG41A"
    )
    assert "Felicitaciones" in html
    assert "QQG41A" in html
    assert "Luz Adriana Guerrero Paz" in html
    assert "CDA Quitamelsueño" in html
    assert "LUZ ADRIANA" not in html
    assert "brand-head" in html
    assert "técnico-mecánica" not in html.lower()
    assert "preventiva" not in html.lower()


def test_nombres_titulo_sin_gritar_ni_tocar_mixto():
    from app.utils.nombres import formatear_nombre_comercial, formatear_nombre_persona

    assert formatear_nombre_persona("LUZ ADRIANA GUERRERO PAZ") == "Luz Adriana Guerrero Paz"
    assert formatear_nombre_persona("MARIA DE LOS ANGELES") == "Maria de los Angeles"
    assert formatear_nombre_persona("Luz Adriana") == "Luz Adriana"
    assert formatear_nombre_persona("") == "Cliente"
    assert formatear_nombre_comercial("CDA QUITAMELSUEÑO") == "CDA Quitamelsueño"
    assert formatear_nombre_comercial("CDA Quitamelsueño") == "CDA Quitamelsueño"
    assert formatear_nombre_comercial("CDASOFT") == "CDASOFT"


def test_etiqueta_cda_con_sede_solo_si_hay_varias():
    from app.utils.nombres import etiqueta_cda_con_sede

    assert etiqueta_cda_con_sede("CDA QUITAMELSUEÑO", "Principal", sedes_activas=1) == "CDA Quitamelsueño"
    assert etiqueta_cda_con_sede("CDA PUTUMAYO", "Mocoa", sedes_activas=2) == "CDA Putumayo · Mocoa"
    assert etiqueta_cda_con_sede("CDA Putumayo", "CDA Putumayo", sedes_activas=2) == "CDA Putumayo"
    assert etiqueta_cda_con_sede("CDA Putumayo Sede Norte", "Norte", sedes_activas=2) == "CDA Putumayo Sede Norte"
    assert etiqueta_cda_con_sede("CDA Putumayo", None, sedes_activas=2) == "CDA Putumayo"


def test_email_cita_incluye_sede_cuando_hay_varias():
    from app.utils.email import generar_email_confirmacion_cita, generar_email_recordatorio_cita

    html = generar_email_confirmacion_cita(
        nombre_cda="CDA Putumayo",
        nombre_cliente="Ana",
        fecha_legible="22 de septiembre de 2026",
        hora_legible="09:00",
        placa="ABC123",
        tipo_servicio="Revisión técnico-mecánica de moto",
        sede_nombre="Mocoa (Mocoa)",
    )
    assert "Sede:" in html
    assert "Mocoa" in html
    html_una = generar_email_confirmacion_cita(
        nombre_cda="CDA Quitamelsueño",
        nombre_cliente="Ana",
        fecha_legible="22 de septiembre de 2026",
        hora_legible="09:00",
        placa="ABC123",
        tipo_servicio="Revisión técnico-mecánica de moto",
    )
    assert "Sede:" not in html_una
    rec = generar_email_recordatorio_cita(
        nombre_cda="CDA Putumayo",
        nombre_cliente="Ana",
        fecha_legible="22 de septiembre de 2026",
        hora_legible="09:00",
        placa="ABC123",
        tipo_servicio="Revisión técnico-mecánica de moto",
        sede_nombre="Mocoa (Mocoa)",
    )
    assert "Sede:" in rec
    assert "Mocoa" in rec


def test_reintenta_idioma_es_co_si_plantilla_no_esta_en_es():
    from app.services.whatsapp_tenant import _es_error_idioma_plantilla, _idiomas_alternos

    assert _idiomas_alternos("es") == ["es", "es_CO"]
    assert _idiomas_alternos("es_CO") == ["es_CO", "es"]
    assert _es_error_idioma_plantilla(
        '{"error":{"code":132001,"error_data":{"details":"template name (cdasoft_cita_ok) does not exist in es"}}}'
    )
    assert _es_error_idioma_plantilla("otra cosa") is False


class _FakeQuery:
    def __init__(self, row):
        self._row = row

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._row


class _FakeDb:
    def __init__(self, row):
        self._row = row

    def query(self, *a, **k):
        return _FakeQuery(self._row)


def test_recibo_sin_url_usa_plantilla_simple(monkeypatch):
    from app.services import whatsapp_tenant as wt

    calls = []
    monkeypatch.setattr(wt, "_enviar_operativo", lambda db, **kw: calls.append(kw) or True)
    ok = wt.enviar_aviso_recibo(
        _FakeDb(SimpleNamespace(plantilla_recibo="cdasoft_recibo")),
        tenant_id="t",
        celular="3001234567",
        nombre_cliente="Lina",
        nombre_cda="CDA Quitamelsueño",
        placa="CWE18F",
    )
    assert ok is True
    assert len(calls) == 1
    assert calls[0]["evento"] == "recibo"
    assert calls[0]["plantilla"] == "cdasoft_recibo"
    assert calls[0]["body_params"] == ["Lina", "CDA Quitamelsueño", "CWE18F"]


def test_recibo_con_factura_ok_no_cae_a_simple(monkeypatch):
    from app.services import whatsapp_tenant as wt

    calls = []
    monkeypatch.setattr(wt, "_enviar_operativo", lambda db, **kw: calls.append(kw) or True)
    url = "https://app-sandbox.factus.com.co/documents/bills/abc"
    ok = wt.enviar_aviso_recibo(
        _FakeDb(SimpleNamespace(plantilla_recibo="cdasoft_recibo")),
        tenant_id="t",
        celular="3001234567",
        nombre_cliente="Lina",
        nombre_cda="CDA Quitamelsueño",
        placa="CWE18F",
        factura_url=url,
    )
    assert ok is True
    assert len(calls) == 1
    assert calls[0]["evento"] == "recibo_fe"
    assert calls[0]["plantilla"] == "cdasoft_recibo_fe"
    assert calls[0]["body_params"][-1] == url


def test_recibo_cae_a_plantilla_sin_factura_si_fe_falla(monkeypatch):
    from app.services import whatsapp_tenant as wt

    calls = []

    def _enviar(db, **kw):
        calls.append(kw)
        return kw.get("evento") != "recibo_fe"

    monkeypatch.setattr(wt, "_enviar_operativo", _enviar)
    ok = wt.enviar_aviso_recibo(
        _FakeDb(SimpleNamespace(plantilla_recibo="cdasoft_recibo")),
        tenant_id="t",
        celular="3001234567",
        nombre_cliente="Lina",
        nombre_cda="CDA Quitamelsueño",
        placa="CWE18F",
        factura_url="https://app-sandbox.factus.com.co/documents/bills/abc",
    )
    assert ok is True
    assert [c["evento"] for c in calls] == ["recibo_fe", "recibo"]
    assert calls[1]["plantilla"] == "cdasoft_recibo"
    assert len(calls[1]["body_params"]) == 3


def test_whatsapp_recibo_formatea_nombre_en_mayusculas(monkeypatch):
    from app.services import whatsapp_tenant as wt

    calls = []
    monkeypatch.setattr(wt, "_enviar_operativo", lambda db, **kw: calls.append(kw) or True)
    wt.enviar_aviso_recibo(
        _FakeDb(SimpleNamespace(plantilla_recibo="cdasoft_recibo")),
        tenant_id="t",
        celular="3001234567",
        nombre_cliente="LUZ ADRIANA GUERRERO PAZ",
        nombre_cda="CDA QUITAMELSUEÑO",
        placa="QQG41A",
    )
    assert calls[0]["body_params"][0] == "Luz Adriana Guerrero Paz"
    assert calls[0]["body_params"][1] == "CDA Quitamelsueño"
    assert calls[0]["body_params"][2] == "QQG41A"
