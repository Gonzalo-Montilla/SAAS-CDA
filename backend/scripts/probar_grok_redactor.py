"""Una sola llamada real a Grok: redacta documentos RTM. No envía WhatsApp.

Uso (con XAI_API_KEY en backend/.env):

    cd backend
    python scripts/probar_grok_redactor.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.integrations.xai_client import grok_disponible, redactar_whatsapp  # noqa: E402


def main() -> int:
    if not grok_disponible():
        print("Falta XAI_API_KEY en backend/.env (console.x.ai). No se llama a Grok.")
        return 1
    nombre = "CDA Quitamelsueño"
    cliente = "Hola, qué documentos debo llevar para la revisión"
    hechos = (
        f"- CDA: {nombre}\n"
        "- Documentos RTM: solo licencia de tránsito (tarjeta de propiedad) y el vehículo limpio. "
        "El SOAT no es obligatorio. "
        "Servicio público: no se piden documentos extra; con la tarjeta de propiedad basta."
    )
    base = (
        f"Para la revisión técnico-mecánica en {nombre} lo obligatorio es "
        "la licencia de tránsito (tarjeta de propiedad) y el vehículo limpio. "
        "El SOAT no es obligatorio. Si es servicio público, con la tarjeta de propiedad basta."
    )
    print("CDASoft (hechos / texto base):")
    print(base)
    print("---")
    frase, _uso = redactar_whatsapp(
        nombre_cda=nombre,
        mensaje_cliente=cliente,
        hechos=hechos,
        texto_base=base,
    )
    if not frase:
        print("Grok no devolvió frase usable (error, vacío o se salió de los hechos). Se usaría el texto base.")
        return 2
    print("Grok (una sola prueba):")
    print(frase)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
