# SARLAFT - Pruebas de integración OpenSanctions

Guía rápida para probar integración en ambiente local/staging sin exponer credenciales.

## 1) Variables de entorno

Agregar en `.env` del backend:

```env
OPENSANCTIONS_ENABLED=true
OPENSANCTIONS_API_KEY=REEMPLAZAR_CON_TU_API_KEY
OPENSANCTIONS_BASE_URL=https://api.opensanctions.org
OPENSANCTIONS_TIMEOUT_SECONDS=20
OPENSANCTIONS_MATCH_DATASET=default
OPENSANCTIONS_MATCH_ALGORITHM=best
OPENSANCTIONS_MATCH_LIMIT=5
OPENSANCTIONS_ALERT_SCORE_THRESHOLD=0.75
```

Notas:
- Nunca subir la API key al repositorio.
- Si no hay `OPENSANCTIONS_API_KEY`, el endpoint responde error controlado.

## 2) Endpoint de prueba (tenant)

Ruta:

- `POST /api/v1/sarlaft/screening/opensanctions`

Autenticación:

- JWT de tenant (roles: `administrador`, `contador`, `recepcionista`).
- El tenant debe tener `sarlaft_enabled=true`.

Payload ejemplo (persona):

```json
{
  "schema": "Person",
  "full_name": "Juan Perez",
  "document_number": "12345678",
  "birth_date": "1980-01-01",
  "nationality": "Colombia",
  "dataset": "default",
  "algorithm": "best",
  "limit": 5
}
```

Respuesta esperada (resumen):

```json
{
  "provider": "opensanctions",
  "dataset": "default",
  "algorithm": "best",
  "threshold": 0.75,
  "hits": [],
  "alert": false,
  "raw_count": 0
}
```

## 3) cURL de prueba

```bash
curl -X POST "http://localhost:8000/api/v1/sarlaft/screening/opensanctions" \
  -H "Authorization: Bearer TU_TOKEN_TENANT" \
  -H "Content-Type: application/json" \
  -d '{
    "schema":"Person",
    "full_name":"Juan Perez",
    "document_number":"12345678",
    "birth_date":"1980-01-01",
    "nationality":"Colombia",
    "dataset":"default",
    "algorithm":"best",
    "limit":5
  }'
```

## 4) Qué se registra en auditoría SARLAFT

Cada screening deja evento `opensanctions_screening` en `sarlaft_audit_logs` con:
- dataset y algoritmo,
- nombre consultado,
- umbral aplicado,
- cantidad de hits,
- bandera `alert`.

