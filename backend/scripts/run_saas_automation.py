"""
Automatizaciones SaaS operativas:
- Sincroniza tenants demo vencidos / pagos vencidos.
- Procesa recordatorios de citas (agendamiento).
- Procesa invitaciones pendientes de calidad.

Uso:
    python scripts/run_saas_automation.py
    python scripts/run_saas_automation.py --appointments-limit 0 --quality-limit 0
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys
import traceback

CURRENT_FILE = Path(__file__).resolve()
BACKEND_ROOT = CURRENT_FILE.parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.database import SessionLocal
from app.models.password_reset_token import PasswordResetToken  # noqa: F401
from app.api.v1.endpoints.saas_auth import sync_expired_demo_tenants
from app.api.v1.endpoints.appointments import process_due_appointment_reminders
from app.utils.quality import process_due_quality_invites


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_automation(appointments_limit: int, quality_limit: int) -> int:
    print(f"[AUTOMATION] Inicio: {_utc_now_iso()}")
    db = SessionLocal()
    try:
        sync_expired_demo_tenants(db)
        print("[AUTOMATION] Tenants demo/pago sincronizados")

        reminders_processed = 0
        if appointments_limit > 0:
            reminders_processed = process_due_appointment_reminders(db, limit=appointments_limit)
        print(f"[AUTOMATION] Recordatorios de citas procesados: {reminders_processed}")

        quality_processed = 0
        if quality_limit > 0:
            quality_processed = process_due_quality_invites(db, limit=quality_limit, force_send=False)
        print(f"[AUTOMATION] Invitaciones de calidad procesadas: {quality_processed}")

        print(f"[AUTOMATION] Fin OK: {_utc_now_iso()}")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"[AUTOMATION] Error: {exc}")
        traceback.print_exc()
        return 1
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Runner de automatizaciones SaaS.")
    parser.add_argument(
        "--appointments-limit",
        type=int,
        default=200,
        help="Máximo de recordatorios de citas a procesar por ejecución (0 = omitir).",
    )
    parser.add_argument(
        "--quality-limit",
        type=int,
        default=100,
        help="Máximo de invitaciones de calidad a procesar por ejecución (0 = omitir).",
    )
    args = parser.parse_args()

    appointments_limit = max(int(args.appointments_limit), 0)
    quality_limit = max(int(args.quality_limit), 0)
    return run_automation(appointments_limit=appointments_limit, quality_limit=quality_limit)


if __name__ == "__main__":
    raise SystemExit(main())

