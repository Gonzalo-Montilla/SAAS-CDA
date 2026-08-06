# Restore PostgreSQL CDASOFT (prueba segura)

**Nunca** restaures un dump encima de producción a ciegas. Primero valida en una base temporal.

## Prerrequisitos

- Dump generado por [`backup_postgres_cdasoft.sh`](../backup_postgres_cdasoft.sh), p. ej. `/var/backups/cdasoft/cdasoft_YYYYMMDD_HHMMSSZ.sql.gz`
- Cliente `psql` / rol con permiso `CREATEDB` (o usuario postgres)
- Espacio en disco suficiente

## 1. Restaurar a base temporal (smoke test)

En el VPS:

```bash
DUMP=/var/backups/cdasoft/cdasoft_YYYYMMDD_HHMMSSZ.sql.gz   # ajusta nombre
TMPDB=cdasoft_restore_test

# Crear DB vacía (como postgres o superuser)
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${TMPDB};"
sudo -u postgres psql -c "CREATE DATABASE ${TMPDB} OWNER cda_user;"   # ajusta OWNER al rol real

# Restaurar
gunzip -c "$DUMP" | sudo -u postgres psql -d "$TMPDB"

# Smoke: listar tablas clave
sudo -u postgres psql -d "$TMPDB" -c "\dt" | head -40
sudo -u postgres psql -d "$TMPDB" -c "SELECT COUNT(*) AS tenants FROM tenants;"
sudo -u postgres psql -d "$TMPDB" -c "SELECT COUNT(*) AS vehiculos FROM vehiculos_proceso;"
```

Si los `COUNT` tienen sentido y `\dt` muestra el esquema esperado, el backup es **restaurable**.

```bash
# Limpiar la DB de prueba
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${TMPDB};"
```

Haz este ejercicio **al menos una vez** tras activar el cron de backup.

## 2. Restore de emergencia a producción (solo incidente)

1. Pon la API en mantenimiento / detén tráfico: `sudo systemctl stop cdasoft-backend`
2. Toma un dump “último momento” por si el restore empeora: ejecuta `backup_postgres_cdasoft.sh`
3. Restaura sobre la DB de prod **solo** con el dump elegido (mismo procedimiento que arriba, pero `psql -d cdasoft_prod` o el nombre real de `DATABASE_URL`)
4. `sudo systemctl start cdasoft-backend` y `curl -s http://127.0.0.1:8010/health`

Coordina con dueños de CDA: habrá downtime.

## 3. Archivos fuera de PostgreSQL

El dump SQL **no** incluye:

- `backend/private_uploads/documentos`
- `backend/uploads/tenant-logos`

Programa un tar periódico (ver `DEPLOY_VPS.md` § backup) y guárdalo junto a los `.sql.gz` (idealmente fuera del VPS).

## 4. Cron recomendado

```cron
15 3 * * * /var/www/cdasoft/repo/backup_postgres_cdasoft.sh >> /var/www/cdasoft/repo/logs/pg_backup_cron.log 2>&1
```

Retención: el script borra `cdasoft_*.sql.gz` con más de `RETENTION_DAYS` (default 14). Override: `RETENTION_DAYS=30 /var/www/cdasoft/repo/backup_postgres_cdasoft.sh`
