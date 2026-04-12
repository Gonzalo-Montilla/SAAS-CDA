#!/usr/bin/env bash
set -euo pipefail

# Respaldo comprimido de la base CDASOFT usando DATABASE_URL del backend/.env
# Requiere: cliente PostgreSQL (pg_dump) en el PATH.
#
# Uso manual:
#   chmod +x /var/www/cdasoft/repo/backup_postgres_cdasoft.sh
#   /var/www/cdasoft/repo/backup_postgres_cdasoft.sh
#
# Carpeta de salida (opcional):
#   BACKUP_DIR=/ruta/custom /var/www/cdasoft/repo/backup_postgres_cdasoft.sh

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
LOG_DIR="$PROJECT_ROOT/logs"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cdasoft}"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

if [[ -x "$BACKEND_DIR/venv/bin/python" ]]; then
  PY="$BACKEND_DIR/venv/bin/python"
elif [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  PY="$BACKEND_DIR/.venv/bin/python"
else
  echo "[ERROR] No hay venv en $BACKEND_DIR/venv ni .venv"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[ERROR] pg_dump no encontrado. En Ubuntu: sudo apt install -y postgresql-client"
  exit 1
fi

cd "$BACKEND_DIR"
DBURL="$("$PY" -c "
from pathlib import Path
from dotenv import load_dotenv
import os
load_dotenv(Path('.env'))
u = os.environ.get('DATABASE_URL', '').strip()
print(u)
")"

if [[ -z "$DBURL" ]]; then
  echo "[ERROR] DATABASE_URL vacío en $BACKEND_DIR/.env"
  exit 1
fi

stamp="$(date -u +"%Y%m%d_%H%M%SZ")"
out="$BACKUP_DIR/cdasoft_${stamp}.sql.gz"

{
  echo "======================================================"
  echo "[BACKUP] $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  pg_dump "$DBURL" | gzip -9 > "$out"
  echo "[OK] $out ($(du -h "$out" | cut -f1))"
} >> "$LOG_DIR/pg_backup.log" 2>&1

echo "[OK] Respaldo guardado: $out (detalle en $LOG_DIR/pg_backup.log)"

# Opcional: borrar respaldos con más de 14 días (descomenta si lo quieres)
# find "$BACKUP_DIR" -name 'cdasoft_*.sql.gz' -mtime +14 -delete
