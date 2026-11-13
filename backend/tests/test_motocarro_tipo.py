from app.api.v1.endpoints.vehiculos import mapear_tipo_vehiculo_a_comision
from app.integrations.coresoft_runt import _suggest_tipo_vehiculo as coresoft_suggest
from app.integrations.placaapi_runt import _suggest_tipo_vehiculo as placaapi_suggest
from app.integrations.verifik_runt import _suggest_tipo_vehiculo as verifik_suggest
from app.services.tarjeta_propiedad import normalizar_placa, sugerir_tipo_vehiculo
from app.utils.recepcion_formato_extra_pdf import (
    _diagram_points_for_tipo,
    _resolve_vehicle_diagram_path,
    _resolve_visual_vehicle_type,
    _texto_condicion_alcance_rtm,
)
from fastapi import HTTPException

from app.services.motocarro_alcance import (
    es_tipo_motocarro,
    exigir_motocarro_habilitado,
    tenant_inspecciona_motocarro,
)


def test_motocarro_no_cae_en_moto():
    assert sugerir_tipo_vehiculo("MOTOCARRO", "PARTICULAR") == "motocarro_particular"
    assert sugerir_tipo_vehiculo("MOTOCARRO", "PUBLICO") == "motocarro_publico"
    assert sugerir_tipo_vehiculo("MOTOCICLETA", "PARTICULAR") == "moto"
    assert verifik_suggest("MOTOCARRO", "Particular") == ("motocarro_particular", "high")
    assert verifik_suggest("MOTOCARRO", "Público") == ("motocarro_publico", "high")
    assert verifik_suggest("MOTOCICLETA", "Particular") == ("moto", "high")
    assert placaapi_suggest("MOTOCARRO") == ("motocarro_particular", "high")
    assert placaapi_suggest("MOTOCICLETA") == ("moto", "high")
    assert coresoft_suggest("MOTOCARRO DE CARGA") == ("motocarro_particular", "high")
    assert coresoft_suggest("MOTOCICLETA") == ("moto", "high")


def test_placa_motocarro_tres_numeros_tres_letras():
    assert normalizar_placa("106AIQ") == "106AIQ"
    assert normalizar_placa("106-AIQ") == "106AIQ"


def test_soat_motocarro_usa_comision_moto():
    assert mapear_tipo_vehiculo_a_comision("motocarro_particular") == "moto"
    assert mapear_tipo_vehiculo_a_comision("motocarro_publico") == "moto"
    assert mapear_tipo_vehiculo_a_comision("moto") == "moto"
    assert mapear_tipo_vehiculo_a_comision("liviano_particular") == "carro"


def test_diagrama_motocarro_no_usa_plantilla_moto():
    assert _resolve_visual_vehicle_type("motocarro_particular") == "motocarro"
    assert _resolve_visual_vehicle_type("moto") == "moto"
    assert _resolve_visual_vehicle_type("preventiva", clase_vehiculo="MOTOCARRO") == "motocarro"
    assert _resolve_visual_vehicle_type("", clase_vehiculo="MOTOCICLETA") == "moto"
    path = _resolve_vehicle_diagram_path("motocarro")
    assert path and path.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    points = _diagram_points_for_tipo("motocarro")
    assert set(points) == {"mc_delantera", "mc_tra_izq", "mc_tra_der", "mc_rep_1"}


def test_pdf_alcance_no_cambia_si_el_cda_no_inspecciona_motocarro():
    texto = _texto_condicion_alcance_rtm("CDA QUITAMELSUEÑO", False)
    assert "motocarros" in texto
    assert "motocicletas 4T y motocarros" not in texto
    texto_on = _texto_condicion_alcance_rtm("CDA QUITAMELSUEÑO", True)
    assert "motocicletas 4T y motocarros" in texto_on
    assert "cuatrimotos, motocarros, cuadriciclos" not in texto_on
    assert es_tipo_motocarro("motocarro_particular")
    assert tenant_inspecciona_motocarro(None) is False


class _TenantFlag:
    def __init__(self, enabled: bool):
        self.motocarro_enabled = enabled


def test_exigir_motocarro_respeta_el_switch():
    exigir_motocarro_habilitado(_TenantFlag(True), "motocarro_particular")
    exigir_motocarro_habilitado(_TenantFlag(False), "moto")
    try:
        exigir_motocarro_habilitado(_TenantFlag(False), "motocarro_publico")
        raise AssertionError("debía bloquear motocarro con switch apagado")
    except HTTPException as exc:
        assert exc.status_code == 400
