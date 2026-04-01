# OLA 2 - Checklist Final de Aceptacion

Este checklist valida los cambios de Ola 2 sin afectar la operacion actual.

## 1) Caja - Cierre y pendientes

- [ ] Abrir caja con usuario `cajero`.
- [ ] Registrar al menos 1 vehiculo en `recepcion` (estado `registrado`).
- [ ] Ir a `caja > cierre` y confirmar que NO permita cerrar con pendientes.
- [ ] Cobrar los pendientes.
- [ ] Cerrar caja y validar descarga de comprobante PDF.
- [ ] Confirmar que el nombre del PDF use fecha local (sin corrimiento por timezone).

Resultado esperado:
- El cierre se bloquea mientras existan pendientes del tenant.
- Al cerrar correctamente, el comprobante se descarga sin error.

---

## 2) Caja - Cambio de metodo de pago con ownership

- [ ] Cobrar un vehiculo con usuario `cajero A`.
- [ ] Intentar cambiar metodo con `cajero B`.
- [ ] Confirmar que la API responda `403`.
- [ ] Repetir con usuario `administrador`.
- [ ] Confirmar que el cambio SI se permita.

Resultado esperado:
- Solo el cajero propietario de la caja (o admin) puede cambiar metodo de pago.

---

## 3) Caja - Pago mixto robusto

- [ ] Cobrar con `metodo_pago = mixto`.
- [ ] Enviar desglose con 1 solo metodo > 0.
- [ ] Confirmar rechazo.
- [ ] Enviar desglose con suma diferente al total.
- [ ] Confirmar rechazo.
- [ ] Enviar desglose valido (2 o mas metodos, suma exacta).
- [ ] Confirmar cobro exitoso.

Resultado esperado:
- La API valida metodos permitidos, montos, y suma exacta.

---

## 4) Usuarios - Politica de contrasena unificada

- [ ] Crear usuario tenant con contrasena debil (`123456`).
- [ ] Confirmar rechazo con mensaje de politica.
- [ ] Crear con contrasena fuerte (`Aa123456!!`).
- [ ] Confirmar creacion exitosa.
- [ ] Probar cambio de contrasena (modal de `usuarios`) con clave debil.
- [ ] Confirmar rechazo frontend/backend.

Resultado esperado:
- Politica robusta en create/change/reset/register.
- Regla comun: minimo 10, mayuscula, minuscula, numero y simbolo.

---

## 5) Auditoria - Acciones sensibles de usuarios

- [ ] Activar/desactivar usuario en modulo `usuarios`.
- [ ] Revisar `auditoria` y confirmar evento `update_user` con metadata de estado anterior/nuevo.

Resultado esperado:
- Toggle de estado queda auditado con usuario afectado y trazabilidad.

---

## 6) Reportes - Rango de fechas y consistencia temporal

- [ ] Entrar a `reportes`.
- [ ] Modo `rango`: poner `fecha_inicio > fecha_fin`.
- [ ] Confirmar aviso visual y que no dispare queries invalidas.
- [ ] Poner rango valido y exportar CSV.
- [ ] Validar nombre de archivo con formato `desde_a_hasta`.

Resultado esperado:
- Rango invalido bloqueado.
- Export coherente con periodo seleccionado.

---

## 7) Reportes - Acceso por rol contador

- [ ] Iniciar sesion con rol `contador`.
- [ ] Acceder a `/reportes` (permitido).
- [ ] Intentar `/tarifas`, `/tesoreria`, `/usuarios` (redirige a `/dashboard`).

Resultado esperado:
- `contador` solo accede a reportes (segun reglas actuales de frontend/backend).

---

## 8) Resumen mensual - Promedios por dias reales

- [ ] Consultar `resumen-mensual` para febrero (28 o 29 dias) y un mes de 31 dias.
- [ ] Confirmar que `promedio_diario_* = total / dias_del_mes`.

Resultado esperado:
- Ya no se usa divisor fijo 30.

---

## 9) Smoke tecnico rapido

Backend:
- [ ] `python -m py_compile app/api/v1/endpoints/cajas.py app/api/v1/endpoints/vehiculos.py app/api/v1/endpoints/reportes.py app/api/v1/endpoints/usuarios.py app/api/v1/endpoints/auth.py app/core/security.py`

Frontend:
- [ ] `npm run build`

Resultado esperado:
- Compilacion/build sin errores.

---

## Criterio de cierre de Ola 2

Se considera cerrada cuando:
- [ ] Todos los checks anteriores estan en OK.
- [ ] No hay regresiones visibles en `recepcion`, `caja`, `reportes`, `usuarios`.
- [ ] Las acciones sensibles dejan evidencia en auditoria.
