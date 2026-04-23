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
