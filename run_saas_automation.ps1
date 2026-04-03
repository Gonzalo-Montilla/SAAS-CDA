# Runner de automatizaciones SaaS para entornos Windows.
# Uso:
#   .\run_saas_automation.ps1
#   $env:APPOINTMENTS_LIMIT=300; $env:QUALITY_LIMIT=150; .\run_saas_automation.ps1

param(
    [int]$AppointmentsLimit = 200,
    [int]$QualityLimit = 100
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectRoot "backend"
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "saas_automation.log"

if (!(Test-Path $BackendDir)) {
    Write-Error "No existe directorio backend en: $BackendDir"
}

if (!(Test-Path $LogDir)) {
    New-Item -Path $LogDir -ItemType Directory | Out-Null
}

if ($env:APPOINTMENTS_LIMIT) { $AppointmentsLimit = [int]$env:APPOINTMENTS_LIMIT }
if ($env:QUALITY_LIMIT) { $QualityLimit = [int]$env:QUALITY_LIMIT }

$pythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (!(Test-Path $pythonExe)) {
    $pythonExe = "python"
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
Add-Content -Path $LogFile -Value "======================================================"
Add-Content -Path $LogFile -Value "[RUN] $timestamp"

Push-Location $BackendDir
try {
    $output = & $pythonExe "scripts/run_saas_automation.py" "--appointments-limit" "$AppointmentsLimit" "--quality-limit" "$QualityLimit" 2>&1
    $output | Add-Content -Path $LogFile
    Write-Host "[OK] Automatización ejecutada. Revisa: $LogFile"
}
finally {
    Pop-Location
}

