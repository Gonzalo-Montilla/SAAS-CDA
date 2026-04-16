#!/usr/bin/env bash
# Revisión rápida del VPS para CDASOFT (no imprime secretos).
# Uso en el servidor:
#   chmod +x scripts/vps_health_check.sh
#   ./scripts/vps_health_check.sh
# Opcional:
#   REPO_ROOT=/var/www/cdasoft/repo API_PORT=8010 PUBLIC_URL=https://cdasoft.com.co ./scripts/vps_health_check.sh

set -u

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_PORT="${API_PORT:-8010}"
SERVICE="${SERVICE:-cdasoft-backend}"
PUBLIC_URL="${PUBLIC_URL:-https://cdasoft.com.co}"
BACKEND_DIR="$REPO_ROOT/backend"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/cdasoft}"

echo "=== CDASOFT — revisión VPS ==="
echo "REPO_ROOT=$REPO_ROOT  API_PORT=$API_PORT  SERVICE=$SERVICE"
echo

echo "--- Sistema (disco / memoria) ---"
df -h / 2>/dev/null | tail -n +1
echo
free -h 2>/dev/null || true
echo

echo "--- systemd: $SERVICE ---"
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  echo "[OK] servicio activo"
else
  echo "[ALERTA] servicio NO activo o no encontrado"
fi
systemctl status "$SERVICE" --no-pager -l 2>/dev/null | head -20 || true
echo

echo "--- Últimas líneas de log (errores recientes) ---"
journalctl -u "$SERVICE" -n 40 --no-pager 2>/dev/null | tail -25 || echo "(sin journalctl o sin permisos)"
echo

echo "--- API local (127.0.0.1:$API_PORT/health) ---"
if curl -sf --max-time 5 "http://127.0.0.1:${API_PORT}/health" >/dev/null; then
  echo "[OK] $(curl -sf --max-time 5 "http://127.0.0.1:${API_PORT}/health")"
else
  echo "[FALLO] no responde /health en puerto $API_PORT"
fi
echo

echo "--- API vía Nginx ($PUBLIC_URL/health) ---"
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "${PUBLIC_URL}/health" || echo "000")
if [[ "$code" == "200" ]]; then
  echo "[OK] HTTP $code"
else
  echo "[REVISAR] HTTP $code (¿Certbot? ¿Nginx? ¿firewall?)"
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
  echo "[ALERTA] no existe $BACKEND_DIR/.env"
fi
echo

echo "--- PostgreSQL (socket local) ---"
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h 127.0.0.1 -p 5432 && echo "[OK] pg_isready" || echo "[REVISAR] pg_isready falló"
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

echo "=== Fin. Si algo falló, revisa DEPLOY_VPS.md y PRODUCTION_CHECKLIST.md en el repo ==="
