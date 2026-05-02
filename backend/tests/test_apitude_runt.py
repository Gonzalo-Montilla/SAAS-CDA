import app.integrations.apitude_runt as apitude


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

    def post(self, url: str, headers: dict | None = None, json: dict | None = None):
        self.calls.append(("POST", url, json))
        return self.responses.pop(0)

    def get(self, url: str, headers: dict | None = None):
        self.calls.append(("GET", url, None))
        return self.responses.pop(0)


def _patch_settings(monkeypatch):
    monkeypatch.setattr(apitude.settings, "APITUDE_ENABLED", True, raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_API_KEY", "test-key", raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_BASE_URL", "https://apitude.co", raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_TIMEOUT_SECONDS", 5.0, raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_SERVICE_PATH", "/api/v1.0/requests/runt-vehicle-co/", raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_DOCUMENT_TYPE", "placa", raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_DOCUMENT_NUMBER_TEMPLATE", "{placa}", raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_POLL_MAX_ATTEMPTS", 2, raising=False)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_POLL_INTERVAL_SECONDS", 0.01, raising=False)


def test_consultar_runt_mapea_respuesta_exitosa(monkeypatch):
    apitude._CACHE.clear()
    _patch_settings(monkeypatch)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_CACHE_TTL_SECONDS", 0, raising=False)

    responses = [
        _FakeResponse(200, {"request_id": "abc-123", "url": "/api/v1.0/requests/runt-vehicle-co/abc-123/"}),
        _FakeResponse(
            200,
            {
                "message": "Request completed",
                "result": {
                    "status": 200,
                    "data": {
                        "found": True,
                        "informacion_general_vehiculo": {
                            "marca": "YAMAHA",
                            "linea": "FZ25",
                            "modelo": "2022",
                            "clase_vehiculo": "MOTOCICLETA",
                            "tipo_servicio": "PARTICULAR",
                            "color": "NEGRO",
                        },
                        "datos_tecnicos": {"cilindraje": "249"},
                    },
                },
            },
        ),
    ]
    fake = _FakeClient(responses)
    monkeypatch.setattr(apitude.httpx, "Client", lambda timeout: fake)

    out = apitude.consultar_runt_vehiculo_por_placa("fzk-25a")
    assert out["placa_consultada"] == "FZK25A"
    assert out["encontrado"] is True
    assert out["marca"] == "YAMAHA"
    assert out["modelo"] == "2022"
    assert out["ano_modelo"] == 2022
    assert out["tipo_vehiculo_sugerido"] == "moto"
    assert out["confidence"] == "high"
    assert out["cached"] is False


def test_consultar_runt_no_encontrado_permite_fallback_manual(monkeypatch):
    apitude._CACHE.clear()
    _patch_settings(monkeypatch)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_CACHE_TTL_SECONDS", 0, raising=False)

    responses = [
        _FakeResponse(200, {"request_id": "no-hit", "url": "/api/v1.0/requests/runt-vehicle-co/no-hit/"}),
        _FakeResponse(
            200,
            {
                "message": "Request completed",
                "result": {"status": 404, "data": {"found": False}},
            },
        ),
    ]
    monkeypatch.setattr(apitude.httpx, "Client", lambda timeout: _FakeClient(responses))

    out = apitude.consultar_runt_vehiculo_por_placa("zzz999")
    assert out["placa_consultada"] == "ZZZ999"
    assert out["encontrado"] is False
    assert out["tipo_vehiculo_sugerido"] is None
    assert any("no encontró datos" in obs.lower() for obs in out["observaciones"])


def test_consultar_runt_usa_cache_para_controlar_costos(monkeypatch):
    apitude._CACHE.clear()
    _patch_settings(monkeypatch)
    monkeypatch.setattr(apitude.settings, "APITUDE_RUNT_CACHE_TTL_SECONDS", 600, raising=False)

    responses = [
        _FakeResponse(200, {"request_id": "cache-1", "url": "/api/v1.0/requests/runt-vehicle-co/cache-1/"}),
        _FakeResponse(
            200,
            {
                "message": "Request completed",
                "result": {
                    "status": 200,
                    "data": {
                        "found": True,
                        "informacion_general_vehiculo": {
                            "marca": "KIA",
                            "linea": "PICANTO",
                            "modelo": "2019",
                            "clase_vehiculo": "AUTOMOVIL",
                            "tipo_servicio": "PARTICULAR",
                        },
                    },
                },
            },
        ),
    ]
    fake = _FakeClient(responses)
    monkeypatch.setattr(apitude.httpx, "Client", lambda timeout: fake)

    first = apitude.consultar_runt_vehiculo_por_placa("abc123")
    second = apitude.consultar_runt_vehiculo_por_placa("abc123")

    assert first["cached"] is False
    assert second["cached"] is True
    assert len(fake.calls) == 2  # 1 POST + 1 GET en primera consulta; segunda sale de cache
