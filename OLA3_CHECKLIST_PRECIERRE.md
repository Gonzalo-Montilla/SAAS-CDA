# OLA 3 - Checklist de precierre

## Objetivo
Validar estabilidad operativa y experiencia de uso antes de cerrar la Ola 3.

## Alcance funcional
- Recepción: cálculo de tarifa, validaciones de año modelo y mensajes de operación.
- Caja: cierre, descarga de comprobante y estado posterior sin errores operativos.
- Reportes: filtros de fecha, exportaciones y estados vacíos.
- Usuarios: filtros, búsqueda y acciones principales sin regresión.
- Soporte tenant: creación de ticket, filtros y visualización de respuesta.

## Pruebas mínimas recomendadas
1. Recepción
   - Registrar vehículo con año válido y confirmar cálculo de tarifa.
   - Intentar año futuro y validar mensaje guía sin error en consola.
   - Simular ausencia de tarifa y validar llamada a acción para administrador.
2. Caja
   - Abrir y cerrar caja con flujo normal.
   - Verificar que comprobante de cierre se descarga y abre correctamente.
   - Confirmar que no aparecen errores bloqueantes por 404 esperados post-cierre.
3. Reportes
   - Cambiar entre modo día/rango y validar periodo aplicado en UI.
   - Probar rango inválido y validar bloqueo de exportación.
   - Exportar CSV con datos y sin datos (debe deshabilitarse cuando aplique).
4. Usuarios
   - Buscar por nombre/email con debounce y confirmar respuesta fluida.
   - Filtrar por rol/estado y limpiar filtros.
   - Crear, editar y cambiar contraseña de un usuario de prueba.
5. Soporte
   - Crear ticket y validar aparición inmediata en tabla.
   - Filtrar por estado/prioridad y por texto.
   - Ver contador de pendientes y timestamp de última actualización.

## Criterio de salida de Ola 3
- Build de frontend exitoso.
- Sin errores de lint en archivos modificados.
- Sin errores funcionales críticos (P0/P1) en flujo operativo diario.
- Flujo end-to-end estable en Recepción -> Caja -> Reportes.

## Notas de operación
- Mantener fuera de commit artefactos locales: `.venv`, `dist`, `uploads`.
- Registrar cualquier hallazgo residual como backlog de mejora continua.
