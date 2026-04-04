# Visual System Rollout - SAAS-CDA

## Objetivo
Aplicar un sistema visual premium, coherente y mantenible para modo tenant CDA, backoffice SaaS y superficies publicas, sin afectar logica de negocio.

## Estado base implementado
- Tokens visuales base y capas UI unificadas.
- Shell de aplicacion alineado entre tenant y backoffice.
- Componentes canonicos base listos (`input`, `btn-primary-solid`, `btn-success-solid`, `table-base`, `card-pos`, `section-card`).
- Superficies publicas alineadas al mismo lenguaje visual.

## Fase 1 - Quick wins (completada)
- Archivos:
  - `frontend/tailwind.config.js`
  - `frontend/src/index.css`
  - `frontend/src/components/Layout.tsx`
  - `frontend/src/pages/Dashboard.tsx`
  - `frontend/src/pages/SaaSBackoffice.tsx`
  - `frontend/src/pages/Login.tsx`
  - `frontend/src/pages/ResetPassword.tsx`
  - `frontend/src/pages/AgendarPublico.tsx`
  - `frontend/src/pages/CalidadEncuesta.tsx`
  - `frontend/src/pages/Reportes.tsx`
  - `frontend/src/pages/Usuarios.tsx`

## Fase 2 - Migracion controlada por modulo
1. **Operacion diaria (prioridad alta)**
   - `frontend/src/pages/Caja.tsx`
   - `frontend/src/pages/Recepcion.tsx`
2. **Administracion tenant**
   - `frontend/src/pages/Tesoreria.tsx`
   - `frontend/src/pages/Tarifas.tsx`
   - `frontend/src/pages/Soporte.tsx`
3. **Experiencia comercial**
   - `frontend/src/pages/Calidad.tsx`
   - `frontend/src/pages/Agendamiento.tsx`

## Reglas de migracion
- Reemplazar clases directas repetidas por clases canonicas (`input`, `btn-*`, `table-base`).
- Preferir escala `slate` para neutros en textos/fondos/bordes.
- Evitar nuevos estilos inline salvo branding dinamico tenant.
- Mantener compatibilidad con clases legacy hasta finalizar migracion completa.

## Riesgos y mitigacion
- **Riesgo:** regresion visual en flujos criticos.
  - **Mitigacion:** migrar por modulo y validar flujo end-to-end por modulo.
- **Riesgo:** mezcla de estilos nuevos y legacy.
  - **Mitigacion:** checklist de reemplazo por archivo antes de merge.
- **Riesgo:** responsive de tablas extensas.
  - **Mitigacion:** usar wrappers `overflow-x-auto` + `table-base`/`table-enterprise`.

## Checklist por modulo
- Header + spacing usan shell unificado.
- Formularios usan `input`/`input-corporate`.
- CTA principal usa `btn-primary-solid` o `btn-corporate-primary`.
- CTA secundario usa `btn-corporate-muted`.
- Tablas usan `table-base` o `table-enterprise` con criterio consistente.
- Estados/feedback usan paleta semantica (`success`, `warning`, `danger`, `info`).

## Validacion tecnica recomendada
- `npm run build`
- Smoke test manual:
  - login tenant
  - login saas/backoffice
  - dashboard tenant
  - caja (apertura/cobro/cierre)
  - reportes
  - usuarios
  - agendamiento publico
