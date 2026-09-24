"""Prueba local: leer una licencia de tránsito con Grok. No envía WhatsApp ni registra.

Uso (con XAI_API_KEY en backend/.env):

    cd backend
    python scripts/probar_grok_tarjeta.py ruta\\a\\tarjeta.jpg
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.integrations.xai_client import grok_disponible, leer_licencia_transito  # noqa: E402
from app.services.tarjeta_propiedad import sniff_image_mime  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Uso: python scripts/probar_grok_tarjeta.py ruta/a/tarjeta.jpg")
        return 1
    path = Path(argv[1])
    if not path.is_file():
        print(f"No existe el archivo: {path}")
        return 1
    data = path.read_bytes()
    mime = sniff_image_mime(data)
    if not mime:
        print("El archivo no es JPEG, PNG o WebP.")
        return 1
    if not grok_disponible():
        print("Falta XAI_API_KEY en backend/.env. No se llama a Grok.")
        return 1
    print(f"Leyendo {path.name} ({mime}, {len(data)} bytes)...")
    resultado = leer_licencia_transito(data, mime)
    if not resultado:
        print("Grok no devolvió JSON usable.")
        return 2
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    return 0 if resultado.get("encontrado") else 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
