"""Lectura de licencia de tránsito (tarjeta de propiedad). No persiste ni registra."""
from __future__ import annotations

import json
import re
from typing import Any

MAX_TARJETA_BYTES = 6 * 1024 * 1024
TIPOS_DOC = {"CC", "CE", "PA", "NIT"}
TIPOS_FISICOS = {
    "moto",
    "liviano_particular",
    "liviano_publico",
    "pesado_particular",
    "pesado_publico",
}


def sniff_image_mime(data: bytes) -> str | None:
    if not data or len(data) < 3:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 8 and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def extraer_json(texto: str) -> dict[str, Any] | None:
    raw = (texto or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, flags=re.S)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None


def normalizar_placa(valor: str | None) -> str | None:
    placa = re.sub(r"[^A-Za-z0-9]", "", (valor or "").upper()).strip()
    if 5 <= len(placa) <= 10:
        return placa
    return None


def normalizar_documento(valor: str | None, tipo: str | None) -> tuple[str | None, str | None]:
    tipo_n = (tipo or "CC").strip().upper()
    if tipo_n not in TIPOS_DOC:
        tipo_n = "CC"
    bruto = (valor or "").strip()
    if tipo_n == "PA":
        numero = re.sub(r"[^A-Za-z0-9]", "", bruto).upper()
    else:
        numero = re.sub(r"\D", "", bruto)
    if len(numero) < 5:
        return tipo_n, None
    return tipo_n, numero[:20]


def sugerir_tipo_vehiculo(clase: str | None, servicio: str | None) -> str | None:
    clase_u = (clase or "").strip().upper()
    servicio_u = (servicio or "").strip().upper()
    if "PREVENTIVA" in clase_u or "PREVENTIVA" in servicio_u:
        return None
    publico = "PUBLIC" in servicio_u
    if "MOTO" in clase_u:
        return "moto"
    # CAMIONETA contiene "CAMION"; tratarla como liviano antes del pesado.
    if "CAMIONETA" in clase_u or "CAMPERO" in clase_u:
        return "liviano_publico" if publico else "liviano_particular"
    pesado = ("CAMION", "TRACTO", "BUS", "BUSETA", "MICROBUS", "VOLQUETA", "REMOL", "CARGA")
    if any(k in clase_u for k in pesado):
        return "pesado_publico" if publico else "pesado_particular"
    if clase_u:
        return "liviano_publico" if publico else "liviano_particular"
    return None


def _texto(valor: Any, max_len: int = 120) -> str | None:
    s = str(valor or "").strip()
    if not s or s.lower() in {"null", "none", "n/a", "-", "****", "*******"}:
        return None
    return s[:max_len]


def _ano(valor: Any) -> int | None:
    digits = re.sub(r"\D", "", str(valor or ""))
    if len(digits) < 4:
        return None
    year = int(digits[:4])
    if 1950 <= year <= 2100:
        return year
    return None


def lectura_vacia(*, motivo: str) -> dict[str, Any]:
    return {
        "encontrado": False,
        "es_licencia_transito": False,
        "placa_consultada": "",
        "document_type": None,
        "document_number": None,
        "titular_nombre": None,
        "marca": None,
        "linea": None,
        "modelo": None,
        "ano_modelo": None,
        "color": None,
        "clase_vehiculo": None,
        "tipo_servicio": None,
        "tipo_combustible": None,
        "cilindraje": None,
        "capacidad_pasajeros": None,
        "numero_motor": None,
        "vin": None,
        "numero_chasis": None,
        "tipo_vehiculo_sugerido": None,
        "confidence": None,
        "fuente": "tarjeta_propiedad",
        "proveedor": "grok",
        "request_id": None,
        "cached": False,
        "observaciones": [motivo[:300]],
    }


def normalizar_lectura(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return lectura_vacia(motivo="No se pudo leer un JSON de la imagen.")
    es_licencia = bool(raw.get("es_licencia_transito", raw.get("encontrado")))
    placa = normalizar_placa(_texto(raw.get("placa")))
    if not es_licencia or not placa:
        return lectura_vacia(
            motivo="La imagen no parece una licencia de tránsito colombiana o la placa no se leyó."
        )
    tipo_doc, numero_doc = normalizar_documento(raw.get("document_number"), raw.get("document_type"))
    clase = _texto(raw.get("clase_vehiculo"), 80)
    servicio = _texto(raw.get("tipo_servicio") or raw.get("servicio"), 40)
    tipo_sug = sugerir_tipo_vehiculo(clase, servicio)
    if tipo_sug not in TIPOS_FISICOS:
        tipo_sug = None
    linea = _texto(raw.get("linea"), 80)
    modelo_txt = _texto(raw.get("modelo"), 80)
    ano = _ano(raw.get("ano_modelo") or raw.get("modelo"))
    if modelo_txt and re.fullmatch(r"\d{4}", modelo_txt):
        ano = ano or int(modelo_txt)
        modelo_txt = linea
    return {
        "encontrado": True,
        "es_licencia_transito": True,
        "placa_consultada": placa,
        "document_type": tipo_doc,
        "document_number": numero_doc,
        "titular_nombre": (_texto(raw.get("titular_nombre"), 200) or "").upper() or None,
        "marca": _texto(raw.get("marca"), 80),
        "linea": linea,
        "modelo": modelo_txt or linea,
        "ano_modelo": ano,
        "color": _texto(raw.get("color"), 40),
        "clase_vehiculo": clase,
        "tipo_servicio": servicio,
        "tipo_combustible": _texto(raw.get("tipo_combustible") or raw.get("combustible"), 30),
        "cilindraje": _texto(raw.get("cilindraje"), 20),
        "capacidad_pasajeros": _texto(raw.get("capacidad_pasajeros") or raw.get("capacidad"), 10),
        "numero_motor": _texto(raw.get("numero_motor"), 40),
        "vin": _texto(raw.get("vin"), 40),
        "numero_chasis": _texto(raw.get("numero_chasis"), 40),
        "tipo_vehiculo_sugerido": tipo_sug,
        "confidence": _texto(raw.get("confidence"), 12) or "medium",
        "fuente": "tarjeta_propiedad",
        "proveedor": "grok",
        "request_id": None,
        "cached": False,
        "observaciones": [],
    }
