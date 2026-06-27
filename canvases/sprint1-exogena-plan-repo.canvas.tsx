import { Callout, Divider, H1, H2, Stack, Stat, Grid, Table, Text } from 'cursor/canvas';

export default function Sprint1ExogenaPlanRepo() {
  return (
    <Stack gap={16}>
      <H1>Sprint 1 Exogena: plan real de repo CDASoft</H1>
      <Text>
        Aterrizado sobre la arquitectura actual (patron Nomina + toggles por tenant + init_db con ensure_*).
        Objetivo: dejar base funcional para formatos 1001 y 1007 con validacion previa.
      </Text>
      <Text tone="secondary" size="small">
        Horizonte: 10 dias habiles. Estrategia: backend primero (modelo/reglas/API), frontend despues (wizard).
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="10 dias" label="Duracion Sprint 1" />
        <Stat value="Backend -> Frontend" label="Orden tecnico" />
        <Stat value="1001 + 1007" label="Alcance funcional" />
        <Stat value="Contador/Admin" label="Roles habilitados" />
      </Grid>

      <Callout tone="success" title="Resultado esperado al cierre de Sprint 1">
        Un contador puede: configurar mapeo anual, correr validaciones UVT/terceros y exportar borrador de
        1001 y 1007, con historial de ejecucion para trazabilidad.
      </Callout>

      <Divider />

      <H2>1) Backend: archivos a crear</H2>
      <Table
        columns={[
          { key: 'file', header: 'Archivo nuevo' },
          { key: 'purpose', header: 'Proposito' },
          { key: 'note', header: 'Detalle de implementacion' },
        ]}
        rows={[
          {
            file: 'backend/app/models/exogena.py',
            purpose: 'Modelo dominio Exogena',
            note: 'Tablas: parametros, conceptos, mapeos, ejecuciones y filas de validacion.',
          },
          {
            file: 'backend/app/schemas/exogena.py',
            purpose: 'Contratos API',
            note: 'Create/Update/List para configuracion, validar y exportar.',
          },
          {
            file: 'backend/app/api/v1/endpoints/exogena.py',
            purpose: 'Endpoints modulo',
            note: 'Router con Depends(require_exogena_enabled_for_tenant).',
          },
          {
            file: 'frontend/src/api/exogena.ts',
            purpose: 'Cliente API frontend',
            note: 'Funciones para wizard: periodo, mapeo, validar, exportar, historial.',
          },
          {
            file: 'frontend/src/pages/Exogena.tsx',
            purpose: 'Pantalla principal modulo',
            note: 'Wizard 5 pasos, igual estilo de Nomina.',
          },
        ]}
      />

      <Divider />

      <H2>2) Backend: archivos existentes a editar</H2>
      <Table
        columns={[
          { key: 'file', header: 'Archivo existente' },
          { key: 'change', header: 'Cambio requerido' },
          { key: 'why', header: 'Por que aqui' },
        ]}
        rows={[
          {
            file: 'backend/app/api/v1/api.py',
            change: 'Registrar include_router(exogena.router, prefix="/exogena").',
            why: 'Publicar el nuevo modulo en API v1.',
          },
          {
            file: 'backend/app/db/database.py',
            change: 'Crear ensure_exogena_schema(db) + llamado en init_db().',
            why: 'Patron actual de migraciones incrementales por ensure_*.',
          },
          {
            file: 'backend/app/models/tenant.py',
            change: 'Agregar columna exogena_enabled (bool, default false).',
            why: 'Mismo control de habilitacion que nomina/sarlaft.',
          },
          {
            file: 'backend/app/core/deps.py',
            change: 'Nuevo require_exogena_enabled_for_tenant().',
            why: 'Bloqueo centralizado del modulo por tenant.',
          },
          {
            file: 'backend/app/schemas/usuario.py',
            change: 'Agregar tenant_exogena_enabled en UsuarioResponse.',
            why: 'Front necesita bandera para dashboard/rutas.',
          },
          {
            file: 'backend/app/api/v1/endpoints/auth.py',
            change: 'Incluir tenant_exogena_enabled en /auth/me.',
            why: 'Disponible en sesion tenant al iniciar app.',
          },
          {
            file: 'backend/app/api/v1/endpoints/saas_auth.py',
            change: 'Permitir editar exogena_enabled en core-data del tenant.',
            why: 'Backoffice SaaS habilita modulo por cliente.',
          },
        ]}
      />

      <Divider />

      <H2>3) Frontend: archivos existentes a editar</H2>
      <Table
        columns={[
          { key: 'file', header: 'Archivo existente' },
          { key: 'change', header: 'Cambio requerido' },
          { key: 'impact', header: 'Impacto UX' },
        ]}
        rows={[
          {
            file: 'frontend/src/types/index.ts',
            change: 'Agregar tenant_exogena_enabled y tipos ExogenaSummary/Validation.',
            impact: 'Tipado estable en toda la app.',
          },
          {
            file: 'frontend/src/App.tsx',
            change: 'Agregar ruta /exogena con roles administrador/contador y guard de habilitacion.',
            impact: 'Control de acceso consistente.',
          },
          {
            file: 'frontend/src/pages/Dashboard.tsx',
            change: 'Nueva tarjeta modulo Exogena (como Nomina) con modal de bloqueo.',
            impact: 'Entrada visible para contador.',
          },
          {
            file: 'frontend/src/api/saasTenant.ts',
            change: 'Incluir exogena_enabled en patchSaasTenantCoreData.',
            impact: 'Backoffice SaaS puede activar modulo.',
          },
          {
            file: 'frontend/src/pages/Organizacion.tsx o SaaSBackoffice.tsx',
            change: 'Switch de habilitacion Exogena por tenant.',
            impact: 'Operacion comercial/soporte sin SQL manual.',
          },
        ]}
      />

      <Divider />

      <H2>4) Contrato API Sprint 1 (propuesto)</H2>
      <Table
        columns={[
          { key: 'method', header: 'Metodo y ruta' },
          { key: 'scope', header: 'Permisos' },
          { key: 'purpose', header: 'Uso en wizard' },
        ]}
        rows={[
          {
            method: 'GET /exogena/config?anio=2026',
            scope: 'contador/admin',
            purpose: 'Cargar configuracion anual por formato.',
          },
          {
            method: 'PUT /exogena/config',
            scope: 'contador/admin',
            purpose: 'Guardar mapeos cuenta->concepto/categoria.',
          },
          {
            method: 'POST /exogena/validar',
            scope: 'contador/admin',
            purpose: 'Ejecutar validaciones UVT/terceros/campos obligatorios.',
          },
          {
            method: 'POST /exogena/exportar',
            scope: 'contador/admin',
            purpose: 'Generar borrador 1001/1007 y registrar ejecucion.',
          },
          {
            method: 'GET /exogena/historial?anio=2026',
            scope: 'contador/admin',
            purpose: 'Listar exportaciones y estado.',
          },
        ]}
      />

      <Divider />

      <H2>5) Modelo de datos minimo Sprint 1</H2>
      <Table
        columns={[
          { key: 'table', header: 'Tabla' },
          { key: 'key', header: 'Llave funcional' },
          { key: 'contenido', header: 'Campos clave' },
        ]}
        rows={[
          {
            table: 'exogena_parametros_anuales',
            key: 'tenant_id + anio',
            contenido: 'uvt_anual, topes_formato_json, version_normativa, updated_by.',
          },
          {
            table: 'exogena_mapeos',
            key: 'tenant_id + anio + formato + cuenta + concepto',
            contenido: 'categoria, saldo_a_reportar, activo, source_rule.',
          },
          {
            table: 'exogena_validaciones',
            key: 'id UUID',
            contenido: 'formato, severidad, codigo, mensaje, referencia_origen.',
          },
          {
            table: 'exogena_ejecuciones',
            key: 'id UUID',
            contenido: 'anio, formato, status, total_rows, errores, archivo_relpath, sha256.',
          },
        ]}
      />

      <Divider />

      <H2>6) Secuencia de trabajo por dias</H2>
      <Table
        columns={[
          { key: 'days', header: 'Dias' },
          { key: 'backend', header: 'Backend entregable' },
          { key: 'frontend', header: 'Frontend entregable' },
        ]}
        rows={[
          {
            days: 'Dia 1-2',
            backend: 'Modelos exogena + ensure_exogena_schema + bandera tenant.',
            frontend: 'Sin UI aun.',
          },
          {
            days: 'Dia 3-4',
            backend: 'Endpoints config (GET/PUT) + tests unitarios mapeo.',
            frontend: 'api/exogena.ts base.',
          },
          {
            days: 'Dia 5-6',
            backend: 'POST validar con motor UVT y terceros incompletos.',
            frontend: 'Wizard pasos 1-3 (periodo, mapeo, validacion).',
          },
          {
            days: 'Dia 7-8',
            backend: 'POST exportar + historial ejecuciones.',
            frontend: 'Wizard pasos 4-5 (preview/exportar + historial).',
          },
          {
            days: 'Dia 9-10',
            backend: 'Ajustes, hardening permisos y auditoria.',
            frontend: 'Integracion Dashboard/App y QA con contador piloto.',
          },
        ]}
      />

      <Callout tone="warning" title="Riesgos criticos Sprint 1">
        Calidad de terceros historicos y cuentas sin clasificar pueden bloquear exportes. Mitigacion:
        validacion con severidad, exporte parcial con advertencias y bitacora de correcciones.
      </Callout>
    </Stack>
  );
}
