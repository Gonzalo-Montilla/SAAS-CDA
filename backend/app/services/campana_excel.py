"""Parseo de listas Excel/CSV para campañas. Habeas obligatorio por fila."""
from __future__ import annotations

from typing import Any

from app.services.campana_audiencias import autorizo_habeas
from app.utils.whatsapp_phone import normalizar_celular_co

_HEADERS = {
    "nombre": {"nombre", "name", "cliente", "cliente_nombre"},
    "celular": {"celular", "telefono", "teléfono", "phone", "whatsapp", "movil", "móvil"},
    "correo": {"correo", "email", "mail"},
    "autorizo_habeas": {
        "autorizo_habeas",
        "habeas",
        "autorizo",
        "autorizacion",
        "autorización",
        "opt_in",
        "optin",
    },
}


def _norm_header(raw: Any) -> str:
    return (
        str(raw or "")
        .strip()
        .lower()
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace(" ", "_")
    )


def _map_headers(headers: list[str]) -> dict[str, int]:
    found: dict[str, int] = {}
    for idx, header in enumerate(headers):
        h = _norm_header(header)
        for campo, aliases in _HEADERS.items():
            if h in aliases and campo not in found:
                found[campo] = idx
    return found


def filas_desde_matriz(headers: list[str], rows: list[list[Any]]) -> tuple[list[dict[str, str]], list[str]]:
    """Devuelve (filas_ok_para_schema, errores)."""
    mapped = _map_headers(headers)
    errores: list[str] = []
    if "nombre" not in mapped or "autorizo_habeas" not in mapped:
        return [], [
            "El Excel debe traer columnas nombre y autorizo_habeas (si / no). Incluya celular y/o correo."
        ]
    if "celular" not in mapped and "correo" not in mapped:
        return [], ["El Excel debe traer una columna de celular o de correo."]
    filas: list[dict[str, str]] = []
    for i, row in enumerate(rows, start=2):
        def _cell(campo: str) -> str:
            idx = mapped.get(campo)
            if idx is None or idx >= len(row):
                return ""
            return str(row[idx] or "").strip()

        nombre = _cell("nombre")
        celular = _cell("celular")
        correo = _cell("correo")
        habeas = _cell("autorizo_habeas")
        if not nombre and not celular and not correo:
            continue
        if not nombre:
            errores.append(f"Fila {i}: falta el nombre.")
            continue
        if not autorizo_habeas(habeas):
            errores.append(f"Fila {i}: sin autorización de habeas (debe ser si).")
            continue
        e164 = normalizar_celular_co(celular)
        mail_ok = bool(correo) and "@" in correo
        if not e164 and not mail_ok:
            errores.append(f"Fila {i}: falta un celular colombiano válido o un correo.")
            continue
        filas.append(
            {
                "nombre": nombre[:200],
                "celular": celular,
                "correo": correo[:255] if correo else None,
                "autorizo_habeas": "si",
            }
        )
    return filas, errores
