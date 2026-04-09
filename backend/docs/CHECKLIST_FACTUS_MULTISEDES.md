# Checklist Factus — CDA con varias sedes / ciudades

Usar en **primer alta** o al **abrir una sede nueva** en otra ciudad. Marca cada ítem al completarlo.

---

## Parte A — CDASOFT (backoffice SaaS)

Abre el **tenant** del CDA → sección **Facturación electrónica (Factus)**.

| # | Tarea | Notas |
|---|--------|--------|
| A1 | Modo **Factus** activo (si el CDA debe emitir electrónico en caja) | Si queda en manual, en caja piden número DIAN a mano |
| A2 | Credenciales **sandbox** completas (client id, secret, usuario API, contraseña API) | Para pruebas sin afectar producción |
| A3 | Credenciales **producción** completas | Distintas a sandbox |
| A4 | **Ambiente activo** = *Sandbox* mientras prueban | Misma URL y credenciales que usarán al buscar rangos/municipios |
| A5 | **Probar conexión** con ambiente activo en sandbox | Debe responder OK |
| A6 | **Rango predeterminado (fallback)** guardado o acordado con el CDA | Se usa si una sede no tiene rango propio |
| A7 | **Consultar rangos** y anotar el `id` de «Factura de venta» (doc. 01) si ayudan al CDA | Opcional si cada sede llevará su propio rango |
| A8 | Avisar al administrador del CDA: completar **Organización → Sedes** en la app del tenant | Municipio + rango por ciudad lo hace el CDA |

Antes del **corte a producción**: ambiente activo → **Producción**, probar conexión de nuevo, confirmar que rangos/municipios buscados son en producción.

---

## Parte B — App del CDA (administrador del tenant)

**Organización** → pestaña **Sedes**.

| # | Tarea | Notas |
|---|--------|--------|
| B1 | **Datos de la matriz**: dirección + municipio (buscador Factus) → **Guardar datos matriz** | Respaldo y valor por defecto de la sede principal |
| B2 | **Sede principal**: dejar municipio/dirección **vacíos** si facturan como la matriz | Hereda matriz |
| B3 | Por **cada sede en otra ciudad**: **Editar** → municipio (buscar y elegir) + **id rango Factus** de esa ciudad/resolución | **Consultar rangos** usa el ambiente que dejó CDASOFT |
| B4 | Dirección en factura de la sede: solo si el establecimiento DIAN es distinto a matriz | Vacío = hereda |
| B5 | **Recepción**: dirección del cliente solo si deben llevarla en la factura del adquiriente | Opcional |
| B6 | **Caja**: cada usuario confirma **sede activa** antes de cobrar | La emisión usa municipio, rango y dirección de **esa** sede |
| B7 | Si Factus rechaza el cobro: copiar el **mensaje completo** y enviarlo a **CDASOFT** | No cambiar a manual sin indicación |

---

## Una página — orden recomendado

1. CDASOFT: A1 → A6 (sandbox) → A8  
2. CDA: B1 → B2 → B3 (por sede) → B6  
3. Pruebas de cobro en cada sede (sandbox)  
4. CDASOFT: ambiente **Producción** + A5 de nuevo  
5. CDA: revisar B3 si los ids de rango cambian entre ambientes  

---

## Referencia rápida

- **Municipio en BD**: guardar el **`id`** devuelto por Factus en `/v1/municipalities`, **no** el `code` (DIAN).  
- **Rango**: id numérico del rango de «Factura de venta»; puede ser **distinto por sede**.  
- Documentación interna ampliada: `FACTUS_INTERNOS.md` (misma carpeta).
