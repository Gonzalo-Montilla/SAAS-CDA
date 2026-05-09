# CDASOFT - SARLAFT Backlog Técnico (Sprint 1)

Documento operativo para ejecutar Sprint 1 sin ambigüedad.

## 1) Objetivo del sprint

Entregar la base funcional y técnica de SARLAFT en CDASOFT:
- habilitación por tenant;
- modo de operación (`manual` / `api`) a nivel de configuración;
- modelo de datos mínimo;
- captura SARLAFT en recepción;
- bitácora auditable.

## 2) Alcance cerrado (Definition of Done del sprint)

Al finalizar Sprint 1 debe existir:
- configuración SARLAFT editable desde backoffice SaaS;
- tablas SARLAFT base creadas y operativas;
- endpoints backend para crear caso SARLAFT desde recepción;
- UI mínima en frontend para captura y consulta básica del caso;
- registro de auditoría por cada evento crítico;
- pruebas mínimas de contrato API y flujo feliz.

Fuera de alcance Sprint 1:
- motor de scoring completo;
- bandeja avanzada de alertas;
- exportes UIAF;
- integración con proveedor externo.

## 3) Historias de usuario (priorizadas)

### HU-01 - Activación por tenant
**Como** dueño SaaS  
**Quiero** activar/desactivar SARLAFT por tenant y elegir modo `manual|api`  
**Para** controlar despliegue y modelo comercial.

**Criterios de aceptación**
- Desde backoffice se visualiza estado SARLAFT por tenant.
- Se puede cambiar `enabled` y `mode`.
- Cambio queda trazado en audit log.
- Si está deshabilitado, endpoints SARLAFT tenant devuelven 403.

### HU-02 - Configuración SARLAFT tenant
**Como** admin tenant/oficial  
**Quiero** parametrizar umbral base y comportamiento de fallback  
**Para** operar según política interna.

**Criterios de aceptación**
- Perfil SARLAFT por tenant persistido en BD.
- Valores mínimos: `cash_threshold_cop`, `api_trigger_mode`, `api_fallback_to_manual`.
- Validaciones backend (rangos, enums).

### HU-03 - Crear caso SARLAFT en recepción
**Como** recepcionista  
**Quiero** registrar datos SARLAFT mínimos durante atención  
**Para** dejar trazabilidad de cumplimiento.

**Criterios de aceptación**
- Se crea caso asociado a trámite/operación.
- Se guardan partes relacionadas (cliente, propietario, pagador).
- Se registra snapshot de operación (medio pago, valor, sede, usuario).
- Se crea evento audit log.

### HU-04 - Consulta básica de caso
**Como** oficial/analista  
**Quiero** consultar detalle básico del caso  
**Para** validar integridad de captura.

**Criterios de aceptación**
- Endpoint de detalle retorna caso + parties + metadata.
- Frontend muestra vista básica legible.
- Permisos por rol aplicados.

## 4) Backend - tareas técnicas

## 4.1 Modelo de datos (SQLAlchemy)
Crear modelos en `backend/app/models/`:
- `sarlaft_profile.py`
- `sarlaft_case.py`
- `sarlaft_case_party.py`
- `sarlaft_audit_log.py`

Campos mínimos sugeridos:
- `sarlaft_profiles`:
  - `id`, `tenant_id` (unique), `enabled`, `mode`,
  - `cash_threshold_cop`, `api_trigger_mode`,
  - `api_provider`, `api_fallback_to_manual`,
  - `created_at`, `updated_at`.
- `sarlaft_cases`:
  - `id`, `tenant_id`, `sede_id`,
  - `operacion_ref`, `status`,
  - `risk_level`, `risk_score`,
  - `transaction_amount_cop`, `cash_amount_cop`, `payment_method`,
  - `created_by_user_id`, `created_at`, `updated_at`.
- `sarlaft_case_parties`:
  - `id`, `case_id`, `tenant_id`,
  - `role` (`cliente|propietario|pagador|apoderado`),
  - `doc_type`, `doc_number`, `full_name`,
  - `phone`, `email`, `city`, `address`,
  - `metadata_json`, `created_at`.
- `sarlaft_audit_logs`:
  - `id`, `tenant_id`, `actor_user_id`,
  - `entity_type`, `entity_id`, `action`,
  - `before_json`, `after_json`, `created_at`.

## 4.2 Migración / inicialización BD
Actualizar `backend/app/db/database.py` para:
- crear tablas SARLAFT si no existen;
- índices:
  - `idx_sarlaft_cases_tenant_created`,
  - `idx_sarlaft_parties_doc`,
  - `idx_sarlaft_audit_entity`.

