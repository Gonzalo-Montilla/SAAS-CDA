# Multitenant Local Test (Fase 1 + Fase 2-A + Fase 3)

Este checklist valida que el aislamiento por tenant esta funcionando en backend.

## 1) Aplicar migraciones

Desde `backend/`:

```bash
python apply_tenant_baseline_migration.py
python apply_tenant_scope_domain_migration.py
```

## 2) Levantar backend

```bash
python run.py
```

## 3) Crear segundo tenant en BD (manual rapido)

Ejemplo SQL:

```sql
INSERT INTO tenants (id, nombre, slug, activo, created_at)
VALUES ('00000000-0000-0000-0000-000000000002', 'Tenant Demo B', 'demo-b', true, NOW())
ON CONFLICT (slug) DO NOTHING;
```

## 4) Crear un usuario admin para tenant B

Desde Swagger o endpoint de usuarios:
- loguear admin actual
- crear usuario con email distinto

Luego en BD asignar tenant B:

```sql
UPDATE usuarios
SET tenant_id = '00000000-0000-0000-0000-000000000002'
WHERE email = 'adminb@cdasoft.com';
```

## 5) Verificaciones clave

1. Login con admin tenant A y listar:
   - `GET /api/v1/usuarios`
   - `GET /api/v1/vehiculos`
   - `GET /api/v1/tarifas/vigentes`
   - `GET /api/v1/cajas/historial`

2. Login con admin tenant B y repetir los mismos endpoints.

3. Confirmar que cada tenant solo ve sus datos.

4. Intentar acceder con tenant B a un `vehiculo_id` de tenant A:
   - Debe responder `404` o `401` segun endpoint.

5. Verificar que nuevos registros quedan con `tenant_id` correcto:

```sql
SELECT tenant_id, count(*) FROM vehiculos_proceso GROUP BY tenant_id;
SELECT tenant_id, count(*) FROM cajas GROUP BY tenant_id;
SELECT tenant_id, count(*) FROM movimientos_tesoreria GROUP BY tenant_id;
```

## 6) Criterio de salida fase 2-A

- Ningun endpoint critico devuelve datos de otro tenant.
- No hay filas nuevas con `tenant_id IS NULL` en tablas core.
- Login/refresh mantiene claim `tenant_id` y validacion en backend.

## 7) Validacion Fase 3 (Auth global SaaS + RBAC global)

Aplicar migracion desde `backend/`:

```bash
python apply_saas_global_auth_migration.py
```

Luego iniciar backend:

```bash
python run.py
```

Pruebas sugeridas:

1. Login global SaaS (owner por defecto desde `.env`):
   - `POST /api/v1/saas/auth/login` con `username=owner@cdasoft.com` y `password=owner123` (o tu valor en `.env`).

2. Con token global, validar identidad:
   - `GET /api/v1/saas/auth/me`

3. Revisar permisos RBAC global:
   - `GET /api/v1/saas/auth/permissions/me`

4. Crear usuario global (solo owner):
   - `POST /api/v1/saas/auth/users`
   - Ejemplo rol: `finanzas`, `comercial` o `soporte`.

5. Validar restriccion RBAC:
   - Login con usuario `finanzas` y probar `GET /api/v1/saas/auth/users`.
   - Debe fallar con `403` (solo `owner`/`soporte`).

6. Invalidar sesiones globales:
   - `POST /api/v1/saas/auth/logout-all`.
   - Intentar usar un refresh token anterior y verificar `401`.

## 8) Seguridad onboarding (rate limiting)

Aplicar migración desde `backend/`:

```bash
python apply_onboarding_rate_limit_migration.py
```

Pruebas sugeridas:

1. Ejecutar varios registros consecutivos contra `POST /api/v1/onboarding/register-tenant` con la misma IP.
2. Al superar el límite configurado, la API debe responder `429`.
3. Repetir con el mismo `correo_electronico` para validar límite por correo.
4. Verificar en BD:

```sql
SELECT ip_address, admin_email, successful, failure_reason, created_at
FROM onboarding_registration_attempts
ORDER BY created_at DESC
LIMIT 20;
```

## 9) Onboarding CDA con campos obligatorios y logo

Campos mínimos requeridos en `POST /api/v1/onboarding/register-tenant`:

- `nombre_cda`
- `nit_cda`
- `correo_electronico`
- `nombre_representante_legal_o_administrador`
- `celular`
- `admin_password`
- `logo_url` o `logo_file`

Ejemplo con `multipart/form-data`:

```bash
curl -X POST "http://localhost:8000/api/v1/onboarding/register-tenant" \
  -F "nombre_cda=CDA Demo Nuevo" \
  -F "nit_cda=901234567-8" \
  -F "correo_electronico=admin.demo@correo.com" \
  -F "nombre_representante_legal_o_administrador=Maria Perez" \
  -F "celular=3001234567" \
  -F "admin_password=admin123" \
  -F "codigo_verificacion_email=123456" \
  -F "logo_file=@/ruta/logo.png"
```

Enviar código de verificación:

```bash
curl -X POST "http://localhost:8000/api/v1/onboarding/send-email-code" \
  -H "Content-Type: application/json" \
  -d '{"correo_electronico":"admin.demo@correo.com","nombre_cda":"CDA Demo Nuevo"}'
```
