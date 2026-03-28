# Comprobantes de Egreso - Tesorería

## Fecha de implementación
Diciembre 31, 2024

## Descripción
Se implementó un sistema completo para generar **comprobantes de egreso en PDF** cuando se registran salidas de dinero de la caja fuerte (tesorería).

## Características

### 1. Generación Automática de PDF
- **Formato profesional** con logo y colores de CDASOFT
- **Numeración única** para cada comprobante
- **Información completa**:
  - Número de comprobante
  - Fecha y hora del egreso
  - Beneficiario (pagado a)
  - Categoría del egreso
  - Concepto detallado
  - Método de pago
  - Monto total destacado en rojo
  - Desglose de efectivo (si aplica)
  - Firmas para autorización y recepción

### 2. Campo "Beneficiario" en Formulario
- **Nuevo campo obligatorio** para egresos
- Permite especificar quién recibe el dinero
- Se concatena automáticamente con el concepto: `Beneficiario - Concepto`

### 3. Descarga de Comprobantes
- **Botón en historial** para descargar PDF de cada egreso
- Nombre de archivo descriptivo: `Comprobante_Egreso_[NUMERO]_[FECHA].pdf`
- Descarga directa al hacer clic

## Archivos Modificados/Creados

### Backend

#### Nuevo archivo: `app/utils/comprobantes.py`
**Función principal:** `generar_comprobante_egreso()`
- Genera PDF usando ReportLab
- Incluye tablas, estilos y formato profesional
- Maneja desglose de efectivo si está disponible

#### Modificado: `app/api/v1/endpoints/tesoreria.py`
**Línea 5:** Agregado `from fastapi.responses import StreamingResponse`
**Línea 30:** Agregado `from app.utils.comprobantes import generar_comprobante_egreso`

**Líneas 57-68:** Validación mejorada - desglose obligatorio para efectivo
```python
if movimiento_data.metodo_pago == "efectivo":
    if not movimiento_data.desglose_efectivo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El desglose de efectivo es obligatorio para movimientos en efectivo"
        )
```

**Líneas 476-548:** Nuevo endpoint `/movimientos/{movimiento_id}/comprobante`
- Genera y retorna PDF del comprobante
- Solo funciona para egresos
- Incluye validaciones de existencia y tipo de movimiento

### Frontend

#### Modificado: `frontend/src/pages/Tesoreria.tsx`

**Línea 416:** Agregado campo `beneficiario` al estado del formulario

**Líneas 500-502:** Construcción automática del concepto completo
```typescript
const conceptoCompleto = tipoMovimiento === 'egreso' && formData.beneficiario
  ? `${formData.beneficiario} - ${formData.concepto}`
  : formData.concepto;
```

**Líneas 657-672:** Nuevo campo en formulario
```tsx
{tipoMovimiento === 'egreso' && (
  <div className="mb-6">
    <label className="block text-lg font-bold text-gray-900 mb-3">
      Beneficiario / Pagado a
    </label>
    <input
      type="text"
      value={formData.beneficiario}
      onChange={(e) => setFormData({ ...formData, beneficiario: e.target.value })}
      className="input-pos"
      placeholder="Nombre de la persona o entidad"
      minLength={3}
      required
    />
  </div>
)}
```

**Líneas 954-965:** Botón de descarga en historial
```tsx
{mov.tipo === 'egreso' && (
  <button
    onClick={() => {
      window.open(`${import.meta.env.VITE_API_URL}/api/v1/tesoreria/movimientos/${mov.id}/comprobante`, '_blank');
    }}
    className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 inline-flex items-center gap-1"
  >
    <Download className="w-3 h-3" />
    Comprobante
  </button>
)}
```

## Flujo de Uso

### Registrar Egreso
1. Ir a **Tesorería** → **Registrar Movimiento**
2. Seleccionar tipo: **EGRESO**
3. Llenar campos:
   - Categoría (ej: Nómina, Proveedores, etc.)
   - **Beneficiario** (ej: "Juan Pérez", "RUNT Colombia")
   - Concepto (ej: "Pago de salario quincenal")
   - Monto
   - Método de pago
4. Si es efectivo, llenar **desglose obligatorio**
5. Guardar

### Descargar Comprobante
1. Ir a **Tesorería** → **Historial**
2. Buscar el egreso deseado
3. Hacer clic en botón **"Comprobante"** (rojo)
4. El PDF se descarga automáticamente

## Validaciones Implementadas

### Backend
✅ Solo se generan comprobantes para **egresos** (no ingresos)
✅ Desglose de efectivo **obligatorio** para método "efectivo"
✅ Validación de existencia del movimiento
✅ Total del desglose debe coincidir con el monto declarado

### Frontend
✅ Campo beneficiario **obligatorio** para egresos (min 3 caracteres)
✅ Validación de monto > 0
✅ Concepto mínimo 5 caracteres
✅ Botón de comprobante **solo visible** en egresos

## Formato del PDF

### Encabezado
- Título: "COMPROBANTE DE EGRESO"
- Subtítulo: "CDASOFT"
- Número de comprobante
- Fecha y hora

### Cuerpo
- Pagado a (beneficiario)
- Categoría legible (ej: "Nómina y Salarios")
- Concepto completo
- Método de pago legible (ej: "Transferencia Bancaria")

### Desglose de Efectivo (si aplica)
Tabla con:
- Denominación (ej: $50.000)
- Cantidad (ej: × 2)
- Subtotal (ej: $100.000)

### Total
Banner rojo destacado con el monto total del egreso

### Firmas
- **Autorizado por:** Nombre del usuario que registró
- **Recibido por:** Beneficiario del egreso

### Pie
Fecha y hora de generación del documento

## Colores del Comprobante

Se usan los colores oficiales del logo:
- **Azul marino (#0a1d3d):** Encabezados y labels
- **Rojo (#dc2626):** Total del egreso (destacado)
- **Gris claro (#f5f5f5):** Fondos de celdas
- **Amarillo suave (#fffbeb):** Fondo del desglose de efectivo

## Ejemplo de Uso

### Egreso de Nómina
```
Beneficiario: María González
Concepto: Pago de salario quincenal - Diciembre 2024
Monto: $1.500.000
Método: Transferencia
```

### Egreso a Proveedor en Efectivo
```
Beneficiario: RUNT Colombia
Concepto: Renovación de licencia anual
Monto: $250.000
Método: Efectivo
Desglose:
  - 2 billetes de $100.000 = $200.000
  - 1 billete de $50.000 = $50.000
```

## Beneficios

1. ✅ **Trazabilidad**: Documento formal de cada egreso
2. ✅ **Auditoría**: Fácil revisión de salidas de dinero
3. ✅ **Legal**: Comprobante firmado para respaldo
4. ✅ **Profesional**: Formato imprimible y presentable
5. ✅ **Control**: Detalle exacto de billetes/monedas en efectivo
6. ✅ **Archivo**: PDFs descargables para conservar

## Notas Técnicas

- Los PDFs se generan en memoria (no se guardan en disco)
- Usa biblioteca `reportlab` (ya instalada en requirements.txt)
- Formato tamaño carta (letter)
- Encoding UTF-8 para caracteres especiales
- Compatible con todos los navegadores modernos

## Próximas Mejoras (Opcionales)

- [ ] Agregar logo de CDASOFT en el encabezado
- [ ] Comprobantes de ingreso (similar formato)
- [ ] Envío automático por email
- [ ] Almacenamiento en servidor de comprobantes
- [ ] Código QR con ID del movimiento
- [ ] Reporte mensual consolidado de egresos
