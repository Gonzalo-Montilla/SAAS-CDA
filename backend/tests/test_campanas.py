from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services.campana_audiencias import (
    TOPE_ENVIO,
    autorizo_habeas,
    categoria_meta_para,
    opt_in_formato,
    preview_excel,
    ventana_ley_2300,
)
from app.services.campana_excel import filas_desde_matriz
from app.services.whatsapp_pack import PACK, plantilla_por_evento


def test_habeas_solo_si():
    assert autorizo_habeas("si") is True
    assert autorizo_habeas("Sí") is True
    assert autorizo_habeas("no") is False
    assert autorizo_habeas("") is False


def test_audiencia_rtm_conserva_excluidos_comerciales():
    from app.services.campana_audiencias import COMMERCIAL_EXCLUIDOS, EVENTOS_MARKETING_CAMPANA

    assert COMMERCIAL_EXCLUIDOS == {"agendado", "descartado"}
    assert "campana_excel" in EVENTOS_MARKETING_CAMPANA


def test_opt_in_desde_formato_recepcion():
    extra = {"autorizaciones_datos": {"contacto_recordatorio_rtm_soat": "si", "contacto_fuerza_comercial": "no"}}
    assert opt_in_formato(extra, "contacto_recordatorio_rtm_soat") is True
    assert opt_in_formato(extra, "contacto_fuerza_comercial") is False
    assert opt_in_formato({}, "contacto_fuerza_comercial") is False


def test_por_vencer_es_utilidad_el_resto_marketing():
    assert categoria_meta_para("por_vencer") == "utility"
    assert categoria_meta_para("inactivos") == "marketing"
    assert categoria_meta_para("excel") == "marketing"
    assert categoria_meta_para("temporada") == "marketing"


def test_ventana_ley_2300_domingo_y_noche():
    bogota = ZoneInfo("America/Bogota")
    domingo = datetime(2026, 9, 27, 10, 0, tzinfo=bogota)
    ok, motivo = ventana_ley_2300(domingo)
    assert ok is False
    assert motivo and "domingo" in motivo.lower()
    noche = datetime(2026, 9, 28, 21, 0, tzinfo=bogota)
    ok2, motivo2 = ventana_ley_2300(noche)
    assert ok2 is False
    assert motivo2 and "7:00" in motivo2
    festivo = datetime(2026, 12, 25, 10, 0, tzinfo=bogota)
    ok3, _ = ventana_ley_2300(festivo)
    assert ok3 is False
    laboral = datetime(2026, 9, 28, 10, 0, tzinfo=bogota)
    ok4, motivo4 = ventana_ley_2300(laboral)
    assert ok4 is True
    assert motivo4 is None


def test_excel_exige_habeas_y_acepta_correo_sin_celular():
    filas, errores = filas_desde_matriz(
        ["nombre", "celular", "autorizo_habeas"],
        [
            ["Ana", "3001234567", "si"],
            ["Luis", "3001234568", "no"],
            ["", "3001234569", "si"],
        ],
    )
    assert len(filas) == 1
    assert filas[0]["nombre"] == "Ana"
    assert any("habeas" in e.lower() for e in errores)
    dests, omitidos = preview_excel(
        [SimpleNamespace(nombre="Ana", celular="3001234567", autorizo_habeas="si", correo="ana@correo.com")]
    )
    assert len(dests) == 1
    assert dests[0].destino_e164 == "573001234567"
    assert dests[0].cliente_email == "ana@correo.com"
    assert omitidos == 0
    dests2, omitidos2 = preview_excel(
        [SimpleNamespace(nombre="Luis", celular="3001234568", autorizo_habeas="no")]
    )
    assert dests2 == []
    assert omitidos2 == 1
    solo_mail, err_mail = filas_desde_matriz(
        ["nombre", "correo", "autorizo_habeas"],
        [["Pedro", "pedro@correo.com", "si"]],
    )
    assert solo_mail == [
        {"nombre": "Pedro", "celular": "", "correo": "pedro@correo.com", "autorizo_habeas": "si"}
    ]
    assert err_mail == []
    dests3, omitidos3 = preview_excel(
        [SimpleNamespace(nombre="Pedro", celular="", autorizo_habeas="si", correo="pedro@correo.com")]
    )
    assert omitidos3 == 0
    assert len(dests3) == 1
    assert dests3[0].cliente_email == "pedro@correo.com"
    assert dests3[0].destino_e164.startswith("m")
    assert dests3[0].destino_e164 != "573001234567"


def test_filtros_excel_acepta_filas_incompletas():
    from app.schemas.campana import CampanaFiltrosIn

    body = CampanaFiltrosIn.model_validate(
        {
            "tipo": "excel",
            "filas_excel": [
                {"nombre": "Ana", "celular": 3001234567, "autorizo_habeas": "si"},
                {"nombre": "Luis", "celular": "3001234568", "autorizo_habeas": ""},
            ],
        }
    )
    assert body.filas_excel is not None
    assert body.filas_excel[0].celular == "3001234567"
    assert body.filas_excel[1].autorizo_habeas == ""


