import { Callout, Divider, Grid, H1, H2, Stat, Table, Text, Stack } from 'cursor/canvas';

export default function MvpContadorBacklogCdasoft() {
  return (
    <Stack gap={16}>
      <H1>Backlog tecnico MVP Contador CDASoft</H1>
      <Text>
        Plan de ejecucion para empalmar CDASoft con lo mas valioso de Siigo/Alegra en exogena,
        enfocado a uso real de contadores de CDA.
      </Text>
      <Text tone="secondary" size="small">
        Alcance objetivo: 6-8 semanas, primera version operable en produccion con 2-3 CDA piloto.
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="4 epicas" label="Estructura MVP" />
        <Stat value="18 historias" label="Backlog inicial" />
        <Stat value="P0-P2" label="Priorizacion" />
        <Stat value="Backend primero" label="Estrategia de entrega" />
      </Grid>

      <Callout tone="success" title="Orden recomendado">
        Primero construir motor y validaciones (backend), luego wizard y exportables (frontend). Asi
        evitamos UI bonita sin reglas tributarias confiables.
      </Callout>

      <Divider />

      <H2>Epica 1: Motor exogena y configuracion anual</H2>
      <Table
        columns={[
          { key: 'id', header: 'Historia' },
          { key: 'desc', header: 'Descripcion' },
          { key: 'prio', header: 'Prioridad' },
          { key: 'owner', header: 'Dominio' },
        ]}
        rows={[
          {
            id: 'E1-H1',
            desc: 'Modelo de configuracion por tenant y ano gravable (formato, concepto, cuenta, categoria).',
            prio: 'P0',
            owner: 'Backend',
          },
          {
            id: 'E1-H2',
            desc: 'Versionado de reglas por vigencia DIAN y bandera de estado (borrador, validado, publicado).',
            prio: 'P0',
            owner: 'Backend',
          },
          {
            id: 'E1-H3',
            desc: 'Clonar configuracion de ano anterior con bitacora de cambios.',
            prio: 'P1',
            owner: 'Backend',
          },
          {
            id: 'E1-H4',
            desc: 'Control de acceso por rol (contador/admin) y sede activa.',
            prio: 'P0',
            owner: 'Backend',
          },
        ]}
      />

      <Divider />

      <H2>Epica 2: Validaciones tributarias y calidad de datos</H2>
      <Table
        columns={[
          { key: 'id', header: 'Historia' },
          { key: 'desc', header: 'Descripcion' },
          { key: 'prio', header: 'Prioridad' },
          { key: 'owner', header: 'Dominio' },
        ]}
        rows={[
          {
            id: 'E2-H1',
            desc: 'Motor de topes UVT y cuantias menores por formato y vigencia.',
            prio: 'P0',
            owner: 'Backend',
          },
          {
            id: 'E2-H2',
            desc: 'Validador de terceros incompletos (tipo doc, identificacion, ciudad, direccion).',
            prio: 'P0',
            owner: 'Backend',
          },
          {
            id: 'E2-H3',
            desc: 'Checklist de pre-cierre por formato con severidad (error/advertencia).',
            prio: 'P1',
            owner: 'Backend + Frontend',
          },
          {
            id: 'E2-H4',
            desc: 'Preview de inconsistencias con enlace al origen operativo (factura, egreso, tercero).',
            prio: 'P1',
            owner: 'Frontend',
          },
          {
            id: 'E2-H5',
            desc: 'Pruebas automatizadas por formato con fixtures de AG vigente.',
            prio: 'P0',
            owner: 'Backend QA',
          },
        ]}
      />

      <Divider />

      <H2>Epica 3: Generacion y trazabilidad de formatos</H2>
      <Table
        columns={[
          { key: 'id', header: 'Historia' },
          { key: 'desc', header: 'Descripcion' },
          { key: 'prio', header: 'Prioridad' },
          { key: 'owner', header: 'Dominio' },
        ]}
        rows={[
          {
            id: 'E3-H1',
            desc: 'Generador de formatos P0: 1001, 1003, 1005, 1006, 1007, 1008, 1009, 2276.',
            prio: 'P0',
            owner: 'Backend',
          },
          {
            id: 'E3-H2',
            desc: 'Exportable estandar para revision previa (estructura estable por formato).',
            prio: 'P0',
            owner: 'Backend',
          },
          {
            id: 'E3-H3',
            desc: 'Historial de exportes: quien genero, cuando, formato, ano, hash, estado.',
            prio: 'P1',
            owner: 'Backend',
          },
          {
            id: 'E3-H4',
            desc: 'Descarga de historico y re-generacion controlada.',
            prio: 'P1',
            owner: 'Frontend',
          },
          {
            id: 'E3-H5',
            desc: 'Auditoria de cambios de configuracion (antes/despues).',
            prio: 'P1',
            owner: 'Backend',
          },
        ]}
      />

      <Divider />

      <H2>Epica 4: UX Contador (wizard) y operacion diaria</H2>
      <Table
        columns={[
          { key: 'id', header: 'Historia' },
          { key: 'desc', header: 'Descripcion' },
          { key: 'prio', header: 'Prioridad' },
          { key: 'owner', header: 'Dominio' },
        ]}
        rows={[
          {
            id: 'E4-H1',
            desc: 'Wizard de 5 pasos: periodo, configuracion, validacion, vista previa, exportar.',
            prio: 'P0',
            owner: 'Frontend',
          },
          {
            id: 'E4-H2',
            desc: 'Pantalla de mapeo cuenta-concepto con filtros por formato y busqueda rapida.',
            prio: 'P0',
            owner: 'Frontend',
          },
          {
            id: 'E4-H3',
            desc: 'Indicador de completitud por formato (% reglas listas / faltantes).',
            prio: 'P1',
            owner: 'Frontend',
          },
          {
            id: 'E4-H4',
            desc: 'Atajos para corregir tercero o cuenta sin salir del flujo.',
            prio: 'P2',
            owner: 'Frontend + Backend',
          },
        ]}
      />

      <Divider />

      <H2>Orden de implementacion (sprints)</H2>
      <Table
        columns={[
          { key: 'sprint', header: 'Sprint' },
          { key: 'goal', header: 'Objetivo tecnico' },
          { key: 'done', header: 'Definition of done' },
        ]}
        rows={[
          {
            sprint: 'Sprint 1',
            goal: 'E1-H1/H2/H4 + base E2-H1.',
            done: 'API de configuracion anual operativa + reglas UVT minimas testeadas.',
          },
          {
            sprint: 'Sprint 2',
            goal: 'E3-H1 para 1001 y 1007 + E2-H2/H5.',
            done: 'Primeros formatos exportables con validaciones de terceros.',
          },
          {
            sprint: 'Sprint 3',
            goal: 'E4-H1/H2 + E3-H1 restante formatos P0.',
            done: 'Wizard usable end-to-end para los 8 formatos clave.',
          },
          {
            sprint: 'Sprint 4',
            goal: 'E3-H3/H4/H5 + E2-H3/H4 + E1-H3.',
            done: 'Historial, trazabilidad y clonacion anual listos para piloto.',
          },
        ]}
      />

      <Callout tone="warning" title="Riesgos a vigilar desde el dia 1">
        Cambios normativos por vigencia, calidad de datos de terceros historicos y diferencias contables
        entre sedes. Mitigacion: reglas versionadas, checklist bloqueante y piloto temprano con contador real.
      </Callout>
    </Stack>
  );
}
