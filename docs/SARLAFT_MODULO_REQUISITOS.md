# CDASOFT - Requisitos Módulo SARLAFT (CDA)

Base funcional y técnica para iniciar desarrollo sin improvisación.

## 1) Objetivo

Implementar SARLAFT en CDASOFT para:
- gestionar riesgo LA/FT/FP;
- operar por tenant en modo `manual` o `api`;
- mantener trazabilidad auditable;
- preparar reportes para presentación en UIAF/SIREL.

## 2) Alcance (MVP + Evolutivo)

### MVP
- Captura de datos SARLAFT en recepción.
- Motor de reglas internas (score y semáforo).
- Bandeja de alertas con workflow y evidencias.
- Bitácora inalterable de eventos.
- Exportables legales base (CSV/Excel + borrador técnico).
- Registro de envío UIAF (código, fecha, responsable, soporte).

### Evolutivo
- Integración con proveedor externo de listas (`api mode`).
- ROS estructurado dentro del sistema.
- Umbrales avanzados por sede/tenant.
- Tableros analíticos con tendencias.

## 3) Modos de operación

Configuración por tenant desde Backoffice:
- `sarlaft_enabled: bool`
- `sarlaft_mode: manual | api`
- `sarlaft_api_provider: string|null`
- `sarlaft_api_trigger_mode: all | risk_only | on_demand`
- `sarlaft_monthly_budget: number|null`
- `sarlaft_api_fallback_to_manual: bool`

Regla comercial:
- `manual` incluido en plan base.
- `api` como add-on con trazabilidad de consumo.

## 4) Flujo operativo end-to-end

1. **Recepción:** captura de actor principal (cliente), propietario, pagador, vehículo y contexto de operación.
2. **Evaluación automática:** motor interno calcula score y nivel (`verde`, `amarillo`, `rojo`).
3. **Screening externo (si aplica):** en modo `api`, según trigger configurado.
4. **Resultado operativo:**
   - `verde`: continúa el trámite.
   - `amarillo`: genera alerta para revisión.
   - `rojo`: bloqueo/escala según política del tenant.
5. **Gestión de alertas:** analista/oficial revisa, adjunta evidencia, justifica decisión.
6. **Escalamiento:** casos relevantes marcan potencial ROS.
7. **Cierre mensual:** consolidación, exportes, envío UIAF fuera del sistema (SIREL), y registro de comprobante en CDASOFT.

## 5) Roles y permisos

- `recepcionista/cajero`
  - Puede capturar información y ver estado operativo.
  - No ve detalle sensible de coincidencias/listas.
- `analista_sarlaft`
  - Revisa alertas, adjunta evidencias, propone cierre.
- `oficial_cumplimiento`
  - Decide cierre, escalamiento ROS, y aprobación de reportes.
- `admin_tenant`
  - Configura umbrales y parámetros internos, no cierra ROS críticos si política lo restringe.
- `saas_owner/backoffice`
  - Configura modo (`manual/api`) y proveedor para tenant.

## 6) Pantallas requeridas

- `SARLAFT Dashboard`
  - KPI: operaciones evaluadas, alertas pendientes, % efectivo, casos escalados.
  - Widgets: semáforo de riesgo y tendencia mensual.
- `Bandeja de Alertas`
  - Filtros por fecha, sede, estado, nivel y tipo de alerta.
  - Acciones: tomar, comentar, solicitar soporte, cerrar, escalar.
- `Detalle de Caso`
  - Datos de operación + trazas + documentos + historial de decisiones.
- `Reportes y UIAF`
  - Generación de archivos por periodo.
  - Registro de envío: fecha, usuario, radicado/código UIAF, archivo soporte.
- `Configuración SARLAFT (Tenant)`
  - Umbrales, reglas activas, parámetros de scoring, modo manual/api.
- `Backoffice SaaS > Perfil tenant`
  - Switch SARLAFT y modo de operación (manual/api), similar a Facturación electrónica.

## 7) Reglas mínimas del motor interno

- Pago en efectivo sobre umbral configurable.
- Fraccionamiento por cliente/documento/placa en ventana temporal.
- Inconsistencia entre quien paga, propietario y quien presenta vehículo.
- Coincidencia aproximada con listas internas/manuales.
- Reincidencia de alertas abiertas.