def test_excel_body_params_son_tres():
    from types import SimpleNamespace
    from app.services.campana_envio import _body_params, resumir_error_whatsapp

    campana = SimpleNamespace(tipo="excel", etiqueta="halloween")
    dest = SimpleNamespace(cliente_nombre="GONZALO MONTILLA", placa=None, motivo="")
    params = _body_params(campana=campana, dest=dest, nombre_cda="CDA Quitamelsueño", agendar_url="https://www.cdasoft.com.co/agendar/x")
    assert len(params) == 3
    assert params[2].lower() == "halloween."
    raw = '{"error":{"message":"(#132000) Number of parameters does not match the expected number of params","code":132000,"error_data":{"details":"body: number of localizable_params (2) does not match the expected number of params (3)"}}}'
    assert "3" in resumir_error_whatsapp(raw)
    assert TOPE_ENVIO == 500


def test_preview_rtm_por_vencer_espera_renovarla():
    from types import SimpleNamespace
    from app.services.campana_envio import preview_canales_campana

    dest = SimpleNamespace(cliente_nombre="Gonzalo Montilla", placa="ABC123", motivo="RTM vence el 15 de noviembre de 2026")
    wa, _, _, _ = preview_canales_campana(
        tipo="por_vencer",
        etiqueta=None,
        dest=dest,
        nombre_cda="CDA Quitamelsueño",
        agendar_url="https://www.cdasoft.com.co/agendar/cda-quitamelsueno",
    )
    assert "Lo esperamos para renovarla" in wa
    assert "ABC123" in wa
    assert "Gonzalo" in wa
    assert "Fecha sugerida" in wa
    rtm = plantilla_por_evento("rtm")
    assert rtm is not None
    assert "Lo esperamos para renovarla" in rtm["cuerpo"]
    assert rtm["variables"] == 5


def test_preview_inactivos_le_escribe_y_encantaria():
    from types import SimpleNamespace
    from app.services.campana_envio import preview_canales_campana

    dest = SimpleNamespace(cliente_nombre="Gonzalo Montilla", placa="ABC123", motivo="")
    wa, _, _, _ = preview_canales_campana(
        tipo="inactivos",
        etiqueta=None,
        dest=dest,
        nombre_cda="CDA Quitamelsueño",
        agendar_url="https://www.cdasoft.com.co/agendar/cda-quitamelsueno",
    )
    assert "le escribe CDA Quitamelsueño" in wa
    assert "ABC123" in wa
    assert "nos encantaría atenderlo de nuevo" in wa
    assert "Pulse Agendar" in wa
    assert "en CDA Quitamelsueño hace tiempo" not in wa


def test_pack_campanas_marketing():
    inactivos = plantilla_por_evento("campana_inactivos")
    temporada = plantilla_por_evento("campana_temporada")
    jornada = plantilla_por_evento("campana_jornada")
    assert inactivos is not None and inactivos["grupo"] == "campanas"
    assert "le escribe {{2}}" in inactivos["cuerpo"]
    assert "nos encantaría atenderlo de nuevo" in inactivos["cuerpo"]
    assert temporada is not None and "{{3}}" in temporada["cuerpo"]
    assert jornada is not None and "le escribe {{2}}" in jornada["cuerpo"]
    assert "{{3}}" in jornada["cuerpo"]
    assert "técnico-mecánica:" not in jornada["cuerpo"]
    grupos = {item["grupo"] for item in PACK}
    assert "campanas" in grupos


def test_email_campana_excel_lleva_boton_agendar():
    from app.utils.email import generar_email_campana

    asunto, html_cuerpo = generar_email_campana(
        nombre_cda="CDA Quitamelsueño",
        nombre_cliente="Gonzalo Montilla",
        placa=None,
        agendamiento_url="https://www.cdasoft.com.co/agendar/quitamelsueno",
        tipo="excel",
        etiqueta="temporada de Navidad",
    )
    html_l = html_cuerpo.lower()
    assert "temporada de navidad" in asunto.lower()
    assert "temporada de navidad" in html_l
    assert "técnico-mecánica: navidad" not in html_cuerpo.lower()
    assert "tecnico-mecanica: navidad" not in html_l
    assert "técnico-mecánica:" not in html_cuerpo
    assert "con motivo de" in html_l
    assert "Agendar tu cita" in html_cuerpo
    assert "quitamelsueno" in html_l


def test_preview_canales_rellena_whatsapp_y_carta():
    from types import SimpleNamespace
    from app.services.campana_envio import preview_canales_campana

    dest = SimpleNamespace(cliente_nombre="Pedro Perez", placa=None, motivo="")
    wa, asunto, html_cuerpo, cuerpo = preview_canales_campana(
        tipo="excel",
        etiqueta="temporada de Navidad",
        dest=dest,
        nombre_cda="CDA Quitamelsueño",
        agendar_url="https://www.cdasoft.com.co/agendar/quitamelsueno",
    )
    assert "{{" not in wa
    assert "temporada de Navidad" in wa
    assert "le escribe" in wa
    assert "técnico-mecánica:" not in wa
    assert "Pulse Agendar" in wa
    assert "temporada de Navidad" in asunto
    assert "Hola {{nombre}}" in cuerpo or "{{nombre}}" in cuerpo
    assert "Agendar tu cita" in html_cuerpo
    assert "técnico-mecánica:" not in html_cuerpo


