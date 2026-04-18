# Documento soporte electrónico (Factus + CDASOFT)

Referencia para cerrar el flujo con éxito: enlaces oficiales, qué hace nuestro backend y checklist operativo.

---

## 1. Documentación Factus (oficial)

Abrir en el navegador (la estructura del sitio puede cambiar; buscar «documentos soporte» si alguna URL deja de responder):

| Tema | URL (developers.factus.com.co) |
|------|--------------------------------|
| Introducción | `/documentos-soporte/introduccion/` |
| Crear y validar (POST validate) | `/documentos-soporte/crear-validar/` |
| Ver documento | `/documentos-soporte/ver/` |
| Descargar PDF | `/documentos-soporte/descargar-documento-soporte/` |
| Tablas de referencia (tipos doc., municipios, etc.) | `/tablas-de-referencia/tablas/` |

**Endpoints API** (mismo prefijo en sandbox y producción, cambia solo el host):

- `POST /v1/support-documents/validate` — crear y validar el documento soporte (equivale al flujo «crear y validar» de la doc).
- `GET /v1/support-documents/show/:number` — consultar por número / identificador devuelto tras validar.
- `GET /v1/support-documents/download-pdf/:number` — PDF (JSON con base64 o binario según versión).

**Autenticación:** `Authorization: Bearer {access_token}` (mismo OAuth2 que facturas).

Hosts típicos:

- Sandbox: `https://api-sandbox.factus.com.co`
- Producción: según cuenta (p. ej. `https://api.factus.com.co` — confirmar en panel Factus).

---

## 2. Qué implementa CDASOFT

| Pieza | Ubicación |
|-------|-----------|
| Construcción del payload y emisión | `app/integrations/factus_support_emit.py` |
| Cliente HTTP `validate`, `show`, `download-pdf` | `app/integrations/factus_client.py` |
| Endpoint REST emitir / PDF / enlace | `app/api/v1/endpoints/factus.py` |
| Validación contacto proveedor + reglas DV | `app/utils/egreso_proveedor_dian.py`, `app/utils/factus_validators.py` |
| UI Reportes → emitir | `frontend/src/pages/Reportes.tsx` |

**Cuerpo enviado a Factus** (resumen; ver código para claves exactas):

- `reference_code` — único por movimiento (evita duplicados en reintentos).
- `numbering_range_id` — rango **documento 24** (documento soporte). Se toma de `tenant_factus_settings.documento_soporte_numbering_range_id` o del primer rango activo con `document == "24"`.
- `payment_method_code` — mapeo desde método de pago del egreso (p. ej. efectivo `10`).
- `observation` — texto corto (concepto + ref interna).
- `establishment` — adquiriente (CDA): datos tenant/sede, mismo criterio que factura.
- `provider` — proveedor: `identification_document_id`, `identification`, `dv`, `municipality_id`, nombre, dirección, correo, teléfono, `legal_organization_id`, etc.
- `items` — al menos una línea; montos excluidos de IVA típicos para gasto (`tax_rate` 0, `is_excluded` 1).
- `send_email` — si notificar al correo del proveedor vía Factus (y correo válido).

---

## 3. Checklist para que la emisión no falle

1. **Modo Factus** activo en el tenant (`tenant_factus_settings.modo = factus`).
2. **Credenciales** Factus completas (client id, secret, usuario, contraseña) para el ambiente (sandbox/prod).
3. **Rango de numeración** documento **24** en Factus para esa cuenta, o `documento_soporte_numbering_range_id` guardado en ajustes.
4. **Proveedor / egreso** con datos DIAN completos:
   - Dirección, correo, teléfono válidos.
   - **Municipio Factus** (`beneficiario_factus_municipality_id`): obligatorio para emitir (si el egreso se registró sin id, completar datos o editar flujo).
   - **NIT / cédula como NIT**: si hay dos DV posibles (DSAJ24b), el número debe ir **con guion y DV** como en el RUT.
5. **Contribuyente Factus** = mismo NIT del CDA que en Organización (credenciales ligadas al emisor).
6. Roles: emisión desde API solo **contador o administrador** (`get_contador_or_admin` en el endpoint emitir).

---

## 4. Errores frecuentes y qué hacer

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| 400 / mensaje DV / DSAJ24b | NIT o cédula sin formato RUT cuando hay ambigüedad | Corregir número en movimiento/catálogo con guion y DV oficial. |
| 400 municipio | Sin `beneficiario_factus_municipality_id` | Completar id Factus del municipio del proveedor. |
| 400 rango / documento 24 | Sin resolución de DS en Factus | Crear rango documento soporte en Factus o fijar `documento_soporte_numbering_range_id`. |
| 422 Factus | Payload distinto a lo esperado (ítems, impuestos, proveedor) | Revisar cuerpo en logs; comparar con doc «crear-validar». |
| 409 / pendiente DIAN | Cola en cuenta Factus | Revisar en panel Factus / DIAN; no es bug de «ciudad» en CDASOFT. |
| PDF / enlace vacío | Respuesta `show` sin URL útil | Ya hay heurísticas en `resolver_y_guardar_public_url_documento_soporte`; revisar respuesta real de Factus. |

---

## 5. Pruebas rápidas (desarrollo)

```bash
# Desde el servidor o máquina con token (simplificado; en prod usar el proxy CDASOFT)
curl -s http://127.0.0.1:8010/health
# Emitir vía API autenticada: POST /api/v1/factus/documentos-soporte/emitir
```

---

## 6. Próximos pasos sugeridos (producto)

- [ ] Flujo para **completar municipio** en egresos viejos sin id (edición o pantalla de reparación).
- [ ] Mensaje en UI cuando el egreso **no** puede emitir DS por datos incompletos (antes de llamar a Factus).
- [ ] Opcional: registrar en auditoría cada intento fallido con cuerpo resumido de Factus (sin secretos).

---

## 7. Referencia de código

- Mapeo tipo de identificación → Factus `identification_document_id` / `legal_organization_id`: comentario en `_resolver_tipo_proveedor_documento_soporte` dentro de `factus_support_emit.py`.
- Mensajes amigables al usuario cuando Factus devuelve error: `format_factus_error_for_user` en `factus_client.py` (p. ej. hints DSAJ24b).
