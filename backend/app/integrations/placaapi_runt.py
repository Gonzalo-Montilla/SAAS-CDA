"""
Integración PlacaAPI/RegCheck para consulta por placa en Colombia.

Endpoint (GET):
  /api/reg.asmx/CheckColombia?RegistrationNumber=<placa>&username=<user>
"""
from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.config import settings


class PlacaApiRuntError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _normalize_placa(placa: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (placa or "").upper()).strip()


def _parse_year(raw: Any) -> int | None:
    s = str(raw or "").strip()
    if not s:
        return None
    digits = re.sub(r"\D", "", s)
    if len(digits) < 4:
        return None
    year = int(digits[:4])
    if 1950 <= year <= 2035:
        return year
    return None


def _suggest_tipo_vehiculo(clase: str | None) -> tuple[str | None, str | None]:
    c = (clase or "").upper()
    if "MOTO" in c:
        return "moto", "high"
    heavy_keys = ("CAMION", "TRACTO", "BUS", "BUSETA", "MICROBUS", "VOLQUETA", "REMOL", "CARGA")
    if any(k in c for k in heavy_keys):
        return "pesado_particular", "medium"
    if c:
        return "liviano_particular", "medium"
    return None, None


def _cache_get(key: str) -> dict[str, Any] | None:
    ttl = int(settings.PLACAAPI_CACHE_TTL_SECONDS or 0)
    if ttl <= 0:
        return None
    row = _CACHE.get(key)
    if not row:
        return None
    expires_at, data = row
    if time.time() > expires_at:
        _CACHE.pop(key, None)
        return None
    out = dict(data)
    out["cached"] = True
    return out


def _cache_set(key: str, data: dict[str, Any]) -> None:
    ttl = int(settings.PLACAAPI_CACHE_TTL_SECONDS or 0)
    if ttl <= 0:
        return
    _CACHE[key] = (time.time() + ttl, dict(data))


def _safe_parse_xml(xml_text: str) -> ET.Element:
    try:
        return ET.fromstring(xml_text)
    except Exception as exc:
        raise PlacaApiRuntError("Respuesta XML inválida desde PlacaAPI.") from exc


def _find_text(root: ET.Element, path: str) -> str | None:
    node = root.find(path)
    if node is None:
        return None
    txt = (node.text or "").strip()
    return txt or None


def _safe_load_vehicle_json(raw: str | None) -> dict[str, Any]:
    s = (raw or "").strip()
    if not s:
        return {}
    try:
        data = json.loads(s)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _pick(*vals: Any) -> str | None:
    for v in vals:
        s = str(v or "").strip()
        if s:
            return s
    return None


