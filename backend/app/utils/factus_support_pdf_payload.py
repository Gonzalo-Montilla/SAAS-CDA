"""Decodifica PDF desde la respuesta de Factus (binario o JSON con base64)."""
from __future__ import annotations

import base64
from typing import Any, Union


def _find_pdf_base64(obj: object) -> str | None:
    if isinstance(obj, dict):
        for k in ("pdf_base64", "file", "base64_document", "pdf", "document_base64", "base64"):
            v = obj.get(k)
            if isinstance(v, str) and len(v) > 80:
                return v
        for v in obj.values():
            hit = _find_pdf_base64(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = _find_pdf_base64(v)
            if hit:
                return hit
    return None


def support_pdf_bytes_from_factus_download(raw_out: Union[dict[str, Any], bytes, bytearray]) -> bytes:
    if isinstance(raw_out, (bytes, bytearray)):
        b = bytes(raw_out)
        if len(b) < 5 or b[:4] != b"%PDF":
            raise ValueError("La respuesta binaria no es un PDF válido.")
        return b
    if not isinstance(raw_out, dict):
        raise ValueError("Respuesta Factus inesperada para PDF de documento soporte.")
    inner = raw_out.get("data") if isinstance(raw_out.get("data"), dict) else raw_out
    block = inner if isinstance(inner, dict) else raw_out
    if not isinstance(block, dict):
        block = raw_out
    b64 = (
        block.get("pdf_base64")
        or block.get("file")
        or block.get("base64_document")
        if isinstance(block, dict)
        else None
    )
    if not b64 and isinstance(block, dict) and isinstance(block.get("pdf"), str):
        b64 = block["pdf"]
    if not b64:
        b64 = _find_pdf_base64(raw_out)
    if not b64:
        raise ValueError("Factus no devolvió PDF en base64 en la respuesta JSON.")
    out = base64.b64decode(b64)
    if not out or out[:4] != b"%PDF":
        raise ValueError("El PDF decodificado no es válido.")
    return out
