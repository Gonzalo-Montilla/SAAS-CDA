#!/usr/bin/env bash
# Cron ligero: corre vps_health_check.sh; si falla, append a log de alerta
# y opcionalmente POST a ALERT_WEBHOOK_URL (Slack/Discord/etc.).
#
# Crontab (cada 5 min):
#   */5 * * * * /var/www/cdasoft/repo/scripts/vps_alert_cron.sh >> /var/www/cdasoft/repo/logs/vps_alert_cron.log 2>&1
#
# Opcional en el entorno o en backend/.env no hace falta: exporta en crontab:
#   ALERT_WEBHOOK_URL=https://hooks.slack.com/...

set -u

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="$REPO_ROOT/logs"
ALERT_FILE="${ALERT_FILE:-$LOG_DIR/vps_alerts.log}"
HEALTH_SCRIPT="$REPO_ROOT/scripts/vps_health_check.sh"

mkdir -p "$LOG_DIR"

ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
out_file="$(mktemp)"
trap 'rm -f "$out_file"' EXIT

set +e
STRICT_PUBLIC="${STRICT_PUBLIC:-1}" "$HEALTH_SCRIPT" >"$out_file" 2>&1
rc=$?
set -e

if [[ "$rc" -eq 0 ]]; then
  echo "[$ts] health OK"
  exit 0
fi

{
  echo "======================================================"
  echo "[ALERT] $ts exit=$rc"
  cat "$out_file"
  echo
} >> "$ALERT_FILE"

echo "[$ts] HEALTH FAIL — append $ALERT_FILE" >&2

if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
  # Payload genérico JSON (Slack incoming webhook acepta text=)
  snippet="$(head -c 1500 "$out_file" | tr '\n' ' ' | sed 's/"/\\"/g')"
  curl -sS -X POST -H 'Content-Type: application/json' \
    --max-time 10 \
    -d "{\"text\":\"CDASOFT VPS health FAIL ($ts): $snippet\"}" \
    "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

exit "$rc"
