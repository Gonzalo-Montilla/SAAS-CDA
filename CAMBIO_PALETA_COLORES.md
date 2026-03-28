# Cambio de Paleta de Colores - CDASOFT

## Fecha de implementación
Diciembre 2024

## Contexto
El proyecto CDASOFT estaba usando colores del proyecto anterior CDA Piendamó (cyan/sky blue). Se realizó un cambio completo de la paleta de colores para que coincida con los colores oficiales del logo de CDASOFT.

## Análisis del Logo
**Archivo:** `frontend/src/assets/LOGO CDA_LA_FLORIDA.png`

**Colores identificados:**
- **Azul marino oscuro:** #0a1d3d (color principal del logo)
- **Amarillo dorado:** #f59e0b (color secundario del logo)

## Nueva Paleta de Colores

### Primary (Azul Marino)
```javascript
primary: {
  50: '#f0f4f8',
  100: '#d9e2ec',
  200: '#bcccdc',
  300: '#9fb3c8',
  400: '#829ab1',
  500: '#0a1d3d',  // Color del logo
  600: '#081628',
  700: '#061019',
  800: '#040b12',
  900: '#02070c',
}
```

### Secondary (Amarillo Dorado)
```javascript
secondary: {
  50: '#fffbeb',
  100: '#fef3c7',
  200: '#fde68a',
  300: '#fcd34d',
  400: '#fbbf24',
  500: '#f59e0b',  // Color del logo
  600: '#d97706',
  700: '#b45309',
  800: '#92400e',
  900: '#78350f',
}
```

## Archivos Modificados

### 1. Configuración Base
- **`frontend/tailwind.config.js`**
  - Reemplazó completamente la paleta de colores anterior
  - Agregó primary (azul marino) y secondary (amarillo dorado)

### 2. Componentes Actualizados

#### Tarifas.tsx
**Líneas modificadas:** 142, 215, 221, 253, 776, 784
- Botón "Nueva Tarifa": green-600 → secondary-500
- Valores en tabla (positive): green-600 → secondary-600
- Botones de edición: blue-600 → primary-600
- Hover states actualizados

#### Reportes.tsx
**Líneas modificadas:** 523, 609
- Botones "Exportar a CSV": green-600 → secondary-500

#### Tesorería.tsx
**Líneas modificadas:** 49-50, 157, 267-269
- Botón "Registrar Movimiento": blue-600 → secondary-500
- Cards de saldo: blue → primary
- Displays de efectivo: green → secondary

#### Caja.tsx (Mayor cantidad de cambios)
**Líneas modificadas:** 194, 237, 251, 425, 433-437, 711-713, 885, 908-927, 1647, 1697-1706, 2408-2420, 2489, 2509-2510
- Header: teal → primary
- Botón "Venta SOAT": teal-600 → secondary-500
- Totales y gradientes: green → secondary
- Cards de resumen: blue → primary
- Modales de venta SOAT: teal → primary/secondary
- Botones de selección de vehículo: teal → primary
- Botones de método de pago: teal → primary
- Card "COMISIÓN A COBRAR": green → secondary

#### Usuarios.tsx
**Líneas modificadas:** 263
- Botón "Crear Usuario": blue-600 → secondary-500
- Hover: blue-700 → secondary-600

#### CapturaFotos.tsx
**Líneas modificadas:** 207, 216
- Botón "Agregar Fotos": green-600 → secondary-500
- Botón "Cámara Web": blue-600 → primary-600

## Criterios de Aplicación

### Colores que SE CAMBIARON:
1. **Verde (green-600)** → **Secondary (amarillo dorado)**
   - Botones de acción principales
   - Displays de montos positivos
   - Cards de comisiones

2. **Cyan/Sky Blue** → **Primary (azul marino)**
   - Elementos estructurales
   - Headers
   - Navegación

3. **Teal (verde-azulado)** → **Primary o Secondary** (según contexto)
   - Botones de selección → Primary
   - Displays de dinero → Secondary

### Colores que NO SE CAMBIARON:
1. **Verde para éxito** (green-500/600 en alertas)
   - Mantiene su significado de sistema
   
2. **Rojo para errores** (red-500/600)
   - Mantiene su significado de sistema
   
3. **Amarillo para advertencias** (yellow-500/600)
   - Mantiene su significado de sistema

4. **Botones de sistemas externos**
   - RUNT (azul específico)
   - INDRA (morado)
   - SICOV (verde específico)

## Mejoras Adicionales Implementadas

### Módulo de Tarifas
1. **Bug fix crítico:** Frontend enviaba 'vehiculo' pero backend esperaba 'carro' para tipo de vehículo en comisiones SOAT
   - **Línea 920:** `tipo: tipoVehiculo === 'Motocicleta' ? 'moto' : 'carro'`

2. **Selector de años mejorado:**
   - Ahora muestra año actual + 3 años futuros automáticamente
   - **Líneas 129-136:** `[0, 1, 2, 3].map(offset => new Date().getFullYear() + offset)`
   - Permite crear tarifas anticipadas para 2027, 2028, etc.

3. **Auditoria:** Se intentó agregar pero se removió por errores de importación
   - Funcionalidad existente preservada

## Verificación

### Para ver los cambios:
```bash
# En frontend
npm run dev

# En el navegador
Ctrl + Shift + R (hard refresh)
```

### Testing recomendado:
1. ✅ Verificar todos los botones usan la nueva paleta
2. ✅ Confirmar que gradientes se ven correctamente
3. ✅ Probar estados hover de todos los botones
4. ✅ Verificar que colores de sistema (success/error) se mantienen
5. ✅ Comprobar módulo de Tarifas con años futuros
6. ✅ Verificar venta SOAT funciona correctamente (fix 'carro' vs 'vehiculo')

## Documentación Adicional Creada

1. **`frontend/GUIA_COLORES.md`**
   - Guía completa de uso de colores
   - Ejemplos prácticos
   - Buenas prácticas

2. **`MEJORAS_TARIFAS.md`**
   - Mejoras en el módulo de tarifas
   - Selector de años dinámico
   - Fix de bug de comisiones

## Estado Final
✅ **COMPLETADO** - Todos los componentes principales han sido actualizados con la nueva paleta de colores basada en el logo oficial de CDASOFT.

## Notas para Futuro Desarrollo
- Al crear nuevos componentes, usar `primary-*` para azul marino y `secondary-*` para amarillo dorado
- Mantener colores de sistema (green/red/yellow) solo para alertas y estados
- Consultar `frontend/GUIA_COLORES.md` para ejemplos específicos
- El selector de años en Tarifas se actualiza automáticamente cada año
