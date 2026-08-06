#!/usr/bin/env bash
# Revisión rápida del VPS para CDASOFT (no imprime secretos).
# Uso en el servidor:
#   chmod +x scripts/vps_health_check.sh
#   ./scripts/vps_health_check.sh
# Opcional:
#   REPO_ROOT=/var/www/cdasoft/repo API_PORT=8010 PUBLIC_URL=https://cdasoft.com.co ./scripts/vps_health_check.sh
#
# Exit codes:
#   0 = OK
#   1 = fallo crítico (servicio caído, /health local o DB degraded, etc.)
# Compatible con cron de alerta (scripts/vps_alert_cron.sh).

set -u

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_PORT="${API_PORT:-8010}"
SERVICE="${SERVICE:-cdasoft-backend}"
PUBLIC_URL="${PUBLIC_URL:-https://cdasoft.com.co}"
BACKEND_DIR="$REPO_ROOT/backend"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/cdasoft}"

FAILS=0
fail() { echo "[ALERTA] $*"; FAILS=$((FAILS + 1)); }
ok() { echo "[OK] $*"; }

echo "=== CDASOFT — revisión VPS ==="
echo "REPO_ROOT=$REPO_ROOT  API_PORT=$API_PORT  SERVICE=$SERVICE"
echo

echo "--- Sistema (disco / memoria) ---"
df -h / 2>/dev/null | tail -n +1
echo
free -h 2>/dev/null || true
# Disco > 90% en / → alerta
root_use="$(df -P / 2>/dev/null | awk 'NR==2 { gsub(/%/,"",$5); print $5 }')"
if [[ -n "${root_use:-}" ]] && [[ "$root_use" -ge 90 ]]; then
  fail "disco / al ${root_use}%"
fi
echo

echo "--- systemd: $SERVICE ---"
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  ok "servicio activo"
else
  fail "servicio NO activo o no encontrado"
fi
systemctl status "$SERVICE" --no-pager -l 2>/dev/null | head -20 || true
echo

echo "--- Últimas líneas de log (errores recientes) ---"
journalctl -u "$SERVICE" -n 40 --no-pager 2>/dev/null | tail -25 || echo "(sin journalctl o sin permisos)"
echo

echo "--- API local (127.0.0.1:$API_PORT/health) ---"
health_body="$(curl -sS --max-time 5 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true)"
health_code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || echo "000")"
if [[ "$health_code" == "200" ]] && echo "$health_body" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  ok "HTTP $health_code $health_body"
elif [[ "$health_code" == "503" ]] || echo "$health_body" | grep -q '"status"[[:space:]]*:[[:space:]]*"degraded"'; then
  fail "health degraded (HTTP $health_code): $health_body"
else
  fail "no responde /health OK (HTTP $health_code): $health_body"
fi
echo

echo "--- API vía Nginx ($PUBLIC_URL/health) ---"
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "${PUBLIC_URL}/health" || echo "000")
if [[ "$code" == "200" ]]; then
  ok "HTTP $code"
elif [[ "$code" == "503" ]]; then
  fail "público /health HTTP 503 (DB o API degradada)"
else
  echo "[REVISAR] HTTP $code (¿Certbot? ¿Nginx? ¿firewall?)"
  # Público distinto de 200/503: no siempre crítico (DNS), pero cuenta como fallo en cron estricto
  if [[ "${STRICT_PUBLIC:-1}" == "1" ]]; then
    fail "público /health HTTP $code"
  fi
fi
echo

echo "--- Nginx (sitio cdasoft) ---"
if sudo -n true 2>/dev/null; then
  sudo nginx -t 2>&1 || true
  if [[ -f "$NGINX_SITE" ]]; then
    echo "Bloque HTTP→HTTPS (puerto 80):"
    grep -E "listen 80|return 30[12]" "$NGINX_SITE" || true
    echo "client_max_body_size en archivo (si no hay línea, Nginx usa 1m por defecto):"
    grep -n "client_max_body_size" "$NGINX_SITE" || echo "  (no definido en este archivo — valor por defecto 1m)"
  else
    echo "(no existe $NGINX_SITE — ajusta NGINX_SITE=...)"
  fi
else
  echo "(ejecutar con sudo para nginx -t y grep del sitio)"
fi
echo

echo "--- Certificados Let's Encrypt (expiración) ---"
if command -v certbot >/dev/null 2>&1; then
  certbot certificates 2>/dev/null | grep -A5 "cdasoft" || certbot certificates 2>/dev/null | head -30
else
  echo "(certbot no en PATH)"
fi
echo

echo "--- Permisos .env (debe ser legible solo por root/www-data según tu política) ---"
if [[ -f "$BACKEND_DIR/.env" ]]; then
  ls -la "$BACKEND_DIR/.env"
else
  fail "no existe $BACKEND_DIR/.env"
fi
echo

echo "--- PostgreSQL (socket local) ---"
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h 127.0.0.1 -p 5432; then
    ok "pg_isready"
  else
    fail "pg_isready falló"
  fi
else
  echo "(pg_isready no instalado — omitido)"
fi
echo

echo "--- Firewall (UFW) ---"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw status 2>/dev/null || ufw status 2>/dev/null || echo "(sin permisos para ufw status)"
else
  echo "(ufw no instalado — revisar iptables/nube a mano)"
fi
echo

echo "--- Cron relacionado con cdasoft (usuario actual) ---"
(crontab -l 2>/dev/null | grep -i cdasoft) || echo "(ninguna línea con 'cdasoft' en crontab de este usuario)"
echo

echo "=== Fin. Fallos críticos: $FAILS ==="
if [[ "$FAILS" -gt 0 ]]; then
  echo "Revisa DEPLOY_VPS.md y PRODUCTION_CHECKLIST.md"
  exit 1
fi
exit 0
