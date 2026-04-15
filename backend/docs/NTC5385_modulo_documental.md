# Alineación del módulo documental con NTC 5385 y seguridad de la información

## Marco normativo

- La **NTC 5385** (*Centros de diagnóstico automotor. Especificaciones del servicio*, tercera actualización) define requisitos del servicio del CDA, incluidos aspectos del **sistema de información** asociado a la revisión técnico-mecánica y emisiones.
- En sus **referencias normativas** incluye explícitamente la **NTC-ISO/IEC 27002** (*Técnicas de seguridad. Código de práctica para la gestión de la seguridad de la información*), como marco de buenas prácticas aplicable al tratamiento de la información en tecnologías de la información.
- El numeral **4.16.2** (y el apartado **4.16** en su conjunto) debe **verificarse siempre en el ejemplar oficial adquirido ante ICONTEC** o el organismo de normalización vigente; la redacción exacta puede variar entre ediciones. Este documento traduce a **controles implementables** lo que habitualmente exigen auditorías en CDA sobre **confidencialidad, integridad, trazabilidad y control de acceso** a la información documentada.

## Objetivos de control (interpretación operativa)

| Enfoque | Expectativa en CDA | En CDASOFT (módulo documental / API) |
|--------|---------------------|----------------------------------------|
| Confidencialidad | Información del CDA no accesible a terceros ni entre organizaciones | Aislamiento por `tenant_id`; JWT de ámbito tenant; archivos fuera de `/uploads` público; descarga/preview solo autenticados |
| Integridad | Documentos oficiales no sustituidos sin registro; versiones reconocibles | Versionado por `grupo_id` / `version_seq`; una versión marcada como actual; sustitución explícita al subir nueva versión |
| Trazabilidad | Saber quién y cuándo altera o consulta información sensible | `created_by` / `created_at`; `updated_by` / `updated_at` en metadatos; tabla `tenant_documento_auditoria` para acciones (subida, descarga, cambio de metadatos, eliminación) |
| Control de acceso | Solo personal autorizado según rol | Listado/consulta para usuarios del tenant; eliminación y edición de metadatos restringidas a **administrador** (según política actual del producto) |
| Disponibilidad y continuidad | Respaldo y recuperación (también organizacional) | Respaldo de BD y de `DOCUMENTOS_STORAGE_DIR` es **responsabilidad operativa** del despliegue; HTTPS y cabeceras de seguridad en la API |

## Fuera de alcance del solo software

- Políticas escritas de seguridad, capacitación del personal, inventario de activos completo, evaluación de riesgos formal, certificación ISO27001, etc., son obligaciones de **gestión del CDA** que el software apoya pero no sustituye.
- Vista previa nativa de Office en navegador puede requerir componente adicional (p. ej. conversión a PDF en servidor o integración tipo OnlyOffice/Collabora), según decisión de producto (fase B/C acordadas).

## Referencias internas

- Endpoints: `app/api/v1/endpoints/documentos.py`
- Modelo de metadatos: `app/models/documento_tenant.py`
- Auditoría: `app/models/documento_auditoria.py`
- Configuración: `DOCUMENTOS_STORAGE_DIR`, `DOCUMENTOS_MAX_SIZE_MB` en `app/core/config.py`
