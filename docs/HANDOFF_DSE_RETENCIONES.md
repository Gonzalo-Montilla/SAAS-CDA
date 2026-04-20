# Handoff — Retenciones DSE / documento soporte (sesión reciente)

Contexto para retomar sin perder el hilo. Última actualización: alineado con el commit que incluye estos cambios.

## Objetivo de negocio

- **Fase 1 (hecha):** Por tenant, elegir qué conceptos aplican (compras, servicios, arrendamiento, honorarios). Por proveedor en catálogo, concepto por defecto coherente con el entorno. Persistido en BD + API + UI (Factus / proveedores). Sin motor numérico completo ni envío de retención a Factus aún.
- **Fase 2 (en curso):** Motor con UVT, bases mínimas tipo tabla DIAN, tasas por año; vista previa; luego acoplar a egresos y/o payload Factus cuando la contadora defina reglas finas.

## Qué quedó implementado (técnico)

### Backend

- `app/core/dse_retencion_conceptos.py` — conceptos, normalización, validación vs flags `TenantFactusSettings`.
- Modelo `TenantFactusSettings`: `dse_retencion_usar_*` (4 booleans).
- Modelo `ProveedorCatalogo`: `concepto_retencion_dse`.
- `PATCH /factus/settings/documento-soporte-entorno-retenciones` — no desactivar concepto si hay proveedores con ese concepto.
- CRUD proveedores valida concepto contra entorno.
- `documentos_soporte_electronicos.concepto_retencion_dse` — instantánea al emitir DSE si el egreso lleva `proveedor_catalogo_id`.
- Tablas motor: `dse_uvt_por_anio`, `dse_retencion_tasas` (UVT año + % por concepto).
- `GET/PUT /dse-retencion/parametros/{anio}` (solo admin).
- `POST /dse-retencion/preview` — cálculo sugerido (admin o contador).
- `app/core/dse_retencion_umbral_uvt.py` — umbrales UVT por concepto (10/2/10/0 compras/servicios/arrendamiento/honorarios); **revisar con contadora** frente a tabla DIAN completa (subtipos, declarante, etc.).
- `app/services/dse_retencion_motor_calculo.py` — base mínima en pesos, retención = monto × tasa si aplica.
- Reportes detalle: campo `documento_soporte_concepto_retencion`.

### Frontend

- `api/factus.ts`, `api/proveedoresCatalogo.ts`, `api/dseRetencion.ts`.
- Página **Catálogo de proveedores**: entorno (4 checks), parámetros motor (UVT + tasas), formato de cifras al cargar, placeholders claros, acordeones **colapsados por defecto** con preferencia en `localStorage`, vista previa motor.
- **Reportes**: muestra retención catálogo en trazabilidad cuando aplica.

### Referencia DIAN

- La **tabla general** (UVT, bases mínimas, % por fila) es más rica que el modelo actual (un % por concepto agregado). Pendiente alinear umbrales/subtipos cuando la contadora responda.

## Próximos pasos sugeridos

1. Validar con contadora: umbrales UVT por subconcepto, declarante/no declarante, ReteIVA, etc.
2. Opcional: persistir `retencion_calculada_cop` en DSE o en movimiento al emitir.
3. Integrar preview o cálculo en flujo caja/tesorería y, cuando toque, campos Factus.

## Rutas API útiles

- `PATCH /factus/settings/documento-soporte-entorno-retenciones`
- `GET|PUT /dse-retencion/parametros/{anio}`
- `POST /dse-retencion/preview`
