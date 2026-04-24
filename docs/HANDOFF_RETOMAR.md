# Handoff — retomar desarrollo (SaaS billing / ePayco + contexto)

Última actualización coherente con el push a `main` (facturación SaaS, ePayco, DSE, CI).

## Qué quedó implementado (recordatorio)

- **Cobro licencia tenant:** `POST /api/v1/tenant/billing/*` — planes, quote, `init-payment` (Apify smart checkout o redirect GET), webhook ePayco, `confirm-return` con parámetros de redirect, mock dev.
- **ePayco:** validación de `x_signature` (cadena documentada + SHA-256), aprobación por código y `x_response`, monto vs sesión, logs. Firma: `EPAYCO_CLIENT_ID` + `EPAYCO_P_KEY` en `.env`.
- **Confirm return:** con claves de firma en servidor, hace falta el paquete completo o en producción se devuelve 400; el front en `/suscripcion` reenvía query de ePayco y muestra “Sincronizando…”.
- **Carrera webhook + return:** `apply_successful_tenant_checkout` usa `SELECT … FOR UPDATE` en sesión y tenant; devuelve `bool`; si ya estaba pago, `db.commit()` del payload/último webhook.
- **Factus licencia (SaaS):** emisión y reintentos según `SAAS_BILLING_FACTUS_*` (ver `init_db` y `saas_factus_billing`).
- **CI:** `.github/workflows/backend-ci.yml` — pytest en `backend/tests/` con PostgreSQL de servicio; corre en push/PR que toquen `backend/`.
- **Tests:** `backend/tests/test_epayco.py` (firma, bundle, aprobación, monto). Hay también tests de caja.
- **`.env.example`:** bloque ePayco con URLs de referencia (webhook = `{BACKEND_PUBLIC_BASE_URL}/api/v1/tenant/billing/webhooks/epayco`).

## Al retomar — prioridades sugeridas

1. **Producción ePayco:** claves reales, `EPAYCO_TEST_MODE=False`, `https` en `BACKEND_PUBLIC_BASE_URL` y `FRONTEND_URL`, revalidar URL de confirmación en el panel.
2. **Probar** un pago de prueba con túnel (ngrok) al API si hace falta el webhook en local.
3. **Revisar** en GitHub **Actions** que el job *Backend CI* pase en el último commit.
4. (Opcional) Más pruebas de integración del endpoint de webhook; lint en CI; o mensajes de error más claros en UI.

## Rutas y archivos clave

| Tema            | Ruta |
|-----------------|------|
| Webhook ePayco  | `POST /api/v1/tenant/billing/webhooks/epayco` |
| Lógica ePayco   | `backend/app/integrations/epayco.py` |
| Billing API     | `backend/app/api/v1/endpoints/tenant_billing.py` |
| Aplicar pago    | `backend/app/services/tenant_billing_checkout.py` |
| UI suscripción  | `frontend/src/pages/Suscripcion.tsx` |
| API front       | `frontend/src/api/tenantBilling.ts` |
| Config          | `backend/app/core/config.py` (`EPAYCO_*`, `SAAS_BILLING_*`) |

## Comandos útiles (desde `backend/`)

```bash
# Tests con env mínimo (ajusta DATABASE_URL a tu instancia o usa la del .env)
set DATABASE_URL=postgresql://user:pass@localhost:5432/cdasoft
set SECRET_KEY=tu-secreto
python -m pytest tests/ -v
```

## Git

- Último commit orientativo: `feat: facturación SaaS (ePayco), retenciones DSE, CI pytest` (rama `main` en `origin`).

No guardar en repo credenciales reales: solo `.env` local (está en `.gitignore`).

## Estado actual (abr 2026) — listo para salida

- **Implementación técnica:** ~90-95% cerrada.
- **UI tenant (`/suscripcion`):** rediseñada con estilo corporativo (header con branding por tenant, tarjetas de planes premium, resumen financiero y CTA de pago junto al total).
- **Flujo de pago:** reforzado (firma, monto, aprobación estricta, idempotencia, retorno + webhook, logs).
- **Factus SaaS:** integración y UX listas; el pendiente principal es validación externa cuando el sandbox de Factus sale de cola DIAN.

