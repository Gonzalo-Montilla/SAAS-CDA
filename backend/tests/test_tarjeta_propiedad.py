from app.services.tarjeta_propiedad import (
    extraer_json,
    lectura_vacia,
    normalizar_lectura,
    normalizar_placa,
    sniff_image_mime,
    sugerir_tipo_vehiculo,
)


def test_sniff_jpeg_png_webp():
    assert sniff_image_mime(b"\xff\xd8\xff\xe0XXXX") == "image/jpeg"
    assert sniff_image_mime(b"\x89PNG\r\n\x1a\nXXXX") == "image/png"
    assert sniff_image_mime(b"RIFF....WEBPXXXX") == "image/webp"
    assert sniff_image_mime(b"PDF-1.4") is None


def test_placa_y_tipo_desde_clase():
    assert normalizar_placa("vqw-06g") == "VQW06G"
    assert normalizar_placa("AB") is None
    assert sugerir_tipo_vehiculo("MOTOCICLETA", "PARTICULAR") == "moto"
    assert sugerir_tipo_vehiculo("AUTOMOVIL", "PARTICULAR") == "liviano_particular"
    assert sugerir_tipo_vehiculo("CAMIONETA", "PUBLICO") == "liviano_publico"
    assert sugerir_tipo_vehiculo("CAMION", "PARTICULAR") == "pesado_particular"
    assert sugerir_tipo_vehiculo("preventiva", "PARTICULAR") is None


def test_normalizar_lectura_yamaha_fixture():
    raw = extraer_json(
        """
        {
          "encontrado": true,
          "es_licencia_transito": true,
          "placa": "VQW06G",
          "marca": "YAMAHA",
          "linea": "FZN150D-6 (FZ-S)",
          "modelo": "2024",
          "ano_modelo": 2024,
          "color": "MULTICOLOR",
          "clase_vehiculo": "MOTOCICLETA",
          "tipo_servicio": "PARTICULAR",
          "tipo_combustible": "GASOLINA",
          "cilindraje": "149",
          "capacidad_pasajeros": "2",
          "numero_motor": "G3E9E0156615",
          "vin": "9FKRG2175R2156615",
          "titular_nombre": "MONTILLA PRIETO JUAN BENIGNO",
          "document_type": "CC",
          "document_number": "2605402",
          "confidence": "high"
        }
        """
    )
    out = normalizar_lectura(raw)
    assert out["encontrado"] is True
    assert out["fuente"] == "tarjeta_propiedad"
    assert out["placa_consultada"] == "VQW06G"
    assert out["marca"] == "YAMAHA"
    assert out["linea"] == "FZN150D-6 (FZ-S)"
    assert out["ano_modelo"] == 2024
    assert out["tipo_vehiculo_sugerido"] == "moto"
    assert out["tipo_combustible"] == "GASOLINA"
    assert out["document_number"] == "2605402"
    assert out["tipo_vehiculo_sugerido"] != "preventiva"
    assert "preventiva" not in (out["clase_vehiculo"] or "").lower()


def test_sin_licencia_no_inventa_placa():
    out = normalizar_lectura({"encontrado": False, "placa": "ABC123"})
    assert out["encontrado"] is False
    assert out["placa_consultada"] == ""
    vacia = lectura_vacia(motivo="foto ilegible")
    assert vacia["encontrado"] is False
    assert vacia["fuente"] == "tarjeta_propiedad"


def test_json_en_bloque_markdown():
    parsed = extraer_json("```json\n{\"encontrado\": true, \"placa\": \"ABC12D\"}\n```")
    assert parsed is not None
    assert parsed["placa"] == "ABC12D"


def test_whatsapp_prompt_no_esta_en_lector_tarjeta():
    from app.integrations import xai_client

    assert "WhatsApp" in xai_client._SYSTEM
    assert "licencia de tránsito" in xai_client._SYSTEM_TARJETA.lower()
    assert "tarifas" not in xai_client._SYSTEM_TARJETA.lower()
    assert xai_client._SYSTEM != xai_client._SYSTEM_TARJETA


def test_no_inventa_vin_ni_preventiva():
    out = normalizar_lectura(
        {
            "encontrado": True,
            "es_licencia_transito": True,
            "placa": "ABC12D",
            "clase_vehiculo": "AUTOMOVIL",
            "tipo_servicio": "PARTICULAR",
            "vin": None,
            "numero_motor": "",
        }
    )
    assert out["encontrado"] is True
    assert out["vin"] is None
    assert out["numero_motor"] is None
    assert out["tipo_vehiculo_sugerido"] == "liviano_particular"


def test_rutas_leer_tarjeta_y_consulta_runt():
    import inspect

    from app.api.v1.endpoints import vehiculos as vehiculos_ep

    rutas = []
    for route in vehiculos_ep.router.routes:
        methods = getattr(route, "methods", None) or set()
        path = getattr(route, "path", "")
        rutas.append((path, methods))
    assert any(path.endswith("/leer-tarjeta") and "POST" in methods for path, methods in rutas)
    assert any("/consulta-runt/" in path and "GET" in methods for path, methods in rutas)
    src = inspect.getsource(vehiculos_ep.leer_tarjeta_propiedad)
    assert "leer_licencia_transito" in src
    assert "consultar_runt_por_placa" not in src
    assert "placaapi" not in src.lower()
    assert "coresoft" not in src.lower()
    assert "from app.integrations.verifik" not in src
