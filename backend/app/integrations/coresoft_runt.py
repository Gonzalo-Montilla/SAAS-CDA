"""
Integración CoreSoft para consulta RUNT por placa + documento.
"""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.config import settings


class CoreSoftRuntError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _normalize_placa(placa: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (placa or "").upper()).strip()


def _normalize_documento(documento: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (documento or "").upper()).strip()


def _cache_key(placa: str, documento: str) -> str:
    return f"{placa}|{documento}"


def _cache_get(key: str) -> dict[str, Any] | None:
    ttl = int(settings.CORESOFT_RUNT_CACHE_TTL_SECONDS or 0)
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
    ttl = int(settings.CORESOFT_RUNT_CACHE_TTL_SECONDS or 0)
    if ttl <= 0:
        return
    _CACHE[key] = (time.time() + ttl, dict(data))


def _safe_json(resp: httpx.Response) -> dict[str, Any] | Any:
    try:
        return resp.json()
    except Exception:
        return {"raw": (resp.text or "")[:2000]}


def _parse_year(value: Any) -> int | None:
    digits = re.sub(r"\D", "", str(value or ""))
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


def consultar_coresoft_runt_por_placa(placa: str, *, documento: str) -> dict[str, Any]:
    if not settings.CORESOFT_ENABLED:
        raise CoreSoftRuntError(
            "Consulta CoreSoft deshabilitada. Configure CORESOFT_ENABLED=True para activarla."
        )
    api_key = (settings.CORESOFT_API_KEY or "").strip()
    if not api_key:
        raise CoreSoftRuntError("CORESOFT_API_KEY no configurada.")

    placa_norm = _normalize_placa(placa)
    if len(placa_norm) < 5:
        raise CoreSoftRuntError("La placa debe tener al menos 5 caracteres.")
    documento_norm = _normalize_documento(documento)
    if len(documento_norm) < 5:
        raise CoreSoftRuntError("El documento es obligatorio para consulta RUNT en CoreSoft.")

    key = _cache_key(placa_norm, documento_norm)
    cached = _cache_get(key)
    if cached:
        return cached

    base_url = (settings.CORESOFT_BASE_URL or "https://coresoft.solutions").rstrip("/") + "/"
    service_path = (settings.CORESOFT_RUNT_SERVICE_PATH or "/api/runt").strip()
    url = service_path if service_path.startswith("http") else urljoin(base_url, service_path.lstrip("/"))
    timeout = float(settings.CORESOFT_TIMEOUT_SECONDS or 15.0)

    headers = {
        "X-API-Key": api_key,
        "Accept": "application/json",
    }
    params = {
        "placa": placa_norm,
        "documento": documento_norm,
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers, params=params)
    except httpx.HTTPError as exc:
        raise CoreSoftRuntError(
            "No fue posible conectar con CoreSoft (error de red o DNS).",
            status_code=503,
            body=str(exc),
        ) from exc

    raw = _safe_json(resp)
    if resp.status_code >= 400:
        msg = "CoreSoft rechazó la consulta RUNT."
        if isinstance(raw, dict):
            msg = str(raw.get("message") or raw.get("error") or msg)
        raise CoreSoftRuntError(msg, status_code=resp.status_code, body=raw)
    if not isinstance(raw, dict):
        raise CoreSoftRuntError("Respuesta inválida de CoreSoft.", body=raw)

    success = bool(raw.get("success"))
    payload = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    consulta = payload.get("consulta") if isinstance(payload, dict) and isinstance(payload.get("consulta"), dict) else {}
    vehiculo = payload.get("vehiculo") if isinstance(payload, dict) and isinstance(payload.get("vehiculo"), dict) else payload
    propietario = {}
    if isinstance(payload, dict) and isinstance(payload.get("propietario"), dict):
        propietario = payload.get("propietario") or {}
    if isinstance(vehiculo, dict) and isinstance(vehiculo.get("propietario"), dict):
        propietario = vehiculo.get("propietario") or propietario

    marca = str((vehiculo or {}).get("marca") or "").strip() or None
    linea = str((vehiculo or {}).get("linea") or "").strip() or None
    modelo = str((vehiculo or {}).get("modelo") or "").strip() or None
    color = str((vehiculo or {}).get("color") or "").strip() or None
    clase = str((vehiculo or {}).get("clase") or (vehiculo or {}).get("claseVehiculo") or "").strip() or None
    tipo_servicio = str((vehiculo or {}).get("tipoServicio") or (vehiculo or {}).get("servicio") or "").strip() or None
    cilindraje = str((vehiculo or {}).get("cilindraje") or "").strip() or None
    ano_modelo = _parse_year(modelo or (vehiculo or {}).get("ano_modelo"))
    tipo_sugerido, confidence = _suggest_tipo_vehiculo(clase)

    titular_nombre = str((propietario or {}).get("nombre") or "").strip() or None
    owner_doc = str((propietario or {}).get("documento") or "").strip() or None
    owner_doc_type = str((propietario or {}).get("tipo_documento") or "").strip().upper() or None

    found_by_fields = any([marca, linea, modelo, clase, tipo_servicio, cilindraje])
    estado_consulta = str(consulta.get("estado") or "").strip().lower()
    encontrado = bool(success and (found_by_fields or estado_consulta in {"exitosa", "ok", "success"}))

    observaciones: list[str] = []
    if not encontrado:
        observaciones.append("CoreSoft no devolvió información consolidada para autocompletar.")

    out = {
        "placa_consultada": str((vehiculo or {}).get("placa") or placa_norm).strip().upper(),
        "document_type": owner_doc_type,
        "document_number": owner_doc or documento_norm,
        "titular_nombre": titular_nombre,
        "encontrado": encontrado,
        "marca": marca,
        "linea": linea,
        "modelo": modelo,
        "ano_modelo": ano_modelo,
        "color": color,
        "clase_vehiculo": clase,
        "tipo_servicio": tipo_servicio,
        "cilindraje": cilindraje,
        "tipo_vehiculo_sugerido": tipo_sugerido,
        "confidence": confidence,
        "fuente": "coresoft_runt",
        "proveedor": "coresoft",
        "request_id": str(raw.get("request_id") or raw.get("id") or "").strip() or None,
        "cached": False,
        "observaciones": observaciones,
    }
    _cache_set(key, out)
    return out