## 4.3 Schemas Pydantic
Crear en `backend/app/schemas/`:
- `sarlaft.py` con:
  - `SarlaftProfileResponse`
  - `SarlaftProfilePatch`
  - `SarlaftCaseCreate`
  - `SarlaftCaseResponse`
  - `SarlaftCasePartyInput`

## 4.4 Dependencias y seguridad
En `backend/app/core/deps.py`:
- `require_sarlaft_enabled_for_tenant`
- `require_sarlaft_role(min_role=...)` (si aplica RBAC existente)

## 4.5 Endpoints API
Crear `backend/app/api/v1/endpoints/sarlaft.py`:
- `GET /sarlaft/profile`
- `PATCH /sarlaft/profile`
- `POST /sarlaft/cases`
- `GET /sarlaft/cases/{case_id}`

Backoffice SaaS (`saas_auth.py`):
- exponer en tenant summary:
  - `sarlaft_enabled`
  - `sarlaft_mode`

## 4.6 Registro audit log
Implementar helper reusable:
- `backend/app/services/audit.py` (si no existe)
- método `log_sarlaft_event(...)`

Eventos mínimos:
- profile_updated
- case_created
- case_read (opcional)
- access_denied_sarlaft

## 5) Frontend - tareas técnicas

## 5.1 Tipos y APIs
Actualizar:
- `frontend/src/types/index.ts`
- `frontend/src/api/saasTenant.ts`
- crear `frontend/src/api/sarlaft.ts`

## 5.2 Backoffice SaaS (perfil tenant)
En `frontend/src/pages/SaaSBackoffice.tsx`:
- agregar switch `sarlaft_enabled`
- selector `sarlaft_mode` (`manual` / `api`)
- guardar vía patch tenant core data

## 5.3 App tenant (módulo base)
Agregar ruta protegida:
- `frontend/src/App.tsx` -> `/sarlaft`

Crear página inicial:
- `frontend/src/pages/Sarlaft.tsx`
  - formulario captura básica para crear caso;
  - sección de consulta por id (MVP).

## 5.4 UX de acceso restringido
Reusar `AccessRestrictedModal` para:
- SARLAFT deshabilitado por tenant;
- mensaje profesional y homogéneo.

## 6) Contratos API (MVP)

### POST `/sarlaft/cases` (request)
- `operacion_ref: string`
- `sede_id: number | null`
- `transaction_amount_cop: number`
- `cash_amount_cop: number`
- `payment_method: "efectivo" | "mixto" | "transferencia" | "otro"`
- `parties: SarlaftCasePartyInput[]`

### POST `/sarlaft/cases` (response)
- `id`
- `status: "open"`
- `risk_level: "verde"` (temporal en Sprint 1)
- `risk_score: 0` (temporal)
- `created_at`

## 7) Validaciones funcionales mínimas

- `cash_amount_cop <= transaction_amount_cop`
- Al menos una party con rol `cliente`
- `doc_number` obligatorio para cada party
- 403 cuando SARLAFT deshabilitado
- 422 en payload inválido

## 8) Plan de pruebas (Sprint 1)

Backend:
- test unitario de validadores schema.
- test integración: crear caso exitoso.
- test integración: SARLAFT deshabilitado -> 403.

Frontend:
- flujo crear caso con datos válidos.
- manejo visual de error 403/422.
- persistencia de switches en backoffice tenant.

Smoke:
- crear caso desde tenant habilitado.
- consultar detalle y verificar audit log.

## 9) Secuencia de implementación recomendada

1. Migraciones y modelos.
2. Schemas + endpoints profile.
3. Endpoint crear/detalle caso.
4. Audit log.
5. Cambios backoffice (switch + mode).
6. Página SARLAFT tenant MVP.
7. Pruebas y ajustes.

## 10) Checklist de salida Sprint 1

- [ ] Tablas SARLAFT en producción/local.
- [ ] Tenant configurable con `sarlaft_enabled` y `sarlaft_mode`.
- [ ] Endpoint `POST /sarlaft/cases` operativo.
- [ ] Endpoint `GET /sarlaft/cases/{id}` operativo.
- [ ] Audit log registrando eventos clave.
- [ ] UI mínima de captura publicada.
- [ ] Pruebas mínimas pasando.

## 11) Riesgos y mitigaciones

- **Riesgo:** diferencias normativas por tipo de CDA.  
  **Mitigación:** parametrizar umbrales/reglas por tenant.
- **Riesgo:** sobrecarga de captura en recepción.  
  **Mitigación:** formulario corto en MVP y completitud progresiva.
- **Riesgo:** deriva de alcance en sprint inicial.  
  **Mitigación:** congelar alcance a fundaciones + gating estricto.

