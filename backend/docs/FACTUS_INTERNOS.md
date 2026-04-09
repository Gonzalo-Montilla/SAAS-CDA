# Factus — notas internas (CDASOFT)

- **Correos**: pueden convivir el correo del CDA y el de Factus; el envío de la factura electrónica lo gestiona Factus según la cuenta configurada allí.
- **Logo / personalización visual**: se configura en el panel Factus del cliente, no en CDASOFT (no prometer personalización de PDF desde nuestra app salvo que exista integración explícita).
- **Municipios**: el valor que debe guardarse en `factus_municipality_id` (matriz/sede) es el **`id` numérico** devuelto por `GET /v1/municipalities` de Factus. El campo **`code`** de esa API es el código DIAN; **no** es el id que enviamos en el payload de factura como `municipality_id`.
- **Ambientes**: sandbox y producción tienen credenciales distintas; el listado de municipios y rangos usa la **URL y credenciales del ambiente activo** del tenant.

Checklist operativo multi-sede: `CHECKLIST_FACTUS_MULTISEDES.md`.
