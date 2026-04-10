# Checklist de salida a producción — CDASOFT

Documento operativo para validar el despliegue antes de exponer el sistema a clientes reales. Márcalo en orden; si algo falla, no avances de fase hasta corregirlo.

**Referencias en el repo**

| Recurso | Ubicación |
|--------|-----------|
| Variables backend (detalle) | [`backend/GUIA_ENV_PRODUCCION.md`](backend/GUIA_ENV_PRODUCCION.md) |
| Auditoría histórica | [`AUDITORIA_PRE_PRODUCCION.md`](AUDITORIA_PRE_PRODUCCION.md) |
| Tareas programadas (cron) | [`RUNBOOK_AUTOMATION.md`](RUNBOOK_AUTOMATION.md) |
| Plantilla env backend | [`backend/.env.example`](backend/.env.example) |
| Plantilla env frontend | [`frontend/.env.example`](frontend/.env.example) |

---

## Fase 0 — Alcance y entorno

- [ ] Existe un entorno **staging** (o pre-prod) con la misma topología que producción: HTTPS, PostgreSQL, mismo modo de ejecutar API y front.
- [ ] Se definió la **URL pública del frontend** y la **URL pública del API** (pueden ser mismo dominio con proxy o subdominios distintos).
- [ ] Responsable y ventana de corte acordados (quién despliega, rollback, contacto).

---

## Fase 1 — Secretos e identidad (bloqueante)

- [ ] **`SECRET_KEY`**: generada con `secrets.token_urlsafe(64)` (u otro generador criptográfico), única por entorno, **nunca** la del ejemplo de desarrollo.
- [ ] **`DATABASE_URL`**: usuario dedicado (no `postgres`), contraseña fuerte; si la contraseña tiene caracteres especiales, está **codificada en la URL** según RFC 3986.
- [ ] **`SAAS_OWNER_EMAIL` / `SAAS_OWNER_PASSWORD`**: valores **fuertes en producción** (los valores por defecto del código son solo para desarrollo).
- [ ] Archivo **`.env` del backend** con permisos restrictivos en el servidor (p. ej. `chmod 600`) y **no** versionado en Git.
- [ ] Credenciales de **Factus** (y ambiente sandbox vs producción) revisadas por tenant; si usan cifrado dedicado, **`FACTUS_ENCRYPTION_KEY`** definida y respaldada de forma segura.

---

## Fase 2 — Backend (`.env` en el servidor)

- [ ] **`ENVIRONMENT=production`** y **`DEBUG=False`** (obligatorio).
- [ ] **`BACKEND_CORS_ORIGINS`**: lista **cerrada** de orígenes HTTPS del frontend (no `*` en producción). Formato admitido: lista separada por comas o JSON array (ver [`backend/app/core/config.py`](backend/app/core/config.py)).
- [ ] **`FRONTEND_URL`**: URL HTTPS que reciben los usuarios (enlaces en correos).
- [ ] **`BACKEND_PUBLIC_BASE_URL`**: URL base **pública** del API (onboarding, webhooks, enlaces que devuelve el backend).
- [ ] **SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`): probado envío real (recuperación de contraseña, códigos de onboarding, notificaciones).
- [ ] **`TURNSTILE_ENABLED`** y claves: acorde a la política deseada para el registro público de tenants.
- [ ] **`TENANT_LOGO_UPLOAD_DIR`**: ruta en disco **persistente** entre despliegues; el directorio existe y el proceso puede escribir.
- [ ] Revisión rápida del resto de variables según [`backend/.env.example`](backend/.env.example).

---

## Fase 3 — Frontend (build de producción)

- [ ] **`VITE_API_URL`** definida **en el momento del build** (`npm run build`), apuntando al API público con ruta `/api/v1`, p. ej. `https://api.tudominio.com/api/v1`. Sin esto, el bundle puede quedar apuntando a `127.0.0.1` (ver [`frontend/src/api/client.ts`](frontend/src/api/client.ts)).
- [ ] Opcional: **`VITE_API_TIMEOUT_MS`** ajustado si hay redes lentas o respuestas pesadas.
- [ ] Tras el build, verificación en los assets o en runtime (red del navegador) de que las peticiones van al host correcto.
- [ ] Front servido por **HTTPS** coherente con CORS y cookies/credenciales si aplica.

---

## Fase 4 — Base de datos y esquema

- [ ] PostgreSQL en versión compatible con la usada en desarrollo/staging.
- [ ] Primera subida: arranque del backend ejecuta **`init_db()`** (tablas + `ensure_*`). Confirmar en logs que no hay errores de migración.
- [ ] Si parten de una **BD existente** antigua: probar en copia antes el arranque y, si aplica, ejecutar manualmente scripts en [`backend/migrations/`](backend/migrations/) que no estén cubiertos por `ensure_*`.
- [ ] **Backup automático** configurado y **una restauración de prueba** documentada (fecha y resultado).

---

## Fase 5 — Infraestructura y red

- [ ] TLS válido (certificados) en front y API.
- [ ] Proxy reverso (Nginx, Caddy, etc.) con timeouts razonables para subidas y reportes.
- [ ] Firewall: solo puertos necesarios expuestos; PostgreSQL no público salvo requisito explícito.
- [ ] Endpoint **`GET /health`** accesible para monitoreo (sin datos sensibles).

---

## Fase 6 — Verificación post-deploy (smoke tests)

- [ ] Login de tenant y carga del dashboard.
- [ ] Flujo crítico de negocio acordado (p. ej. recepción, caja o tesorería según el CDA piloto).
- [ ] Backoffice SaaS (si lo usan) solo con credenciales de producción endurecidas.
- [ ] Envío de al menos **un correo** transaccional end-to-end.
- [ ] Si usan **Factus**: emisión o consulta en el ambiente acordado (sandbox o producción).
- [ ] **Documentación OpenAPI** (`/docs`): debe estar **desactivada** en producción salvo decisión explícita (`ENVIRONMENT` distinto de `development`).

---

## Fase 7 — Operación continua

- [ ] Cron (cada ~10 min) para [`RUNBOOK_AUTOMATION.md`](RUNBOOK_AUTOMATION.md): citas, encuestas, RTM, estados de tenant.
- [ ] Rotación de logs y espacio en disco para `uploads/` y logs de aplicación.
- [ ] Procedimiento de **rollback** (versión anterior del código + compatibilidad de esquema).
- [ ] Contacto para incidentes y acceso a logs (`journalctl`, Docker logs, o equivalente).

---

## Criterio de “listo para producción”

Se considera **listo** cuando todas las casillas **Fase 1–3 y 6** están marcadas sin excepción, y las fases **4, 5 y 7** están cubiertas según el nivel de riesgo aceptado por el negocio (mínimo: backup y cron si el producto depende de automatizaciones).

---

*Última actualización del documento: alineado con el repositorio CDASOFT (FastAPI + React/Vite). Ajusta dominios y nombres de servicio a tu proveedor (Hostinger, VPS, cloud, etc.).*