Salida del motor:
- `risk_score` (0-100),
- `risk_level` (`verde|amarillo|rojo`),
- `triggered_rules[]`.

## 8) Estados del workflow

### Alerta
`new -> in_review -> pending_info -> closed_no_match | closed_with_monitoring | escalated`

### Caso SARLAFT
`open -> analysis -> committee_review (opcional) -> reportable | closed`

### Registro UIAF
`draft -> ready -> submitted -> accepted | rejected | corrected`

Regla clave de auditoría:
- no se elimina alerta/caso; solo transición de estado con usuario, fecha y justificación.

## 9) Datos mínimos a capturar

Cliente/persona:
- tipo y número de identificación, nombres, apellidos,
- fecha nacimiento (si aplica), teléfono, correo, dirección, ciudad/municipio.

Relación con operación:
- rol (`cliente|propietario|pagador|apoderado`),
- declaración de origen de fondos (sí/no, soporte).

Operación:
- sede, fecha/hora, valor total, medio de pago, valor en efectivo,
- placa, tipo de trámite, usuario que atendió.

Consentimientos y legal:
- evidencia de habeas data,
- aceptación de tratamiento para cumplimiento SARLAFT.

## 10) Modelo de datos inicial (propuesto)

Tablas:
- `sarlaft_profiles` (config por tenant y umbrales),
- `sarlaft_cases`,
- `sarlaft_case_parties`,
- `sarlaft_alerts`,
- `sarlaft_rule_events`,
- `sarlaft_screenings` (manual o api),
- `sarlaft_documents`,
- `sarlaft_uiAF_submissions` (registro envío y respuesta),
- `sarlaft_audit_log` (bitácora inmutable).

Campos clave transversales:
- `tenant_id`, `sede_id`, `created_at`, `updated_at`, `created_by`, `updated_by`,
- `status`, `risk_level`, `risk_score`,
- `metadata_json` para detalles técnicos no estructurados.

## 11) Integración con proveedor externo (fase API)

Requisitos técnicos:
- proveedor configurable por tenant,
- timeout/reintentos controlados,
- normalización de respuesta a esquema interno,
- almacenamiento de request/response resumido + hash,
- manejo de caída: pasar a modo manual asistido.

## 12) Reportería y evidencia UIAF

El sistema debe:
- generar insumos del periodo (operaciones en efectivo, alertas escaladas, ROS preparados);
- permitir descarga de archivo legal/técnico;
- registrar radicado/código de envío UIAF, fecha, responsable y adjunto;
- dejar trazabilidad completa para auditoría.

## 13) Seguridad y cumplimiento

- Control por rol/permisos y segregación de funciones.
- Cifrado en tránsito y controles de acceso por tenant.
- Logs con sello temporal y eventos críticos no borrables.
- Historial de cambios de configuración SARLAFT.

## 14) Plan de implementación por sprints

### Sprint 1 - Fundaciones (1-2 semanas)
- Modelo de datos base.
- Configuración tenant/backoffice (enabled + modo).
- Captura mínima en recepción.
- Bitácora de auditoría.

### Sprint 2 - Motor y workflow (1-2 semanas)
- Reglas internas + score + niveles.
- Bandeja de alertas y detalle de caso.
- Estados, transiciones y justificaciones obligatorias.

### Sprint 3 - Reportería y cierre operativo (1 semana)
- Dashboard SARLAFT.
- Exportes base por periodo.
- Registro de envío UIAF con comprobante.

### Sprint 4 - Modo API (1-2 semanas)
- Integración proveedor configurable.
- Trigger por política (all/risk_only/on_demand).
- Métricas de consumo y fallback a manual.

## 15) Criterios de aceptación iniciales

- Tenant en `manual` opera sin dependencias externas.
- Toda alerta tiene trazabilidad completa de creación a cierre.
- No existe borrado físico de alertas/casos por UI.
- Oficial puede registrar envío UIAF con código y soporte.
- Backoffice puede cambiar modo `manual/api` por tenant.

