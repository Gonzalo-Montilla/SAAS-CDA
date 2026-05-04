import app.integrations.verifik_runt as verifik


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, responses: list[_FakeResponse]):
        self.responses = responses
        self.calls: list[tuple[str, str, dict | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, url: str, headers: dict | None = None, params: dict | None = None):
        self.calls.append(("GET", url, params))
        return self.responses.pop(0)


def _patch_settings(monkeypatch):
    monkeypatch.setattr(verifik.settings, "VERIFIK_ENABLED", True, raising=False)
    monkeypatch.setattr(verifik.settings, "VERIFIK_TOKEN", "test-token", raising=False)
    monkeypatch.setattr(verifik.settings, "VERIFIK_BASE_URL", "https://api.verifik.co", raising=False)
    monkeypatch.setattr(verifik.settings, "VERIFIK_TIMEOUT_SECONDS", 5.0, raising=False)
    monkeypatch.setattr(
        verifik.settings,
        "VERIFIK_RUNT_SERVICE_PATH",
        "/v2/co/runt/vehicle-by-plate-simplified",
        raising=False,
    )
    monkeypatch.setattr(verifik.settings, "VERIFIK_RUNT_DEFAULT_DOCUMENT_TYPE", "CC", raising=False)


def test_consultar_runt_mapea_respuesta_exitosa(monkeypatch):
    verifik._CACHE.clear()
    _patch_settings(monkeypatch)
    monkeypatch.setattr(verifik.settings, "VERIFIK_RUNT_CACHE_TTL_SECONDS", 0, raising=False)

    responses = [
        _FakeResponse(
            200,
            {
                "data": {
                    "documentType": "CC",
                    "documentNumber": "123456789",
                    "plate": "ABC123",
                    "vehicle": {
                        "marca": "MAZDA",
                        "linea": "T 45",
                        "modelo": "1999",
                        "clasificacion": "AUTOMOVIL",
                        "tipoServicio": "Público",
                        "color": "BLANCO VERDE",
                        "cilindraje": "4500",
                    },
                },
                "id": "GVMFW",
            },
        ),
    ]
    fake = _FakeClient(responses)
    monkeypatch.setattr(verifik.httpx, "Client", lambda timeout: fake)

    out = verifik.consultar_runt_vehiculo_por_placa(
        "abc-123",
        document_type="CC",
        document_number="123.456.789",
    )
    assert out["placa_consultada"] == "ABC123"
    assert out["encontrado"] is True
    assert out["marca"] == "MAZDA"
    assert out["modelo"] == "1999"
    assert out["ano_modelo"] == 1999
    assert out["tipo_vehiculo_sugerido"] == "liviano_publico"
    assert out["fuente"] == "verifik_runt"
    assert out["proveedor"] == "verifik"


def test_consultar_runt_valida_documento_obligatorio(monkeypatch):
    verifik._CACHE.clear()
    _patch_settings(monkeypatch)
    try:
        verifik.consultar_runt_vehiculo_por_placa("zzz999", document_type="CC", document_number="")
        assert False, "Debió fallar por documento faltante"
    except verifik.VerifikRuntError as exc:
        assert "documentNumber es obligatorio" in str(exc)


def test_consultar_runt_usa_cache(monkeypatch):
    verifik._CACHE.clear()
    _patch_settings(monkeypatch)
    monkeypatch.setattr(verifik.settings, "VERIFIK_RUNT_CACHE_TTL_SECONDS", 600, raising=False)

    responses = [
        _FakeResponse(
            200,
            {
                "data": {
                    "documentType": "CC",
                    "documentNumber": "123456789",
                    "plate": "KLM890",
                    "vehicle": {
                        "marca": "KIA",
                        "linea": "PICANTO",
                        "modelo": "2019",
                        "clasificacion": "AUTOMOVIL",
                        "tipoServicio": "Particular",
                    },
                },
                "id": "CACHED1",
            },
        ),
    ]
    fake = _FakeClient(responses)
    monkeypatch.setattr(verifik.httpx, "Client", lambda timeout: fake)

    first = verifik.consultar_runt_vehiculo_por_placa("KLM890", document_type="CC", document_number="123456789")
    second = verifik.consultar_runt_vehiculo_por_placa("KLM890", document_type="CC", document_number="123456789")

    assert first["cached"] is False
    assert second["cached"] is True
    assert len(fake.calls) == 1
