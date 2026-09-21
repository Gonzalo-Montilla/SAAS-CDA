"""
Envío de prueba por Resend (misma ruta que producción).

Uso, desde backend/:
    python scripts/probar_resend.py su-correo@ejemplo.com
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import os

os.chdir(BACKEND_ROOT)

from app.core.config import settings  # noqa: E402
from app.utils.email import _email_from_header, _usa_resend, enviar_email  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2 or not (sys.argv[1] or "").strip():
        print("Uso: python scripts/probar_resend.py su-correo@ejemplo.com")
        return 2

    destino = sys.argv[1].strip()
    key = (getattr(settings, "RESEND_API_KEY", None) or "").strip()
    if not key:
        print("Falta RESEND_API_KEY en backend/.env")
        return 1
    if not _usa_resend():
        print("No se activó Resend. Revise RESEND_API_KEY en backend/.env")
        return 1

    print(f"From: {_email_from_header()}")
    print(f"To:   {destino}")
    print(f"Key:  ...{key[-4:]}")
    ok = enviar_email(
        destino,
        "Prueba Resend — CDASOFT",
        """
        <p>Si está leyendo esto, Resend envió el correo desde <strong>cdasoft.com.co</strong>.</p>
        <p>Este mensaje es solo una prueba local. Puede ignorarlo o borrarlo.</p>
        """,
    )
    if ok:
        print("OK: Resend aceptó el envío. Revise bandeja e spam.")
        return 0
    print("FALLÓ: vea el error de Resend arriba.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