### Pendiente de cierre (operativo, no de código)

1. Confirmar una emisión FE de licencia de extremo a extremo cuando Factus sandbox responda fuera de cola.
2. Ejecutar smoke test final de pago (tenant) y backoffice (retry de FE) en entorno objetivo.
3. Validar variables y URLs finales de producción antes del release.

## Checklist de salida a producción (resumen)

1. Configurar `.env` productivo (`EPAYCO_*`, `SAAS_BILLING_FACTUS_*`) y desactivar flags de prueba.
2. Verificar `BACKEND_PUBLIC_BASE_URL` y `FRONTEND_URL` reales (sin ngrok).
3. Revisar configuración en panel ePayco (confirmación/webhook y respuesta).
4. Correr pago E2E controlado y confirmar activación de plan sin duplicados.
5. Verificar rechazo correcto en casos inválidos (firma o monto).
6. Confirmar emisión FE final y revisar PDF/datos del emisor.
7. Dejar backoffice habilitado para contingencia de retry FE.
8. Correr smoke test de frontend tenant (`/suscripcion` completo).
9. Confirmar tests backend y CI en verde.
10. Desplegar con monitoreo intensivo 24-48h.

## Runbook operativo FE SaaS (PROMETHEUS -> CDA)

Este runbook aplica para errores de licencia FE en backoffice (`Facturación > Pagos en línea`) o en `/suscripcion`.

### 1) Identificar el caso

- Confirmar `session_id`, `tenant_slug` y `saas_fe_reference_code` (`saas-sub-...`).
- Revisar `saas_fe_error_category`:
  - `pending_dian`: cola/bloqueo DIAN.
  - `nit_dv`: inconsistencia NIT-DV.
  - `rut_name`: nombre no coincide con RUT.
  - `config`: variables/credenciales emisor.
  - `validation`: validación general Factus.

### 2) Consultar cola en Factus Sandbox (Postman)

1. Obtener token:
   - `POST https://api-sandbox.factus.com.co/oauth/token`
2. Consultar referencia:
   - `GET https://api-sandbox.factus.com.co/v1/bills?filter[reference_code]={reference_code}&page=1`
3. (Opcional) Ver cola completa:
   - `GET https://api-sandbox.factus.com.co/v1/bills?filter[status]=0&page=1`

### 3) Destrabar y reintentar

1. Borrar represada por referencia:
   - `DELETE https://api-sandbox.factus.com.co/v1/bills/destroy/reference/{reference_code}`
2. Verificar que quedó vacía:
   - `GET https://api-sandbox.factus.com.co/v1/bills?filter[reference_code]={reference_code}&page=1`
3. Reintentar FE:
   - Tenant: botón `Reintentar emisión FE` en `/suscripcion`.
   - Backoffice: acción `Reintentar FE` en tabla de checkout.

### 4) Verificación final

1. Confirmar `saas_fe_status = ok`.
2. Confirmar `numero_documento` y `cufe`.
3. Validar en Factus:
   - `GET https://api-sandbox.factus.com.co/v1/bills/show/{numero_documento}`
   - Revisar `customer.identification` y `customer.dv`.

## Verificación E2E de salida (ejecutada en código)

- Backend tests:
  - `python -m pytest -q` -> `12 passed`.
- Front typecheck:
  - `npx tsc -b` -> OK.

## Escenarios E2E manuales recomendados (sandbox)

1. **Emisión directa OK**  
   Pago aprobado -> FE `ok` sin intervención.
2. **Corrección fiscal**  
   Error `nit_dv` o `rut_name` -> ajustar datos tenant -> reintentar -> FE `ok`.
3. **Cola DIAN**  
   Error `pending_dian` -> borrar por `reference_code` -> reintentar -> FE `ok`.
