# SARLAFT - Motor inter-CDA (Roadmap de escala)

Estado: vigente (post-sprint).

## Objetivo

Operar una señal interna **inter-CDA** que detecte actividad inusual entre tenants de forma anonimizada (`doc_hash` + métricas agregadas), sin exposición de identidad en UI operativa.

## Implementación actual (cerrado)

- Señal inter-CDA activada en cobro con hash de documento (`SHA-256`) y `pepper` opcional.
- Evaluación por ventanas configurables (`30/90/365`).
- Criterios mínimos configurables:
  - tenants distintos,
  - operaciones totales,
  - ratio de efectivo.
- Persistencia técnica:
  - tabla `sarlaft_intercda_signals`,
  - índices por `tenant_id/created_at` y `doc_hash/window_days`.
- Control de ruido:
  - cooldown de alertas por tenant/hash/ventana.
- Trazabilidad:
  - evento de auditoría `intercda_signal_generated`.
- Privacidad:
  - no se guarda documento en claro en la señal inter-CDA.
- Procesamiento asíncrono base:
  - cola `sarlaft_intercda_jobs`,
  - encolado en cobro (`intercda_signal_enqueued`),
  - procesamiento por `scripts/run_saas_automation.py` (`--intercda-limit`),
  - endpoint manual SARLAFT `POST /sarlaft/intercda/process-pending`.

## Roadmap técnico-operativo de escala permanente

### Fase 1 (inmediata)

- Mantener regla activa y tunear umbrales por operación real.
- Validar `SARLAFT_INTERCDA_DOC_HASH_PEPPER` definido en producción.
- Revisar semanalmente distribución de señales por ventana y severidad.

### Fase 2 (1-2 sprints)

- Agregados rolling materializados por tenant y por ventana:
  - `rolling_30d`,
  - `rolling_90d`,
  - `rolling_365d`.
- Job asíncrono cada 15 min para refresco incremental de agregados.
- Métricas de salud del motor:
  - `signals_generated_total`,
  - `signals_deduplicated_total`,
  - `signals_processing_latency_ms`,
  - `signals_by_level`.

### Fase 3 (escala masiva)

- Particionado temporal mensual de `sarlaft_intercda_signals`.
- Retención técnica por política (p. ej. 24 meses online + archivo frío).
- Cola asíncrona dedicada para evaluación en picos de cobro.
- SLO operativo:
  - P95 de evaluación < 500 ms por cobro.

## Índices/particionado recomendados

- Índices actuales (ya aplicados):
  - `idx_sarlaft_intercda_tenant_created`,
  - `idx_sarlaft_intercda_doc_hash_window`.
- Próximo paso:
  - partición por rango de `created_at` (mensual),
  - índice local por partición (`doc_hash`, `window_days`, `created_at DESC`).

## Observabilidad mínima (runbook)

- Verificar volumen diario:
  - conteo de `intercda_signal_generated` en `sarlaft_audit_logs`.
- Verificar deduplicación efectiva:
  - señales por `doc_hash/window_days` dentro de cooldown.
- Verificar calidad:
  - proporción `media` vs `critica` y tendencia semanal.

## Riesgos y mitigación

- **Riesgo:** falsos positivos por umbrales agresivos.  
  **Mitigación:** calibración progresiva por ventana y tenant.
- **Riesgo:** latencia en horas pico.  
  **Mitigación:** mover evaluación a cola asíncrona en Fase 3.
- **Riesgo:** exposición accidental de PII.  
  **Mitigación:** política estricta de no persistir documento en claro fuera de caso SARLAFT.

