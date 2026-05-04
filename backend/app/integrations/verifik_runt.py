"""
Integración Verifik para consulta RUNT por placa.

Docs:
GET /v2/co/runt/vehicle-by-plate
Headers: Authorization Bearer <token>
Params: documentType, documentNumber, plate
"""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urljoin

import httpx

from app.core.config import settings


class VerifikRuntError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return (resp.text or "")[:2000]


def _normalize_placa(placa: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (placa or "").upper()).strip()


def _normalize_doc_number(doc: str) -> str:
    return re.sub(r"\D", "", (doc or "").strip())


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


def _first_text(values: list[Any]) -> str | None:
    for v in values:
        s = str(v or "").strip()
        if s:
            return s
    return None


def _extract_titular_nombre(payload: dict[str, Any]) -> str | None:
    # Campos esperables según variantes de proveedores/fuentes.
    candidates = [
        payload.get("ownerName"),
        payload.get("owner_name"),
        payload.get("titular"),
        payload.get("titularNombre"),
        payload.get("nombreTitular"),
        payload.get("nombrePropietario"),
        payload.get("propietario"),
    ]

    # Estructuras potenciales
    info_general = payload.get("informacionGeneral")
    if isinstance(info_general, dict):
        candidates.extend(
            [
                info_general.get("nombreTitular"),
                info_general.get("nombrePropietario"),
                info_general.get("propietario"),
            ]
        )

    propietarios = payload.get("propietarios")
    if isinstance(propietarios, list) and propietarios:
        first = propietarios[0]
        if isinstance(first, dict):
            candidates.extend(
                [
                    first.get("nombre"),
                    first.get("nombreCompleto"),
                    first.get("fullName"),
                    first.get("razonSocial"),
                ]
            )

    return _first_text(candidates)


def _suggest_tipo_vehiculo(clasificacion: str | None, tipo_servicio: str | None) -> tuple[str | None, str | None]:
    clase = (clasificacion or "").upper()
    servicio = (tipo_servicio or "").upper()

    if "MOTO" in clase:
        return "moto", "high"

    heavy_keys = ("CAMION", "TRACTO", "BUS", "BUSETA", "MICROBUS", "VOLQUETA", "REMOL")
    is_heavy = any(k in clase for k in heavy_keys)
    is_public = "PUBLIC" in servicio or "PÚBLIC" in servicio

    if is_heavy and is_public:
        return "pesado_publico", "medium"
    if is_heavy and not is_public:
        return "pesado_particular", "medium"
    if is_public:
        return "liviano_publico", "medium"
    if clase:
        return "liviano_particular", "medium"
    return None, None


def _cache_key(placa: str, doc_type: str, doc_number: str) -> str:
    return f"{placa}|{doc_type}|{doc_number}"


def _cache_get(key: str) -> dict[str, Any] | None:
    ttl = int(settings.VERIFIK_RUNT_CACHE_TTL_SECONDS or 0)
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
    ttl = int(settings.VERIFIK_RUNT_CACHE_TTL_SECONDS or 0)
    if ttl <= 0:
        return
    _CACHE[key] = (time.time() + ttl, dict(data))


def consultar_runt_vehiculo_por_placa(
    placa: str,
    *,
    document_type: str | None = None,
    document_number: str | None = None,
) -> dict[str, Any]:
    if not settings.VERIFIK_ENABLED:
        raise VerifikRuntError(
            "Consulta RUNT externa deshabilitada. Configure VERIFIK_ENABLED=True para activarla."
        )
    token = (settings.VERIFIK_TOKEN or "").strip()
    if not token:
        raise VerifikRuntError("VERIFIK_TOKEN no configurado.")

    placa_norm = _normalize_placa(placa)
    if len(placa_norm) < 5:
        raise VerifikRuntError("La placa debe tener al menos 5 caracteres.")

    doc_type = (document_type or settings.VERIFIK_RUNT_DEFAULT_DOCUMENT_TYPE or "CC").strip().upper()
    if doc_type not in {"CC", "CE", "PA", "NIT"}:
        raise VerifikRuntError("documentType inválido. Valores permitidos: CC, CE, PA, NIT.")

    doc_number = _normalize_doc_number(document_number or "")
    if not doc_number:
        raise VerifikRuntError("documentNumber es obligatorio para consultar RUNT con Verifik.")

    key = _cache_key(placa_norm, doc_type, doc_number)
    cached = _cache_get(key)
    if cached:
        return cached

    base_url = (settings.VERIFIK_BASE_URL or "https://api.verifik.co").rstrip("/") + "/"
    service_path = (settings.VERIFIK_RUNT_SERVICE_PATH or "/v2/co/runt/vehicle-by-plate").strip()
    url = service_path if service_path.startswith("http") else urljoin(base_url, service_path.lstrip("/"))
    timeout = float(settings.VERIFIK_TIMEOUT_SECONDS or 15.0)

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    params = {
        "documentType": doc_type,
        "documentNumber": doc_number,
        "plate": placa_norm,
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.get(url, headers=headers, params=params)
        raw = _safe_json(resp)
        if resp.status_code >= 400:
            msg = "Verifik rechazó la consulta RUNT."
            if isinstance(raw, dict) and raw.get("message"):
                msg = str(raw.get("message"))
            raise VerifikRuntError(msg, status_code=resp.status_code, body=raw)

    if not isinstance(raw, dict):
        raise VerifikRuntError("Respuesta inválida de Verifik.", body=raw)

    data = raw.get("data")
    payload = data if isinstance(data, dict) else {}
    # Soporte para endpoint simplificado y completo.
    vehicle = payload.get("vehicle")
    if not isinstance(vehicle, dict):
        info_general = payload.get("informacionGeneral")
        vehicle = info_general if isinstance(info_general, dict) else {}

    plate_returned = str(payload.get("plate") or vehicle.get("noPlaca") or placa_norm).strip().upper()
    found = bool(vehicle)
    titular_nombre = _extract_titular_nombre(payload)
    tipo_sugerido, confidence = _suggest_tipo_vehiculo(
        str(vehicle.get("clasificacion") or vehicle.get("claseVehiculo") or "").strip() or None,
        str(vehicle.get("tipoServicio") or "").strip() or None,
    )

    observaciones: list[str] = []
    if not found:
        observaciones.append("No se encontró información consolidada para autocompletar.")
    if found and not titular_nombre:
        observaciones.append("Verifik no devolvió nombre del titular en esta consulta.")

    mapped = {
        "placa_consultada": plate_returned,
        "document_type": str(payload.get("documentType") or doc_type).strip() or None,
        "document_number": str(payload.get("documentNumber") or doc_number).strip() or None,
        "titular_nombre": titular_nombre,
        "encontrado": found,
        "marca": str(vehicle.get("marca") or "").strip() or None,
        "linea": str(vehicle.get("linea") or "").strip() or None,
        "modelo": str(vehicle.get("modelo") or "").strip() or None,
        "ano_modelo": _parse_year(vehicle.get("modelo")),
        "color": str(vehicle.get("color") or "").strip() or None,
        "clase_vehiculo": str(vehicle.get("clasificacion") or "").strip() or None,
        "tipo_servicio": str(vehicle.get("tipoServicio") or "").strip() or None,
        "cilindraje": str(vehicle.get("cilindraje") or "").strip() or None,
        "tipo_vehiculo_sugerido": tipo_sugerido,
        "confidence": confidence,
        "fuente": "verifik_runt",
        "proveedor": "verifik",
        "request_id": str(raw.get("id") or "").strip() or None,
        "cached": False,
        "observaciones": observaciones,
    }
    _cache_set(key, mapped)
    return mapped
