#!/usr/bin/env bash
# Deploy en el VPS (desde /var/www/cdasoft/repo).
# Uso:
#   ./scripts/deploy_on_vps.sh                 # pull ya hecho; backend restart + health; swap si existe dist_new
#   ./scripts/deploy_on_vps.sh --backend-only  # solo backend
#   ./scripts/deploy_on_vps.sh --frontend-swap-only
#   ./scripts/deploy_on_vps.sh --pull          # git pull --ff-only antes
#
# Regla anti-404: dist_new/index.html debe existir en la raíz (nunca dist_new/dist/).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
SERVICE="${SERVICE:-cdasoft-backend}"
API_PORT="${API_PORT:-8010}"

DO_PULL=0
BACKEND_ONLY=0
FRONTEND_SWAP_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --pull) DO_PULL=1 ;;
    --backend-only) BACKEND_ONLY=1 ;;
    --frontend-swap-only) FRONTEND_SWAP_ONLY=1 ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *)
      echo "[ERROR] Argumento desconocido: $arg" >&2
      exit 1
      ;;
  esac
done

fail() { echo "[ERROR] $*" >&2; exit 1; }
ok() { echo "[OK] $*"; }

cd "$REPO_ROOT"

if [[ "$DO_PULL" -eq 1 ]]; then
  if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
    fail "git status no vacío. Resuelve o stash (DEPLOY_VPS.md §15.3) antes de --pull"
  fi
  git pull --ff-only origin main
  ok "git pull --ff-only"
fi

swap_frontend() {
  local dist_new="$FRONTEND_DIR/dist_new"
  [[ -d "$dist_new" ]] || fail "No existe $dist_new"
  [[ -f "$dist_new/index.html" ]] || fail "Falta dist_new/index.html (¿dist anidado? ls: $(ls -la "$dist_new" | head -20))"
  if [[ -f "$dist_new/dist/index.html" ]]; then
    fail "Detectado dist_new/dist/ (anidado). Borra dist_new y vuelve a subir el CONTENIDO de dist/"
  fi

  local ts
  ts="$(date +%F-%H%M)"
  cd "$FRONTEND_DIR"
  if [[ -d dist ]]; then
    sudo mv dist "dist.prev-$ts"
    ok "Backup dist -> dist.prev-$ts"
  fi
  sudo mv dist_new dist
  sudo chown -R www-data:www-data dist
  sudo nginx -t
  sudo systemctl reload nginx
  ok "Frontend swap atómico + nginx reload"
}

restart_backend() {
  cd "$BACKEND_DIR"
  [[ -x ./venv/bin/python ]] || fail "No hay venv en $BACKEND_DIR/venv"
  sudo -u www-data ./venv/bin/python -m py_compile \
    app/main.py \
    app/db/database.py \
    app/api/v1/endpoints/vehiculos.py
  sudo -u www-data ./venv/bin/python -c "import app.main; print('import-ok')"
  sudo systemctl restart "$SERVICE"
  # Con --workers 2 + init_db() por worker el arranque puede tardar >2s.
  local body="" attempt=0
  while [[ "$attempt" -lt 30 ]]; do
    attempt=$((attempt + 1))
    sleep 2
    body="$(curl -sf --max-time 8 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true)"
    if [[ -n "$body" ]] && echo "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      break
    fi
    body=""
  done
  [[ -n "$body" ]] || fail "/health no respondió OK tras restart (¿workers/init_db aún arrancando? journalctl -u $SERVICE -n 50)"
  ok "Backend reiniciado; health=$body (intento $attempt)"

  # Recordatorio multi-worker
  local n
  n="$(pgrep -cf 'uvicorn app.main' || true)"
  echo "[INFO] procesos uvicorn (aprox): $n — unit debe usar --workers 2 (deploy/cdasoft-backend.service)"
}

if [[ "$FRONTEND_SWAP_ONLY" -eq 1 ]]; then
  swap_frontend
  exit 0
fi

restart_backend

if [[ "$BACKEND_ONLY" -eq 1 ]]; then
  exit 0
fi

if [[ -d "$FRONTEND_DIR/dist_new" ]]; then
  if [[ -f "$FRONTEND_DIR/dist_new/index.html" ]]; then
    swap_frontend
  else
    echo "[WARN] Existe dist_new pero sin index.html en raíz — no se hace swap"
    ls -la "$FRONTEND_DIR/dist_new" || true
  fi
else
  echo "[INFO] Sin dist_new — solo backend. Sube front con deploy.ps1 / rsync a dist_new/"
fi

ok "Deploy VPS terminado"