def consultar_placaapi_por_placa(placa: str) -> dict[str, Any]:
    if not settings.PLACAAPI_ENABLED:
        raise PlacaApiRuntError(
            "Consulta por placa externa deshabilitada. Configure PLACAAPI_ENABLED=True para activarla."
        )
    username = (settings.PLACAAPI_USERNAME or "").strip()
    if not username:
        raise PlacaApiRuntError("PLACAAPI_USERNAME no configurado.")

    placa_norm = _normalize_placa(placa)
    if len(placa_norm) < 5:
        raise PlacaApiRuntError("La placa debe tener al menos 5 caracteres.")

    cached = _cache_get(placa_norm)
    if cached:
        return cached

    base_url = (settings.PLACAAPI_BASE_URL or "https://www.regcheck.org.uk").rstrip("/") + "/"
    service_path = (settings.PLACAAPI_SERVICE_PATH or "/api/reg.asmx/CheckColombia").strip()
    url = service_path if service_path.startswith("http") else urljoin(base_url, service_path.lstrip("/"))
    timeout = float(settings.PLACAAPI_TIMEOUT_SECONDS or 15.0)

    params = {
        "RegistrationNumber": placa_norm,
        "username": username,
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(
                url,
                params=params,
                headers={"Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8"},
            )
    except httpx.HTTPError as exc:
        # Importante: envolver errores de red/DNS para que el endpoint pueda
        # aplicar fallback a Verifik y no responda 500 crudo.
        raise PlacaApiRuntError(
            "No fue posible conectar con PlacaAPI (error de red o DNS).",
            status_code=503,
            body=str(exc),
        ) from exc
    if resp.status_code >= 400:
        body_text = (resp.text or "").strip()
        # Este proveedor responde 500 + "Array empty" cuando no hay datos para la placa.
        # Lo tratamos como "sin resultados" en vez de error duro.
        if "array empty" in body_text.lower():
            out_empty = {
                "placa_consultada": placa_norm,
                "document_type": None,
                "document_number": None,
                "titular_nombre": None,
                "encontrado": False,
                "marca": None,
                "linea": None,
                "modelo": None,
                "ano_modelo": None,
                "color": None,
                "clase_vehiculo": None,
                "tipo_servicio": None,
                "cilindraje": None,
                "tipo_vehiculo_sugerido": None,
                "confidence": None,
                "fuente": "placaapi_colombia",
                "proveedor": "placaapi",
                "request_id": None,
                "cached": False,
                "observaciones": [
                    "No se encontró información consolidada para autocompletar.",
                    "Proveedor no retorna datos de titular; registrar cliente de forma manual.",
                ],
            }
            _cache_set(placa_norm, out_empty)
            return out_empty
        raise PlacaApiRuntError(
            "PlacaAPI rechazó la consulta por placa.",
            status_code=resp.status_code,
            body=body_text[:2000],
        )

    root = _safe_parse_xml(resp.text or "")
    vehicle_json_raw = _find_text(root, ".//{*}vehicleJson")
    vjson = _safe_load_vehicle_json(vehicle_json_raw)
    vdata = vjson.get("vehicleData") if isinstance(vjson.get("vehicleData"), dict) else {}

    marca = _pick(
        _find_text(root, ".//{*}MakeDescription"),
        _find_text(root, ".//{*}CarMake/{*}CurrentTextValue"),
        vjson.get("CarMake"),
        vdata.get("MakeDescription"),
    )
    linea = _pick(
        _find_text(root, ".//{*}ModelDescription"),
        _find_text(root, ".//{*}CarModel"),
        vjson.get("CarModel"),
        vdata.get("ModelDescription"),
        vdata.get("CarModel"),
    )
    clase = _pick(
        _find_text(root, ".//{*}BodyStyle/{*}CurrentTextValue"),
        vjson.get("VehicleType"),
        vdata.get("BodyStyle"),
    )
    cilindraje = _pick(
        _find_text(root, ".//{*}EngineSize/{*}CurrentTextValue"),
        vdata.get("EngineSize"),
    )
    ano_modelo = _parse_year(
        _pick(
            _find_text(root, ".//{*}RegistrationYear"),
            _find_text(root, ".//{*}ManufactureYearFrom"),
            vdata.get("RegistrationYear"),
            vdata.get("ManufactureYearFrom"),
        )
    )
    tipo_sugerido, confidence = _suggest_tipo_vehiculo(clase)
    found = any([marca, linea, ano_modelo, clase, cilindraje])

    observaciones: list[str] = []
    if not found:
        observaciones.append("No se encontró información consolidada para autocompletar.")
    observaciones.append("Proveedor no retorna datos de titular; registrar cliente de forma manual.")

    out = {
        "placa_consultada": placa_norm,
        "document_type": None,
        "document_number": None,
        "titular_nombre": None,
        "encontrado": bool(found),
        "marca": marca,
        "linea": linea,
        "modelo": linea,
        "ano_modelo": ano_modelo,
        "color": None,
        "clase_vehiculo": clase,
        "tipo_servicio": None,
        "cilindraje": cilindraje,
        "tipo_vehiculo_sugerido": tipo_sugerido,
        "confidence": confidence,
        "fuente": "placaapi_colombia",
        "proveedor": "placaapi",
        "request_id": None,
        "cached": False,
        "observaciones": observaciones,
    }
    _cache_set(placa_norm, out)
    return out