def test_correo_libre_incluye_horario_y_cta():
    from app.utils.email import generar_email_desde_cuerpo_libre

    asunto, html_cuerpo = generar_email_desde_cuerpo_libre(
        nombre_cda="CDA Quitamelsueño",
        nombre_cliente="Pedro Perez",
        placa=None,
        agendamiento_url="https://www.cdasoft.com.co/agendar/quitamelsueno",
        asunto="{{cda}} — Jornada de este fin de semana",
        cuerpo_texto=(
            "Hola {{nombre}},\n\n"
            "Este fin de semana tenemos jornada extraordinaria con horario extendido "
            "de 8:00 a.m. a 8:00 p.m.\n\n"
            "Lo esperamos en {{cda}}."
        ),
    )
    assert "8:00 a.m." in html_cuerpo
    assert "8:00 p.m." in html_cuerpo
    assert "Pedro" in html_cuerpo
    assert "Agendar tu cita" in html_cuerpo
    assert "Segoe UI" in html_cuerpo
    assert "#0f172a" in html_cuerpo
    assert "técnico-mecánica:" not in html_cuerpo
    assert "Jornada de este fin de semana" in asunto


def test_parse_json_correo_grok():
    from app.integrations.xai_client import _parse_asunto_cuerpo

    parsed = _parse_asunto_cuerpo(
        '```json\n{"asunto": "CDA — Jornada", "cuerpo": "Hola {{nombre}}, este sábado de 8 a 8."}\n```'
    )
    assert parsed is not None
    asunto, cuerpo = parsed
    assert "Jornada" in asunto
    assert "8 a 8" in cuerpo
    assert _parse_asunto_cuerpo('{"cuerpo": "Hola {{1}}"}') is None


def test_canales_persona_ok_si_correo_aunque_wa_falle():
    from app.services.campana_envio import _aplicar_canales, OMIT_WA_HOY
    from app.services.campana_audiencias import EVENTOS_MARKETING_CAMPANA

    dest = SimpleNamespace()
    assert _aplicar_canales(dest, wa="fail", correo="ok", err_wa="Meta 132001", err_correo=None) is True
    assert dest.estado == "ok"
    assert dest.estado_whatsapp == "fail"
    assert dest.estado_correo == "ok"
    dest2 = SimpleNamespace()
    assert _aplicar_canales(dest2, wa="omitido", correo="ok", err_wa=OMIT_WA_HOY, err_correo=None) is True
    dest3 = SimpleNamespace()
    assert _aplicar_canales(dest3, wa="fail", correo="fail", err_wa="x", err_correo="y") is False
    assert dest3.estado == "fail"
    assert "campana_excel" in EVENTOS_MARKETING_CAMPANA
    assert "campana_jornada" in EVENTOS_MARKETING_CAMPANA
    assert "campana_inactivos" in EVENTOS_MARKETING_CAMPANA


def test_campana_puede_enviarse_solo_correo():
    from types import SimpleNamespace

    from app.services.campana_envio import campana_puede_enviarse, destinatario_tiene_correo, destinatario_tiene_movil

    ok_wa, motivo_wa = campana_puede_enviarse(whatsapp_listo=True, con_correo=0)
    assert ok_wa is True
    assert motivo_wa is None

    ok_mail, motivo_mail = campana_puede_enviarse(whatsapp_listo=False, con_correo=2)
    assert ok_mail is True
    assert motivo_mail is None

    bloqueado, motivo = campana_puede_enviarse(whatsapp_listo=False, con_correo=0)
    assert bloqueado is False
    assert motivo and "correo" in motivo.lower()

    assert destinatario_tiene_correo(SimpleNamespace(cliente_email="ana@correo.com")) is True
    assert destinatario_tiene_correo(SimpleNamespace(cliente_email="")) is False
    assert destinatario_tiene_correo(SimpleNamespace(cliente_email=None)) is False
    assert destinatario_tiene_movil(SimpleNamespace(destino_e164="573001234567")) is True
    assert destinatario_tiene_movil(SimpleNamespace(destino_e164="mabcdef")) is False


def test_ruta_campanas_preview_y_grok():
    from app.api.v1.endpoints import campanas as camp_ep

    rutas = []
    for route in camp_ep.router.routes:
        methods = getattr(route, "methods", None) or set()
        path = getattr(route, "path", "")
        rutas.append((path, methods))
    assert any(path.endswith("/preview") and "POST" in methods for path, methods in rutas)
    assert any(path.endswith("/grok-texto") and "POST" in methods for path, methods in rutas)
    assert any(path.endswith("/grok-correo") and "POST" in methods for path, methods in rutas)
    assert any(path.endswith("/preview-correo") and "POST" in methods for path, methods in rutas)
    assert any(path.endswith("/enviar") and "POST" in methods for path, methods in rutas)
