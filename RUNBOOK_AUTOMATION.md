# Runbook de Automatización SaaS

Este runbook deja operativas las tareas automáticas críticas:

- Cambio de estado de tenants demo/pago vencido.
- Recordatorios de citas (Agendamiento).
- Envío de encuestas pendientes (Calidad).
- Recordatorios de próxima RTM.

## Scripts incluidos

- Linux / servidor: `run_saas_automation.sh`
- Windows (local): `run_saas_automation.ps1`
- Runner Python: `backend/scripts/run_saas_automation.py`

## Ejecución manual

### Linux

```bash
./run_saas_automation.sh
```

Variables opcionales:

```bash
APPOINTMENTS_LIMIT=300 QUALITY_LIMIT=150 RTM_LIMIT=150 ./run_saas_automation.sh
```

### Windows PowerShell

```powershell
.\run_saas_automation.ps1
```

Variables opcionales:

```powershell
$env:APPOINTMENTS_LIMIT=300
$env:QUALITY_LIMIT=150
$env:RTM_LIMIT=150
.\run_saas_automation.ps1
```

## Programación recomendada

### Cron (Linux)

Ejecutar cada 10 minutos:

```bash
*/10 * * * * cd /var/www/cdasoft && /bin/bash ./run_saas_automation.sh
```

## Logs

Se escribe en:

- `logs/saas_automation.log`

Ver últimos eventos:

```bash
tail -n 100 logs/saas_automation.log
```

## Verificación rápida

1. Crear una cita con email.
2. Verificar correo de confirmación.
3. Esperar ventana de recordatorio o ejecutar script.
4. Confirmar que llega un solo recordatorio.

