import { Callout, Divider, Grid, H1, H2, Stat, Table, Text, Stack } from 'cursor/canvas';

export default function SiigoAlegraBenchmarkContador() {
  return (
    <Stack gap={16}>
      <H1>Benchmark Siigo vs Alegra para modulo Contador CDASoft</H1>
      <Text>
        Objetivo: identificar que ya resuelven Siigo y Alegra para contadores en Colombia y priorizar
        una version equivalente en CDASoft para CDA.
      </Text>
      <Text tone="secondary" size="small">
        Fuente: centros de ayuda y blogs oficiales de Siigo/Alegra sobre exogena, reportes y flujo de
        exportacion para DIAN.
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="Muy alto" label="Impacto esperado en contador" />
        <Stat value="Alto" label="Paridad minima requerida" />
        <Stat value="6-8 semanas" label="MVP contador recomendado" />
        <Stat value="Exogena" label="Gancho comercial principal" />
      </Grid>

      <Callout tone="success" title="Lectura ejecutiva">
        Siigo y Alegra ganan por una cosa: exogena guiada y exportable, con configuracion reutilizable por
        ano. Si CDASoft replica ese flujo primero (mas trazabilidad por sede/CDA), cierra la brecha critica
        para contadores.
      </Callout>

      <Divider />

      <H2>Lo que Siigo tiene fuerte</H2>
      <Table
        columns={[
          { key: 'feature', header: 'Capacidad' },
          { key: 'detail', header: 'Como opera' },
          { key: 'signal', header: 'Senal para CDASoft' },
        ]}
        rows={[
          {
            feature: 'Asistente de medios magneticos',
            detail: 'Flujo guiado para configurar cuentas, conceptos, categorias y generar archivos.',
            signal: 'Necesitamos wizard por pasos, no solo boton de exportar.',
          },
          {
            feature: 'Mapeo cuenta -> formato -> concepto',
            detail: 'Permite asociar cuentas a formatos y conceptos por vigencia.',
            signal: 'Motor de reglas versionado por ano gravable.',
          },
          {
            feature: 'Validacion de topes y cuantias menores',
            detail: 'Incluye logica UVT/topes antes de generar reporte final.',
            signal: 'Validaciones previas con alertas bloqueantes y advertencias.',
          },
          {
            feature: 'Cobertura amplia de formatos',
            detail: 'Cobertura de formatos clave y exportables para revision previa.',
            signal: 'Arrancar por 1001, 1003, 1005, 1006, 1007, 1008, 1009, 2276.',
          },
        ]}
      />

      <Divider />

      <H2>Lo que Alegra tiene fuerte</H2>
      <Table
        columns={[
          { key: 'feature', header: 'Capacidad' },
          { key: 'detail', header: 'Como opera' },
          { key: 'signal', header: 'Senal para CDASoft' },
        ]}
        rows={[
          {
            feature: 'Exogena desde Reportes',
            detail: 'Entrada simple: Reportes > Informacion exogena > formato > ano > exportar.',
            signal: 'UX muy directa para contador no tecnico.',
          },
          {
            feature: 'Configuracion reutilizable',
            detail: 'Permite usar configuracion del ano anterior para acelerar cierre fiscal.',
            signal: 'Funcion clonar configuracion anual obligatoria en MVP.',
          },
          {
            feature: 'Automatizacion por documentos',
            detail: 'Toma datos ya contabilizados en facturas, compras, impuestos y terceros.',
            signal: 'Integrar exogena al flujo actual de caja/facturacion sin doble digitacion.',
          },
          {
            feature: 'Historial de exportables',
            detail: 'Gestion de reportes exportados para trazabilidad.',
            signal: 'Bitacora de generacion por usuario/sede/fecha y estado.',
          },
        ]}
      />

      <Divider />

      <H2>Paridad minima CDASoft (lo que debemos tener si o si)</H2>
      <Table
        columns={[
          { key: 'item', header: 'Elemento' },
          { key: 'priority', header: 'Prioridad' },
          { key: 'why', header: 'Por que importa' },
        ]}
        rows={[
          {
            item: 'Wizard de exogena por ano gravable',
            priority: 'P0',
            why: 'Reduce errores y guia al contador en fechas de alta presion.',
          },
          {
            item: 'Formatos DIAN clave (1001, 1003, 1005, 1006, 1007, 1008, 1009, 2276)',
            priority: 'P0',
            why: 'Cubre la necesidad base de la mayoria de CDA.',
          },
          {
            item: 'Reglas UVT / cuantias menores / validaciones',
            priority: 'P0',
            why: 'Evita archivos rechazados y retrabajo.',
          },
          {
            item: 'Clonar configuracion del ano anterior',
            priority: 'P1',
            why: 'Ahorra tiempo y estandariza la operacion entre periodos.',
          },
          {
            item: 'Historial de exportes + auditoria',
            priority: 'P1',
            why: 'Trazabilidad para soporte, auditoria y reimpresion.',
          },
          {
            item: 'Checklist previo DIAN por formato',
            priority: 'P1',
            why: 'Disminuye sanciones por campos faltantes o terceros incompletos.',
          },
        ]}
      />

      <Callout tone="warning" title="Diferencial CDASoft recomendado">
        No competir solo por "tener exogena". El diferencial debe ser: multi-sede nativo para CDA,
        trazabilidad por usuario, y conciliacion directa con caja/facturacion operativa de la revision.
      </Callout>

      <Divider />

      <H2>Roadmap sugerido para empalmar con lo nuestro</H2>
      <Table
        columns={[
          { key: 'phase', header: 'Fase' },
          { key: 'scope', header: 'Alcance' },
          { key: 'exit', header: 'Criterio de salida' },
        ]}
        rows={[
          {
            phase: 'Fase 1 (2-3 semanas)',
            scope: 'Motor de configuracion por formato y ano + wizard base + validaciones minimas.',
            exit: 'Se genera borrador confiable para 1001 y 1007 con menos de 5% ajustes manuales.',
          },
          {
            phase: 'Fase 2 (2-3 semanas)',
            scope: 'Completar 1003, 1005, 1006, 1008, 1009, 2276 + historial de exportes.',
            exit: 'Contador genera y descarga los 8 formatos clave de un CDA sin soporte tecnico.',
          },
          {
            phase: 'Fase 3 (1-2 semanas)',
            scope: 'Pulido UX, alertas de calidad de datos y panel de estado por CDA/sede.',
            exit: 'Flujo listo para piloto comercial con 2-3 contadores reales.',
          },
        ]}
      />
    </Stack>
  );
}
