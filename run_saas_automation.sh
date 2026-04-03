#!/usr/bin/env bash
set -euo pipefail

# Ejecuta automatizaciones SaaS:
# - sync de estados de tenant
# - recordatorios de agendamiento
# - envío de encuestas de calidad pendientes
#
# Uso:
#   ./run_saas_automation.sh
#   APPOINTMENTS_LIMIT=300 QUALITY_LIMIT=150 ./run_saas_automation.sh

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/saas_automation.log"

APPOINTMENTS_LIMIT="${APPOINTMENTS_LIMIT:-200}"
QUALITY_LIMIT="${QUALITY_LIMIT:-100}"

mkdir -p "$LOG_DIR"

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "[ERROR] No existe directorio backend en: $BACKEND_DIR"
  exit 1
fi

cd "$BACKEND_DIR"

if [[ -f ".venv/bin/activate" ]]; then
  # Linux/Mac virtualenv
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
elif [[ -f ".venv/Scripts/activate" ]]; then
  # Git Bash en Windows
  # shellcheck disable=SC1091
  source ".venv/Scripts/activate"
fi

{
  echo "======================================================"
  echo "[RUN] $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  python "scripts/run_saas_automation.py" \
    --appointments-limit "$APPOINTMENTS_LIMIT" \
    --quality-limit "$QUALITY_LIMIT"
} >> "$LOG_FILE" 2>&1

echo "[OK] Automatización ejecutada. Revisa: $LOG_FILE"

