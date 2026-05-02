"""
Integración Apitude para consulta RUNT por placa.

Flujo Apitude (asíncrono):
1) POST crea request y devuelve request_id/url
2) GET de polling hasta completar resultado
"""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.config import settings


class ApitudeRuntError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def apitude_runt_enabled() -> bool:
    return bool(settings.APITUDE_ENABLED and (settings.APITUDE_API_KEY or "").strip())


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return (resp.text or "")[:2000]


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
    if 1950 <= year <= 2030:
        return year
    return None


def _suggest_tipo_vehiculo(clase_vehiculo: str | None, tipo_servicio: str | None) -> tuple[str | None, str | None]:
    clase = (clase_vehiculo or "").upper()
    servicio = (tipo_servicio or "").upper()

    if "MOTO" in clase:
        return "moto", "high"

    heavy_keys = (
        "CAMION",
        "TRACTO",
        "BUS",
        "BUSETA",
        "MICROBUS",
        "VOLQUETA",
        "REMOL",
    )
    is_heavy = any(k in clase for k in heavy_keys)
    is_public = "PUBLIC" in servicio

    if is_heavy and is_public:
        return "pesado_publico", "medium"
    if is_heavy and not is_public:
        return "pesado_particular", "medium"
    if is_public:
        return "liviano_publico", "medium"
    if clase:
        return "liviano_particular", "medium"
    return None, None


def _cache_get(key: str) -> dict[str, Any] | None:
    ttl = int(settings.APITUDE_RUNT_CACHE_TTL_SECONDS or 0)
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
    ttl = int(settings.APITUDE_RUNT_CACHE_TTL_SECONDS or 0)
    if ttl <= 0:
        return
    _CACHE[key] = (time.time() + ttl, dict(data))


def consultar_runt_vehiculo_por_placa(placa: str) -> dict[str, Any]:
    if not settings.APITUDE_ENABLED:
        raise ApitudeRuntError(
            "Consulta RUNT externa deshabilitada. Configure APITUDE_ENABLED=True para activarla."
        )
    api_key = (settings.APITUDE_API_KEY or "").strip()
    if not api_key:
        raise ApitudeRuntError("APITUDE_API_KEY no configurada.")

    placa_norm = _normalize_placa(placa)
    if len(placa_norm) < 5:
        raise ApitudeRuntError("La placa debe tener al menos 5 caracteres.")

    cached = _cache_get(placa_norm)
    if cached:
        return cached

    base_url = (settings.APITUDE_BASE_URL or "https://apitude.co").rstrip("/") + "/"
    service_path = (settings.APITUDE_RUNT_SERVICE_PATH or "/api/v1.0/requests/runt-vehicle-co/").strip()
    post_url = service_path if service_path.startswith("http") else urljoin(base_url, service_path.lstrip("/"))

    doc_type = (settings.APITUDE_RUNT_DOCUMENT_TYPE or "placa").strip()
    doc_number_tpl = (settings.APITUDE_RUNT_DOCUMENT_NUMBER_TEMPLATE or "{placa}").strip()
    doc_number = doc_number_tpl.replace("{placa}", placa_norm)
    timeout = float(settings.APITUDE_TIMEOUT_SECONDS or 15.0)

    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    with httpx.Client(timeout=timeout) as client:
        post_resp = client.post(
            post_url,
            headers=headers,
            json={"document_type": doc_type, "document_number": doc_number},
        )
        post_data = _safe_json(post_resp)
        if post_resp.status_code >= 400:
            raise ApitudeRuntError(
                "Apitude rechazó la consulta inicial.",
                status_code=post_resp.status_code,
                body=post_data,
            )

        if not isinstance(post_data, dict):
            raise ApitudeRuntError("Respuesta inicial inválida de Apitude.", body=post_data)

        request_id = str(post_data.get("request_id") or "").strip() or None
        poll_url_raw = str(post_data.get("url") or "").strip()
        if not poll_url_raw and request_id:
            poll_url_raw = f"{service_path.rstrip('/')}/{request_id}/"
        if not poll_url_raw:
            raise ApitudeRuntError("Apitude no devolvió URL ni request_id para polling.", body=post_data)

        poll_url = poll_url_raw if poll_url_raw.startswith("http") else urljoin(base_url, poll_url_raw.lstrip("/"))
        max_attempts = int(settings.APITUDE_RUNT_POLL_MAX_ATTEMPTS or 6)
        interval = float(settings.APITUDE_RUNT_POLL_INTERVAL_SECONDS or 1.2)
        poll_data: dict[str, Any] | None = None

        for idx in range(max_attempts):
            poll_resp = client.get(poll_url, headers=headers)
            poll_raw = _safe_json(poll_resp)
            if poll_resp.status_code >= 400:
                raise ApitudeRuntError(
                    "Apitude devolvió error al consultar el estado de la solicitud.",
                    status_code=poll_resp.status_code,
                    body=poll_raw,
                )
            if isinstance(poll_raw, dict):
                poll_data = poll_raw
                msg = str(poll_raw.get("message") or "").lower()
                if msg == "request completed":
                    break
                result = poll_raw.get("result")
                if isinstance(result, dict) and result.get("end_at"):
                    break
            if idx < max_attempts - 1:
                time.sleep(interval)

        if not poll_data:
            raise ApitudeRuntError("No se obtuvo respuesta válida de Apitude durante el polling.")

    result = poll_data.get("result") if isinstance(poll_data, dict) else None
    result = result if isinstance(result, dict) else {}
    result_status = int(result.get("status")) if str(result.get("status") or "").isdigit() else None
    data = result.get("data") if isinstance(result, dict) else None
    data = data if isinstance(data, dict) else {}
    general = data.get("informacion_general_vehiculo") if isinstance(data, dict) else None
    general = general if isinstance(general, dict) else {}
    tecnicos = data.get("datos_tecnicos") if isinstance(data, dict) else None
    tecnicos = tecnicos if isinstance(tecnicos, dict) else {}

    found = bool(data.get("found")) if isinstance(data, dict) and "found" in data else bool(result_status == 200)
    tipo_sugerido, confidence = _suggest_tipo_vehiculo(
        str(general.get("clase_vehiculo") or "").strip() or None,
        str(general.get("tipo_servicio") or "").strip() or None,
    )

    observaciones: list[str] = []
    if "{placa}" not in doc_number_tpl:
        observaciones.append("La plantilla APITUDE_RUNT_DOCUMENT_NUMBER_TEMPLATE no incluye '{placa}'.")
    if result_status == 404:
        observaciones.append("Apitude no encontró datos para la placa consultada.")
    if not found:
        observaciones.append("No se encontró información consolidada para autocompletar.")

    mapped = {
        "placa_consultada": placa_norm,
        "encontrado": found,
        "marca": str(general.get("marca") or "").strip() or None,
        "linea": str(general.get("linea") or "").strip() or None,
        "modelo": str(general.get("modelo") or "").strip() or None,
        "ano_modelo": _parse_year(general.get("modelo")),
        "color": str(general.get("color") or "").strip() or None,
        "clase_vehiculo": str(general.get("clase_vehiculo") or "").strip() or None,
        "tipo_servicio": str(general.get("tipo_servicio") or "").strip() or None,
        "cilindraje": str(general.get("cilidraje") or tecnicos.get("cilindraje") or "").strip() or None,
        "tipo_vehiculo_sugerido": tipo_sugerido,
        "confidence": confidence,
        "fuente": "apitude_runt",
        "request_id": request_id,
        "cached": False,
        "observaciones": observaciones,
    }
    _cache_set(placa_norm, mapped)
    return mapped
