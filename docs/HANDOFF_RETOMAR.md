# Handoff — retomar desarrollo (SaaS billing / Wompi + Factus)

Última actualización: migración **big-bang** de pasarela a Wompi como proveedor único para nuevos pagos.

## Qué quedó implementado (recordatorio)

- **Cobro licencia tenant:** `POST /api/v1/tenant/billing/*` mantiene planes, quote, `init-payment`, `confirm-return`, `complete-mock` y FE SaaS.
- **Pasarela activa:** Wompi Checkout Web (redirect), con firma de integridad SHA-256 generada en backend.
- **Webhook activo:** `POST /api/v1/tenant/billing/webhooks/wompi` (JSON), validación de firma/checksum con `WOMPI_EVENTS_SECRET`.
- **Confirm return:** ahora usa `transaction_id` (`id` en query de Wompi) y consulta `GET /v1/transactions/{id}` contra API Wompi.
- **Idempotencia de negocio:** se conserva `apply_successful_tenant_checkout` con `SELECT ... FOR UPDATE` (sin doble aplicación).
- **Trazabilidad PSP neutral:** sesiones guardan `payment_provider` y `payment_ref`; `epayco_ref` queda solo para histórico.
- **Factus licencia (SaaS):** emisión/reintento intactos (`SAAS_BILLING_FACTUS_*`), incluyendo categorías de error FE.
- **Tests pasarela:** `backend/tests/test_wompi.py` cubre firma checkout, checksum eventos y aprobación.
- **`.env.example`:** reemplazado bloque `EPAYCO_*` por `WOMPI_*` y `PAYMENT_DEV_MOCK_ENABLE`.

## Rutas y archivos clave

| Tema | Ruta |
|------|------|
| Webhook Wompi | `POST /api/v1/tenant/billing/webhooks/wompi` |
| Integración Wompi | `backend/app/integrations/wompi.py` |
| Billing API | `backend/app/api/v1/endpoints/tenant_billing.py` |
| Aplicar pago | `backend/app/services/tenant_billing_checkout.py` |
| Backoffice sesiones PSP | `backend/app/api/v1/endpoints/saas_auth.py` |
| UI suscripción | `frontend/src/pages/Suscripcion.tsx` |
| API front | `frontend/src/api/tenantBilling.ts` |
| Tipos front | `frontend/src/types/index.ts` |
| Config | `backend/app/core/config.py` (`WOMPI_*`, `SAAS_BILLING_*`) |

## Variables críticas de entorno

- `WOMPI_PUBLIC_KEY`
- `WOMPI_INTEGRITY_SECRET`
- `WOMPI_EVENTS_SECRET`
- `WOMPI_USE_SANDBOX`
- `WOMPI_SANDBOX_BASE_URL`
- `WOMPI_PRODUCTION_BASE_URL`
- `PAYMENT_DEV_MOCK_ENABLE` (solo no productivo)
- `SAAS_BILLING_FACTUS_*`

## Checklist de salida a producción (big-bang)

1. Configurar `.env` productivo (`WOMPI_*`, `SAAS_BILLING_FACTUS_*`) y desactivar mock.
2. Verificar `BACKEND_PUBLIC_BASE_URL` y `FRONTEND_URL` reales (HTTPS, sin túneles de prueba).
3. Configurar en Wompi la URL de eventos: `{BACKEND_PUBLIC_BASE_URL}/api/v1/tenant/billing/webhooks/wompi`.
4. Ejecutar pago E2E controlado en producción y validar:
   - sesión pasa `pending -> paid`,
   - `payment_provider = wompi`,
   - `payment_ref` informado,
   - sin duplicados por carrera return/webhook.
5. Confirmar emisión FE de licencia (`saas_fe_status=ok`, `numero_documento`, `cufe`).
6. Validar backoffice (`Facturación`) con filtros y export CSV de referencia PSP.
7. Monitorear 24-48h sesiones `pending`, errores webhook y FE.

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
  - `python -m pytest -q` -> validar suite completa.
- Front typecheck:
  - `npx tsc -b` -> validar build de tipos.

## Escenarios E2E manuales recomendados (sandbox)

1. **Emisión directa OK**  
   Pago aprobado -> FE `ok` sin intervención.
2. **Corrección fiscal**  
   Error `nit_dv` o `rut_name` -> ajustar datos tenant -> reintentar -> FE `ok`.
3. **Cola DIAN**  
   Error `pending_dian` -> borrar por `reference_code` -> reintentar -> FE `ok`.
