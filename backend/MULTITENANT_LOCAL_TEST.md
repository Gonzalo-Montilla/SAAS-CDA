# Multitenant Local Test (Fase 1 + Fase 2-A)

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
