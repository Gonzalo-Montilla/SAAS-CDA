# Script de Deployment a Producción - CDASOFT
# Ejecutar desde la raíz del repo: .\deploy.ps1
#
# Flujo:
#   1) Build frontend con VITE_API_URL canónico
#   2) Checks anti-localhost / URL canónica
#   3) Instrucciones SSH: git pull + restart backend (o scripts/deploy_on_vps.sh)
#   4) Subir CONTENIDO de dist a dist_new vacío (nunca scp -r dist → evita dist/dist)
#   5) En VPS: verificar dist_new/index.html → swap atómico

$ErrorActionPreference = "Stop"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT A PRODUCCION - CDASOFT" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$SERVER = if ($env:CDASOFT_SSH) { $env:CDASOFT_SSH } else { "root@31.97.144.9" }
$REMOTE_REPO = "/var/www/cdasoft/repo"
$VITE_API = "https://cdasoft.com.co/api/v1"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

function Fail([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

# --- Confirmacion ---
Write-Host "Este script:" -ForegroundColor Yellow
Write-Host "  1. Compila frontend con $VITE_API"
Write-Host "  2. Valida el build (sin localhost / URL canonica)"
Write-Host "  3. Te da comandos SSH seguros (pull + deploy_on_vps.sh)"
Write-Host "  4. Sube dist a dist_new (contenido, no carpeta anidada)"
Write-Host ""
$confirm = Read-Host "Continuar? (s/n)"
if ($confirm -ne "s") {
    Write-Host "Cancelado." -ForegroundColor Yellow
    exit 0
}

# --- Git limpio (recomendado) ---
$porcelain = (git status --porcelain 2>$null)
if ($porcelain) {
    Write-Host "ADVERTENCIA: working tree local no esta limpio:" -ForegroundColor Yellow
    git status --short
    $go = Read-Host "Continuar igual? (s/n)"
    if ($go -ne "s") { exit 0 }
}

# --- Build frontend ---
Write-Host ""
Write-Host "Build frontend..." -ForegroundColor Cyan
Push-Location frontend
$env:VITE_API_URL = $VITE_API
npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Fail "npm run build fallo"
}
Pop-Location

$indexPath = Join-Path $RepoRoot "frontend\dist\index.html"
if (-not (Test-Path $indexPath)) {
    Fail "No existe frontend/dist/index.html tras el build"
}
Write-Host "OK: frontend/dist/index.html" -ForegroundColor Green

# --- Checks de assets ---
Write-Host ""
Write-Host "Verificando assets del build..." -ForegroundColor Cyan
$assetsDir = Join-Path $RepoRoot "frontend\dist\assets"
if (-not (Test-Path $assetsDir)) {
    Fail "No existe frontend/dist/assets"
}

$assetFiles = Get-ChildItem -Path $assetsDir -File -Recurse -ErrorAction SilentlyContinue
$joined = ""
foreach ($f in $assetFiles) {
    if ($f.Length -lt 8MB) {
        $joined += [System.IO.File]::ReadAllText($f.FullName)
    }
}

if ($joined -match "localhost:8000|127\.0\.0\.1:8000|http://127\.0\.0\.1") {
    Fail "Build apunta a localhost — no despliegues"
}
if ($joined -match "https://www\.cdasoft\.com/api/v1") {
    Fail "Build con URL no canonica (www.cdasoft.com)"
}
if ($joined -notmatch [regex]::Escape($VITE_API)) {
    Fail "Build no contiene $VITE_API"
}
Write-Host "OK: URL canonica y sin localhost" -ForegroundColor Green

# --- Backend en VPS ---
Write-Host ""
Write-Host "=== PASO A: Backend en VPS (SSH) ===" -ForegroundColor Yellow
Write-Host @"
ssh $SERVER
cd $REMOTE_REPO
git status --porcelain
# Si hay cambios locales: NO hagas pull a ciegas (ver DEPLOY_VPS.md §15.3)
git pull --ff-only origin main
chmod +x scripts/deploy_on_vps.sh
./scripts/deploy_on_vps.sh
# O solo backend sin swap de front:
# ./scripts/deploy_on_vps.sh --backend-only
"@ -ForegroundColor White

Read-Host "Presiona Enter cuando el backend en VPS este actualizado y healthy..."

# --- Frontend: preparar dist_new ---
Write-Host ""
Write-Host "=== PASO B: Subir frontend a dist_new ===" -ForegroundColor Yellow
Write-Host @"
En el VPS, deja dist_new VACIA (importante: evita dist/dist):

ssh $SERVER
cd $REMOTE_REPO/frontend
rm -rf dist_new
mkdir -p dist_new
"@ -ForegroundColor White

Read-Host "Presiona Enter cuando dist_new este vacia en el VPS..."

Write-Host ""
Write-Host "Subiendo CONTENIDO de dist (asterisco / trailing slash)..." -ForegroundColor Cyan
Write-Host "Comando SCP (PowerShell / OpenSSH):" -ForegroundColor White
Write-Host "  scp -r .\frontend\dist\* ${SERVER}:${REMOTE_REPO}/frontend/dist_new/" -ForegroundColor Cyan
Write-Host ""
Write-Host "Comando rsync (Git Bash / WSL) — preferido:" -ForegroundColor White
Write-Host "  rsync -avz --delete ./frontend/dist/ ${SERVER}:${REMOTE_REPO}/frontend/dist_new/" -ForegroundColor Cyan
Write-Host ""
Write-Host "NUNCA uses: scp -r frontend/dist  (sin /*) — crea dist_new/dist/ y el sitio da 404" -ForegroundColor Red
Write-Host ""

$upload = Read-Host "Ya subiste el contenido a dist_new? (s/n)"
if ($upload -ne "s") {
    Write-Host "Quedo a medias: backend puede estar OK; front no swapado." -ForegroundColor Yellow
    exit 0
}

# --- Swap ---
Write-Host ""
Write-Host "=== PASO C: Verificar index.html y swap atomico ===" -ForegroundColor Yellow
Write-Host @"
ssh $SERVER
cd $REMOTE_REPO/frontend

# FAIL-FAST: index.html debe estar en la RAIZ de dist_new
test -f dist_new/index.html || { echo 'FALLO: falta dist_new/index.html (¿subiste dist anidado?)'; ls -la dist_new; exit 1; }
test ! -f dist_new/dist/index.html || { echo 'FALLO: existe dist_new/dist/ (anidado)'; exit 1; }

# Swap
./../scripts/deploy_on_vps.sh --frontend-swap-only
# O manual:
# TS=`$(date +%F-%H%M)
# sudo mv dist "dist.prev-`$TS"
# sudo mv dist_new dist
# sudo chown -R www-data:www-data dist
# sudo nginx -t && sudo systemctl reload nginx
"@ -ForegroundColor White

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Post-check: https://cdasoft.com.co  y /health" -ForegroundColor Cyan
Write-Host "  Ver DEPLOY_VPS.md §15" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
