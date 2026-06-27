import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Database, Download, FileUp, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { exogenaApi } from '../api/exogena';
import { reportesApi } from '../api/reportes';
import { formatCOP } from '../utils/formatNumber';

function currentYear(): string {
  return String(new Date().getFullYear());
}

function currentLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function firstDayOfMonthLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function parseTopeFormato(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function readTopeFromConfig(raw: Record<string, unknown> | undefined, formato: '1001' | '1007'): number {
  if (!raw) return 0;
  const nested = raw[formato];
  if (nested && typeof nested === 'object') {
    const nestedObj = nested as Record<string, unknown>;
    const fromNested = nestedObj.cuantia_minima ?? nestedObj.tope_cuantias_minimas ?? nestedObj.minimo;
    if (fromNested !== undefined) return parseTopeFormato(fromNested);
  }
  const direct =
    raw[`cuantia_minima_${formato}`] ??
    raw[`tope_cuantias_minimas_${formato}`] ??
    raw.cuantia_minima ??
    raw.tope_cuantias_minimas;
  if (direct !== undefined) return parseTopeFormato(direct);
  return 0;
}

export default function Contador() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    | 'panel'
    | 'cxc'
    | 'cxp'
    | 'ventas_vendedor'
    | 'ventas_sucursal'
    | 'estado_resultado'
    | 'estado_flujo'
    | 'estado_patrimonio'
    | 'estado_situacion'
    | 'balance_prueba'
    | 'balance_tercero'
    | 'exogena'
  >('panel');
  const [anio, setAnio] = useState(currentYear());
  const [uvt, setUvt] = useState<number>(0);
  const [topeMinimo1001, setTopeMinimo1001] = useState<number>(0);
  const [topeMinimo1007, setTopeMinimo1007] = useState<number>(0);
  const [versionNormativa, setVersionNormativa] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historialFiltro, setHistorialFiltro] = useState<'success' | 'error' | 'all'>('success');
  const [modoExportacion, setModoExportacion] = useState<'consolidado' | 'detalle'>('consolidado');
  const [expandedEjecucionId, setExpandedEjecucionId] = useState<string | null>(null);
  const [validacionesByEjecucion, setValidacionesByEjecucion] = useState<Record<string, any[]>>({});
  const [loadingValidacionesEjecId, setLoadingValidacionesEjecId] = useState<string | null>(null);
  const [cxcFiltro, setCxcFiltro] = useState('');
  const [cxpFiltro, setCxpFiltro] = useState('');
  const [ventasVendedorFiltro, setVentasVendedorFiltro] = useState('');
  const [ventasVendedorDesde, setVentasVendedorDesde] = useState(firstDayOfMonthLocalDate());
  const [ventasVendedorHasta, setVentasVendedorHasta] = useState(currentLocalDate());
  const [ventasSucursalFiltro, setVentasSucursalFiltro] = useState('');
  const [ventasSucursalDesde, setVentasSucursalDesde] = useState(firstDayOfMonthLocalDate());
  const [ventasSucursalHasta, setVentasSucursalHasta] = useState(currentLocalDate());
  const [estadoResultadoDesde, setEstadoResultadoDesde] = useState(firstDayOfMonthLocalDate());
  const [estadoResultadoHasta, setEstadoResultadoHasta] = useState(currentLocalDate());
  const [estadoFlujoDesde, setEstadoFlujoDesde] = useState(firstDayOfMonthLocalDate());
  const [estadoFlujoHasta, setEstadoFlujoHasta] = useState(currentLocalDate());
  const [estadoPatrimonioDesde, setEstadoPatrimonioDesde] = useState(firstDayOfMonthLocalDate());
  const [estadoPatrimonioHasta, setEstadoPatrimonioHasta] = useState(currentLocalDate());
  const [estadoSituacionCorte, setEstadoSituacionCorte] = useState(currentLocalDate());
  const [balancePruebaCorte, setBalancePruebaCorte] = useState(currentLocalDate());
  const [balancePruebaFiltro, setBalancePruebaFiltro] = useState('');
  const [balanceTerceroCorte, setBalanceTerceroCorte] = useState(currentLocalDate());
  const [balanceTerceroFiltro, setBalanceTerceroFiltro] = useState('');
  const [mapeosDraft, setMapeosDraft] = useState<
    Array<{
      id: string;
      formato: string;
      cuenta_contable: string;
      concepto: string;
      categoria: string;
      saldo_a_reportar: string;
      activo: string;
      source_rule?: string | null;
    }>
  >([]);
  const accesosRapidosContables: Array<{
    id: string;
    titulo: string;
    detalle: string;
    ruta: string;
    categoria: string;
  }> = [
    {
      id: 'ventas-cliente',
      titulo: 'Ventas por cliente',
      detalle: 'Usa detalle operativo para filtrar tramites y exportar.',
      ruta: '/reportes?seccion=detalle',
      categoria: 'Ventas',
    },
    {
      id: 'ventas-sucursal',
      titulo: 'Ventas por sucursal',
      detalle: 'Consolidado por sede activa o todas las sedes del tenant.',
      ruta: 'tab:ventas_sucursal',
      categoria: 'Ventas',
    },
    {
      id: 'ventas-vendedor',
      titulo: 'Ventas por vendedor',
      detalle: 'Ranking de ventas y ticket promedio por usuario de cobro.',
      ruta: 'tab:ventas_vendedor',
      categoria: 'Ventas',
    },
    {
      id: 'estado-resultado',
      titulo: 'Estado de resultado integral',
      detalle: 'Resultado gerencial preliminar por periodo.',
      ruta: 'tab:estado_resultado',
      categoria: 'Estados',
    },
    {
      id: 'estado-flujo',
      titulo: 'Estado de flujo de efectivo',
      detalle: 'Flujos de operación, inversión y financiación (gerencial preliminar).',
      ruta: 'tab:estado_flujo',
      categoria: 'Estados',
    },
    {
      id: 'estado-patrimonio',
      titulo: 'Estado de cambios en el patrimonio',
      detalle: 'Movimiento del patrimonio con conciliación gerencial preliminar.',
      ruta: 'tab:estado_patrimonio',
      categoria: 'Estados',
    },
    {
      id: 'estado-situacion',
      titulo: 'Estado de situacion financiera',
      detalle: 'Vista gerencial preliminar con corte por fecha.',
      ruta: 'tab:estado_situacion',
      categoria: 'Estados',
    },
    {
      id: 'balance-prueba',
      titulo: 'Balance de prueba general',
      detalle: 'Debitos y creditos por cuenta de control (gerencial preliminar).',
      ruta: 'tab:balance_prueba',
      categoria: 'Estados',
    },
    {
      id: 'balance-tercero',
      titulo: 'Balance de prueba por tercero',
      detalle: 'Debitos y creditos por cuenta y tercero (gerencial preliminar).',
      ruta: 'tab:balance_tercero',
      categoria: 'Estados',
    },
    {
      id: 'impuestos-detallados',
      titulo: 'Impuestos detallados',
      detalle: 'Control de IVA causado y provisionado por periodo.',
      ruta: '/reportes?seccion=provisiones',
      categoria: 'Impuestos',
    },
    {
      id: 'cxp-proveedores',
      titulo: 'Cuentas por pagar / proveedores',
      detalle: 'Consolidado por proveedor, priorizando datos del catalogo.',
      ruta: 'tab:cxp',
      categoria: 'Terceros',
    },
    {
      id: 'terceros-rut',
      titulo: 'Catalogo de terceros (RUT)',
      detalle: 'Administra datos fiscales base para exogena y soporte.',
      ruta: '/proveedores-catalogo',
      categoria: 'Terceros',
    },
    {
      id: 'cierres-caja',
      titulo: 'Recibos y cierres de caja',
      detalle: 'Historial de caja con evidencia de auditoria.',
      ruta: '/reportes?seccion=cierres',
      categoria: 'Auditoria',
    },
  ];
  const pendientesContables = [
    'Libro mayor y balance',
    'CxC consolidado por cliente',
  ];

  const configQuery = useQuery({
    queryKey: ['exogena-config', anio],
    queryFn: () => exogenaApi.getConfig(anio),
  });

  const ejecucionesQuery = useQuery({
    queryKey: ['exogena-ejecuciones', anio],
    queryFn: () => exogenaApi.listarEjecuciones(anio),
  });

  const cxcQuery = useQuery({
    queryKey: ['reportes-cxc-general-cliente'],
    queryFn: () => reportesApi.getCxcGeneralCliente({ limit: 500 }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'cxc',
  });
  const cxpQuery = useQuery({
    queryKey: ['reportes-cxp-general-proveedor'],
    queryFn: () => reportesApi.getCxpGeneralProveedor({ limit: 500 }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'cxp',
  });
  const ventasVendedorQuery = useQuery({
    queryKey: ['reportes-ventas-por-vendedor', ventasVendedorDesde, ventasVendedorHasta],
    queryFn: () =>
      reportesApi.getVentasPorVendedor({
        fechaInicio: ventasVendedorDesde,
        fechaFin: ventasVendedorHasta,
        limit: 500,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'ventas_vendedor' && !!ventasVendedorDesde && !!ventasVendedorHasta,
  });
  const ventasSucursalQuery = useQuery({
    queryKey: ['reportes-ventas-por-sucursal', ventasSucursalDesde, ventasSucursalHasta],
    queryFn: () =>
      reportesApi.getVentasPorSucursal({
        fechaInicio: ventasSucursalDesde,
        fechaFin: ventasSucursalHasta,
        limit: 300,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'ventas_sucursal' && !!ventasSucursalDesde && !!ventasSucursalHasta,
  });
  const estadoResultadoQuery = useQuery({
    queryKey: ['reportes-estado-resultado-gerencial', estadoResultadoDesde, estadoResultadoHasta],
    queryFn: () =>
      reportesApi.getEstadoResultadoGerencial({
        fechaInicio: estadoResultadoDesde,
        fechaFin: estadoResultadoHasta,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'estado_resultado' && !!estadoResultadoDesde && !!estadoResultadoHasta,
  });
  const estadoFlujoQuery = useQuery({
    queryKey: ['reportes-estado-flujo-efectivo-gerencial', estadoFlujoDesde, estadoFlujoHasta],
    queryFn: () =>
      reportesApi.getEstadoFlujoEfectivoGerencial({
        fechaInicio: estadoFlujoDesde,
        fechaFin: estadoFlujoHasta,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'estado_flujo' && !!estadoFlujoDesde && !!estadoFlujoHasta,
  });
  const estadoPatrimonioQuery = useQuery({
    queryKey: ['reportes-estado-cambios-patrimonio-gerencial', estadoPatrimonioDesde, estadoPatrimonioHasta],
    queryFn: () =>
      reportesApi.getEstadoCambiosPatrimonioGerencial({
        fechaInicio: estadoPatrimonioDesde,
        fechaFin: estadoPatrimonioHasta,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'estado_patrimonio' && !!estadoPatrimonioDesde && !!estadoPatrimonioHasta,
  });
  const estadoSituacionQuery = useQuery({
    queryKey: ['reportes-estado-situacion-gerencial', estadoSituacionCorte],
    queryFn: () =>
      reportesApi.getEstadoSituacionGerencial({
        fechaCorte: estadoSituacionCorte,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'estado_situacion' && !!estadoSituacionCorte,
  });
  const balancePruebaQuery = useQuery({
    queryKey: ['reportes-balance-prueba-gerencial', balancePruebaCorte],
    queryFn: () =>
      reportesApi.getBalancePruebaGerencial({
        fechaCorte: balancePruebaCorte,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'balance_prueba' && !!balancePruebaCorte,
  });
  const balanceTerceroQuery = useQuery({
    queryKey: ['reportes-balance-prueba-tercero-gerencial', balanceTerceroCorte],
    queryFn: () =>
      reportesApi.getBalancePruebaTerceroGerencial({
        fechaCorte: balanceTerceroCorte,
        limit: 5000,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'balance_tercero' && !!balanceTerceroCorte,
  });

  const validarMutation = useMutation({
    mutationFn: () => exogenaApi.validar({ anio, formatos: ['1001', '1007'] }),
    onSuccess: (res) => {
      setError(null);
      setMensaje(`Validación: ${res.total_errors} errores, ${res.total_warnings} advertencias.`);
      queryClient.invalidateQueries({ queryKey: ['exogena-ejecuciones', anio] });
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo validar.');
    },
  });

  const guardarMutation = useMutation({
    mutationFn: () =>
      exogenaApi.saveConfig({
        anio,
        uvt_anual: Number(uvt || 0),
        topes_por_formato_json: {
          '1001': { cuantia_minima: Number(topeMinimo1001 || 0) },
          '1007': { cuantia_minima: Number(topeMinimo1007 || 0) },
        },
        version_normativa: versionNormativa.trim() || null,
        mapeos: mapeosDraft.map((m) => ({
          formato: m.formato,
          cuenta_contable: m.cuenta_contable,
          concepto: m.concepto,
          categoria: m.categoria || '',
          saldo_a_reportar: m.saldo_a_reportar || 'saldo_final',
          source_rule: m.source_rule || null,
          activo: m.activo || 'si',
        })),
      }),
    onSuccess: () => {
      setError(null);
      setMensaje('Configuración guardada correctamente.');
      queryClient.invalidateQueries({ queryKey: ['exogena-config', anio] });
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo guardar configuración.');
    },
  });

  const exportarMutation = useMutation({
    mutationFn: (formato: '1001' | '1007') =>
      exogenaApi.exportar({ anio, formato, include_warnings: true, modo_exportacion: modoExportacion }),
    onSuccess: (res) => {
      setError(null);
      setMensaje(
        res.ok
          ? `Exportación ${res.formato} (${modoExportacion}) OK (${res.total_rows} filas, omitidos: ${res.omitidos_rows || 0}).`
          : `Exportación ${res.formato} bloqueada: ${res.error_message || 'revisar validaciones'}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['exogena-ejecuciones', anio] });
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo exportar.');
    },
  });

  const mapeos = mapeosDraft;
  const ejecuciones = (ejecucionesQuery.data || []).filter((e) => {
    if (historialFiltro === 'all') return true;
    return (e.status || '').toLowerCase() === historialFiltro;
  });
  const cxcRows = (cxcQuery.data?.clientes || []).filter((r) => {
    const q = cxcFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.cliente_nombre || '').toLowerCase().includes(q) ||
      String(r.cliente_documento || '').toLowerCase().includes(q) ||
      String(r.placas || []).toLowerCase().includes(q)
    );
  });
  const cxpRows = (cxpQuery.data?.proveedores || []).filter((r) => {
    const q = cxpFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.proveedor_nombre || '').toLowerCase().includes(q) ||
      String(r.proveedor_documento || '').toLowerCase().includes(q) ||
      String(r.referencias_comprobante || []).toLowerCase().includes(q)
    );
  });
  const ventasVendedorRows = (ventasVendedorQuery.data?.vendedores || []).filter((r) => {
    const q = ventasVendedorFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.vendedor_nombre || '').toLowerCase().includes(q) ||
      String(r.sucursal_nombre || '').toLowerCase().includes(q) ||
      String(r.placas || []).toLowerCase().includes(q)
    );
  });
  const ventasSucursalRows = (ventasSucursalQuery.data?.sucursales || []).filter((r) => {
    const q = ventasSucursalFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.sucursal_nombre || '').toLowerCase().includes(q) ||
      String(r.sucursal_codigo || '').toLowerCase().includes(q) ||
      String(r.placas || []).toLowerCase().includes(q)
    );
  });
  const balancePruebaRows = (balancePruebaQuery.data?.cuentas || []).filter((r) => {
    const q = balancePruebaFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.codigo || '').toLowerCase().includes(q) ||
      String(r.nombre || '').toLowerCase().includes(q) ||
      String(r.origenes || []).toLowerCase().includes(q)
    );
  });
  const balanceTerceroRows = (balanceTerceroQuery.data?.filas || []).filter((r) => {
    const q = balanceTerceroFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.codigo_cuenta || '').toLowerCase().includes(q) ||
      String(r.nombre_cuenta || '').toLowerCase().includes(q) ||
      String(r.tercero_documento || '').toLowerCase().includes(q) ||
      String(r.tercero_nombre || '').toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (configQuery.data) {
      setUvt(Number(configQuery.data.uvt_anual || 0));
      setTopeMinimo1001(readTopeFromConfig(configQuery.data.topes_por_formato_json, '1001'));
      setTopeMinimo1007(readTopeFromConfig(configQuery.data.topes_por_formato_json, '1007'));
      setVersionNormativa(configQuery.data.version_normativa || '');
      setMapeosDraft(
        (configQuery.data.mapeos || []).map((m) => ({
          id: m.id,
          formato: m.formato,
          cuenta_contable: m.cuenta_contable,
          concepto: m.concepto,
          categoria: m.categoria || '',
          saldo_a_reportar: m.saldo_a_reportar || 'saldo_final',
          activo: m.activo || 'si',
          source_rule: m.source_rule || null,
        })),
      );
    }
  }, [configQuery.data]);

  const addMapeo = () => {
    setMapeosDraft((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        formato: '1001',
        cuenta_contable: '',
        concepto: '',
        categoria: '',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: null,
      },
    ]);
  };

  const cargarPlantillaBase = () => {
    const template = [
      {
        id: `tpl-1001-ded-${Date.now()}`,
        formato: '1001',
        cuenta_contable: '513505',
        concepto: '5001',
        categoria: 'deducible',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule:
          'fuente:movimientos_caja|movimientos_tesoreria;categoria_egreso:proveedores|servicios_publicos|arriendo|mantenimiento|compra_inventario|nomina',
      },
      {
        id: `tpl-1001-node-${Date.now()}`,
        formato: '1001',
        cuenta_contable: '519595',
        concepto: '5002',
        categoria: 'no_deducible',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: 'fuente:movimientos_tesoreria;categoria_egreso:impuestos|ajuste_correccion|otros_gastos',
      },
      {
        id: `tpl-1007-ing-${Date.now()}`,
        formato: '1007',
        cuenta_contable: '413505',
        concepto: '4001',
        categoria: 'ingresos',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: 'fuente:vehiculos_proceso',
      },
      {
        id: `tpl-1007-dev-${Date.now()}`,
        formato: '1007',
        cuenta_contable: '417505',
        concepto: '4002',
        categoria: 'devoluciones',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: 'fuente:vehiculos_proceso;estado:rechazado',
      },
    ];
    setMapeosDraft(template);
    if (!Number.isFinite(uvt) || Number(uvt) <= 0) {
      setUvt(50000);
    }
    if (!versionNormativa.trim()) {
      setVersionNormativa(`plantilla-base-${anio}`);
    }
    setError(null);
    setMensaje('Plantilla base cargada. Revisa cuentas/conceptos y luego guarda.');
  };

  const removeMapeo = (id: string) => {
    setMapeosDraft((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMapeo = (id: string, patch: Partial<(typeof mapeosDraft)[number]>) => {
    setMapeosDraft((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const descargarArchivo = async (ejecucionId: string) => {
    try {
      const { blob, filename } = await exogenaApi.descargarArchivoEjecucion(ejecucionId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setError(null);
      setMensaje('Archivo descargado correctamente.');
    } catch (err: any) {
      setMensaje(null);
      setError(err?.message || 'No se pudo descargar el archivo.');
    }
  };

  const descargarOmitidos = async (ejecucionId: string) => {
    try {
      const { blob, filename } = await exogenaApi.descargarOmitidosEjecucion(ejecucionId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setError(null);
      setMensaje('Archivo de omitidos descargado correctamente.');
    } catch (err: any) {
      setMensaje(null);
      setError(err?.message || 'No se pudo descargar el archivo de omitidos.');
    }
  };

  const toggleValidacionesEjecucion = async (ejecucionId: string) => {
    if (expandedEjecucionId === ejecucionId) {
      setExpandedEjecucionId(null);
      return;
    }
    setExpandedEjecucionId(ejecucionId);
    if (validacionesByEjecucion[ejecucionId]) return;
    try {
      setLoadingValidacionesEjecId(ejecucionId);
      const items = await exogenaApi.listarValidacionesEjecucion(ejecucionId);
      setValidacionesByEjecucion((prev) => ({ ...prev, [ejecucionId]: items }));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'No se pudieron cargar validaciones.');
    } finally {
      setLoadingValidacionesEjecId(null);
    }
  };

  const abrirRutaContable = (ruta: string) => {
    if (ruta === 'tab:cxp') {
      setActiveTab('cxp');
      return;
    }
    if (ruta === 'tab:cxc') {
      setActiveTab('cxc');
      return;
    }
    if (ruta === 'tab:ventas_vendedor') {
      setActiveTab('ventas_vendedor');
      return;
    }
    if (ruta === 'tab:ventas_sucursal') {
      setActiveTab('ventas_sucursal');
      return;
    }
    if (ruta === 'tab:estado_resultado') {
      setActiveTab('estado_resultado');
      return;
    }
    if (ruta === 'tab:estado_flujo') {
      setActiveTab('estado_flujo');
      return;
    }
    if (ruta === 'tab:estado_patrimonio') {
      setActiveTab('estado_patrimonio');
      return;
    }
    if (ruta === 'tab:estado_situacion') {
      setActiveTab('estado_situacion');
      return;
    }
    if (ruta === 'tab:balance_prueba') {
      setActiveTab('balance_prueba');
      return;
    }
    if (ruta === 'tab:balance_tercero') {
      setActiveTab('balance_tercero');
      return;
    }
    navigate(ruta);
  };

  return (
    <Layout title="Contador">
      <div className="space-y-6">
        <div className="card-corporate p-4">
          <div className="flex items-center gap-3 mb-3">
            <Database className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-900">Módulo Contador</h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn-chip ${activeTab === 'panel' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('panel')}
            >
              Centro contable
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'cxc' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('cxc')}
            >
              CxC por cliente
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'cxp' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('cxp')}
            >
              CxP por proveedor
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'ventas_vendedor' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('ventas_vendedor')}
            >
              Ventas por vendedor
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'ventas_sucursal' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('ventas_sucursal')}
            >
              Ventas por sucursal
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'estado_resultado' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('estado_resultado')}
            >
              Estado resultado
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'estado_flujo' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('estado_flujo')}
            >
              Estado flujo
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'estado_patrimonio' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('estado_patrimonio')}
            >
              Estado patrimonio
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'estado_situacion' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('estado_situacion')}
            >
              Estado situación
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'balance_prueba' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('balance_prueba')}
            >
              Balance prueba
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'balance_tercero' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('balance_tercero')}
            >
              Balance tercero
            </button>
            <button
              type="button"
              className={`btn-chip ${activeTab === 'exogena' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('exogena')}
            >
              Exógena
            </button>
          </div>
        </div>

        {activeTab === 'panel' && (
        <div className="card-corporate p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Centro contable (favoritos)</h3>
            <p className="text-sm text-slate-600">
              Esta vista centraliza reportes ya existentes sin duplicar logica. El objetivo es que contabilidad tenga
              un punto unico de trabajo.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {accesosRapidosContables.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{item.categoria}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{item.titulo}</p>
                <p className="mt-1 text-xs text-slate-600">{item.detalle}</p>
                <button
                  type="button"
                  className="mt-3 btn-chip inline-flex items-center gap-1"
                  onClick={() => abrirRutaContable(item.ruta)}
                >
                  Abrir
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">Backlog contable (fase 2)</p>
            <p className="text-xs text-amber-800 mt-1">
              Estos reportes se mantienen en cola para implementar sin afectar operacion actual:
            </p>
            <p className="text-xs text-amber-900 mt-2">{pendientesContables.join(' | ')}</p>
          </div>
        </div>
        )}

        {activeTab === 'cxc' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Cuentas por cobrar general por cliente</h3>
                <p className="text-sm text-slate-600">
                  Cartera operativa basada en tramites registrados y aun no pagados.
                </p>
              </div>
              <input
                className="input-corporate min-w-[220px]"
                placeholder="Buscar por cliente, doc o placa..."
                value={cxcFiltro}
                onChange={(e) => setCxcFiltro(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Clientes con saldo</p>
                <p className="text-2xl font-semibold text-slate-900">{cxcQuery.data?.resumen?.total_clientes || 0}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tramites pendientes</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {cxcQuery.data?.resumen?.total_tramites_pendientes || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Saldo total pendiente</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(cxcQuery.data?.resumen?.saldo_total_pendiente || 0))}
                </p>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Documento</th>
                    <th className="text-left px-3 py-2">Contacto</th>
                    <th className="text-left px-3 py-2">Sucursal</th>
                    <th className="text-left px-3 py-2">Tramites</th>
                    <th className="text-left px-3 py-2">Antiguedad max</th>
                    <th className="text-left px-3 py-2">Placas</th>
                    <th className="text-right px-3 py-2">Saldo pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {cxcQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        Cargando cartera...
                      </td>
                    </tr>
                  )}
                  {!cxcQuery.isLoading && cxcRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        No hay registros para el filtro actual.
                      </td>
                    </tr>
                  )}
                  {cxcRows.map((r) => (
                    <tr key={`${r.cliente_documento}-${r.cliente_nombre}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{r.cliente_nombre}</td>
                      <td className="px-3 py-2">{r.cliente_documento}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {[r.cliente_telefono, r.cliente_email].filter(Boolean).join(' | ') || '—'}
                      </td>
                      <td className="px-3 py-2">{r.sucursal_nombre || '—'}</td>
                      <td className="px-3 py-2">{r.tramites_pendientes}</td>
                      <td className="px-3 py-2">{r.antiguedad_max_dias} dias</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{(r.placas || []).join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCOP(Number(r.monto_pendiente_total || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'cxp' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Cuentas por pagar general por proveedor</h3>
                <p className="text-sm text-slate-600">
                  Basado en egresos de tesoreria. Si existe proveedor catalogado, se priorizan sus datos tributarios.
                </p>
              </div>
              <input
                className="input-corporate min-w-[240px]"
                placeholder="Buscar por proveedor, doc o comprobante..."
                value={cxpFiltro}
                onChange={(e) => setCxpFiltro(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Proveedores</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {cxpQuery.data?.resumen?.total_proveedores || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Movimientos egreso</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {cxpQuery.data?.resumen?.total_movimientos || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Valor total egresado</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(cxpQuery.data?.resumen?.valor_egresado_total || 0))}
                </p>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2">Proveedor</th>
                    <th className="text-left px-3 py-2">Documento</th>
                    <th className="text-left px-3 py-2">Origen</th>
                    <th className="text-left px-3 py-2">Contacto</th>
                    <th className="text-left px-3 py-2">Sucursal</th>
                    <th className="text-left px-3 py-2">Movs</th>
                    <th className="text-left px-3 py-2">Ult. egreso</th>
                    <th className="text-left px-3 py-2">Comprobantes</th>
                    <th className="text-right px-3 py-2">Total egresado</th>
                  </tr>
                </thead>
                <tbody>
                  {cxpQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={9}>
                        Cargando CxP...
                      </td>
                    </tr>
                  )}
                  {!cxpQuery.isLoading && cxpRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={9}>
                        No hay proveedores para el filtro actual.
                      </td>
                    </tr>
                  )}
                  {cxpRows.map((r) => (
                    <tr
                      key={`${r.proveedor_catalogo_id || 'manual'}-${r.proveedor_documento}-${r.proveedor_nombre}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{r.proveedor_nombre}</div>
                        <div className="text-xs text-slate-500">{r.concepto_retencion_dse || '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{r.proveedor_documento}</div>
                        <div className="text-xs text-slate-500">{r.proveedor_tipo_documento || '—'}</div>
                      </td>
                      <td className="px-3 py-2">{r.desde_catalogo ? 'Catalogo' : 'Manual'}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {[r.proveedor_telefono, r.proveedor_email].filter(Boolean).join(' | ') || '—'}
                      </td>
                      <td className="px-3 py-2">{r.sucursal_nombre || '—'}</td>
                      <td className="px-3 py-2">{r.movimientos_egreso}</td>
                      <td className="px-3 py-2">
                        {r.fecha_ultimo_egreso ? new Date(r.fecha_ultimo_egreso).toLocaleDateString('es-CO') : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {(r.referencias_comprobante || []).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCOP(Number(r.valor_egresado_total || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'ventas_sucursal' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Ventas por sucursal</h3>
                <p className="text-sm text-slate-600">
                  Consolidado por sede (centro operativo) con ticket promedio y metodos de pago.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={ventasSucursalDesde}
                  onChange={(e) => setVentasSucursalDesde(e.target.value)}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={ventasSucursalHasta}
                  onChange={(e) => setVentasSucursalHasta(e.target.value)}
                />
                <input
                  className="input-corporate min-w-[220px]"
                  placeholder="Buscar sucursal/codigo/placa..."
                  value={ventasSucursalFiltro}
                  onChange={(e) => setVentasSucursalFiltro(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Sucursales</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {ventasSucursalQuery.data?.resumen?.total_sucursales || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tramites vendidos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {ventasSucursalQuery.data?.resumen?.total_tramites || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total vendido</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(ventasSucursalQuery.data?.resumen?.total_vendido || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ticket promedio</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(ventasSucursalQuery.data?.resumen?.ticket_promedio_general || 0))}
                </p>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2">Sucursal</th>
                    <th className="text-left px-3 py-2">Codigo</th>
                    <th className="text-left px-3 py-2">Vendedores unicos</th>
                    <th className="text-left px-3 py-2">Tramites</th>
                    <th className="text-right px-3 py-2">Ticket prom.</th>
                    <th className="text-right px-3 py-2">Total vendido</th>
                    <th className="text-left px-3 py-2">Primera / ultima</th>
                    <th className="text-left px-3 py-2">Metodos de pago</th>
                    <th className="text-left px-3 py-2">Placas</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasSucursalQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={9}>
                        Cargando ventas por sucursal...
                      </td>
                    </tr>
                  )}
                  {!ventasSucursalQuery.isLoading && ventasSucursalRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={9}>
                        No hay datos para el rango o filtro actual.
                      </td>
                    </tr>
                  )}
                  {ventasSucursalRows.map((r) => (
                    <tr key={`${r.sucursal_id || 'sin'}-${r.sucursal_nombre}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{r.sucursal_nombre}</td>
                      <td className="px-3 py-2">{r.sucursal_codigo || '—'}</td>
                      <td className="px-3 py-2">{r.vendedores_unicos}</td>
                      <td className="px-3 py-2">{r.tramites_vendidos}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(Number(r.ticket_promedio || 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCOP(Number(r.total_vendido || 0))}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {(r.primera_venta_at ? new Date(r.primera_venta_at).toLocaleDateString('es-CO') : '—') +
                          ' / ' +
                          (r.ultima_venta_at ? new Date(r.ultima_venta_at).toLocaleDateString('es-CO') : '—')}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {Object.entries(r.metodos_pago || {})
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${formatCOP(Number(v || 0))}`)
                          .join(' | ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{(r.placas || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'ventas_vendedor' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Ventas por vendedor</h3>
                <p className="text-sm text-slate-600">
                  Ranking de cobros por usuario. Se toma `cobrado_por` y, si falta, `registrado_por`.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={ventasVendedorDesde}
                  onChange={(e) => setVentasVendedorDesde(e.target.value)}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={ventasVendedorHasta}
                  onChange={(e) => setVentasVendedorHasta(e.target.value)}
                />
                <input
                  className="input-corporate min-w-[220px]"
                  placeholder="Buscar vendedor/sede/placa..."
                  value={ventasVendedorFiltro}
                  onChange={(e) => setVentasVendedorFiltro(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Vendedores</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {ventasVendedorQuery.data?.resumen?.total_vendedores || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tramites vendidos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {ventasVendedorQuery.data?.resumen?.total_tramites || 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total vendido</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(ventasVendedorQuery.data?.resumen?.total_vendido || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ticket promedio</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(ventasVendedorQuery.data?.resumen?.ticket_promedio_general || 0))}
                </p>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2">Vendedor</th>
                    <th className="text-left px-3 py-2">Sucursal</th>
                    <th className="text-left px-3 py-2">Tramites</th>
                    <th className="text-right px-3 py-2">Ticket prom.</th>
                    <th className="text-right px-3 py-2">Total vendido</th>
                    <th className="text-left px-3 py-2">Primera / ultima</th>
                    <th className="text-left px-3 py-2">Metodos de pago</th>
                    <th className="text-left px-3 py-2">Placas</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasVendedorQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        Cargando ventas por vendedor...
                      </td>
                    </tr>
                  )}
                  {!ventasVendedorQuery.isLoading && ventasVendedorRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={8}>
                        No hay datos para el rango o filtro actual.
                      </td>
                    </tr>
                  )}
                  {ventasVendedorRows.map((r) => (
                    <tr key={`${r.vendedor_id || 'sin'}-${r.vendedor_nombre}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{r.vendedor_nombre}</td>
                      <td className="px-3 py-2">{r.sucursal_nombre || '—'}</td>
                      <td className="px-3 py-2">{r.tramites_vendidos}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(Number(r.ticket_promedio || 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCOP(Number(r.total_vendido || 0))}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {(r.primera_venta_at ? new Date(r.primera_venta_at).toLocaleDateString('es-CO') : '—') +
                          ' / ' +
                          (r.ultima_venta_at ? new Date(r.ultima_venta_at).toLocaleDateString('es-CO') : '—')}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {Object.entries(r.metodos_pago || {})
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${formatCOP(Number(v || 0))}`)
                          .join(' | ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{(r.placas || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'estado_resultado' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Estado de resultado integral</h3>
                <p className="text-sm text-slate-600">
                  Reporte gerencial preliminar con ingresos, gastos y resultado neto estimado por periodo.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoResultadoDesde}
                  onChange={(e) => setEstadoResultadoDesde(e.target.value)}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoResultadoHasta}
                  onChange={(e) => setEstadoResultadoHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ingresos netos oper.</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoResultadoQuery.data?.ingresos?.operacionales_netos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Gastos operacionales</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoResultadoQuery.data?.gastos?.gastos_operacionales_totales || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Resultado neto estimado</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoResultadoQuery.data?.resultado?.resultado_neto_estimado || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Margen neto %</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {Number(estadoResultadoQuery.data?.resultado?.margen_neto_pct || 0).toFixed(2)}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Ingresos</p>
                <p className="text-sm text-slate-700">
                  Operacionales brutos: {formatCOP(Number(estadoResultadoQuery.data?.ingresos?.operacionales_brutos || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Contra ingresos: {formatCOP(Number(estadoResultadoQuery.data?.ingresos?.contra_ingresos || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Otros ingresos: {formatCOP(Number(estadoResultadoQuery.data?.ingresos?.otros_ingresos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Gastos</p>
                <p className="text-sm text-slate-700">
                  Gastos caja: {formatCOP(Number(estadoResultadoQuery.data?.gastos?.gastos_caja || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Gastos tesorería: {formatCOP(Number(estadoResultadoQuery.data?.gastos?.gastos_tesoreria || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Resultado antes de impuestos: {formatCOP(Number(estadoResultadoQuery.data?.resultado?.resultado_antes_impuestos || 0))}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Alcance del reporte</p>
              {(estadoResultadoQuery.data?.notas || []).map((n, idx) => (
                <p key={idx} className="text-xs text-amber-800 mt-1">
                  - {n}
                </p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'estado_flujo' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Estado de flujo de efectivo</h3>
                <p className="text-sm text-slate-600">
                  Flujo gerencial preliminar por actividades de operación, inversión y financiación.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoFlujoDesde}
                  onChange={(e) => setEstadoFlujoDesde(e.target.value)}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoFlujoHasta}
                  onChange={(e) => setEstadoFlujoHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Saldo inicial</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoFlujoQuery.data?.saldos?.saldo_inicial || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Variación neta</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoFlujoQuery.data?.saldos?.variacion_neta || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Saldo final</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoFlujoQuery.data?.saldos?.saldo_final || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Conciliación</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {estadoFlujoQuery.data?.conciliacion?.conciliacion_ok ? 'OK' : 'Revisar'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Operación</p>
                <p className="text-sm text-slate-700">
                  Entradas: {formatCOP(Number(estadoFlujoQuery.data?.operacion?.entradas || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Salidas: {formatCOP(Number(estadoFlujoQuery.data?.operacion?.salidas || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Neto: {formatCOP(Number(estadoFlujoQuery.data?.operacion?.neto || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Inversión</p>
                <p className="text-sm text-slate-700">
                  Entradas: {formatCOP(Number(estadoFlujoQuery.data?.inversion?.entradas || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Salidas: {formatCOP(Number(estadoFlujoQuery.data?.inversion?.salidas || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Neto: {formatCOP(Number(estadoFlujoQuery.data?.inversion?.neto || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Financiación</p>
                <p className="text-sm text-slate-700">
                  Entradas: {formatCOP(Number(estadoFlujoQuery.data?.financiacion?.entradas || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Salidas: {formatCOP(Number(estadoFlujoQuery.data?.financiacion?.salidas || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Neto: {formatCOP(Number(estadoFlujoQuery.data?.financiacion?.neto || 0))}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900 mb-2">Control y conciliación</p>
              <p className="text-sm text-slate-700">
                Traslados internos caja→tesorería: {formatCOP(Number(estadoFlujoQuery.data?.internos?.traslados_caja_tesoreria || 0))}
              </p>
              <p className="text-sm text-slate-700">
                Saldo inicial + flujos: {formatCOP(Number(estadoFlujoQuery.data?.conciliacion?.saldo_inicial_mas_flujos || 0))}
              </p>
              <p className="text-sm text-slate-700">
                Saldo final real: {formatCOP(Number(estadoFlujoQuery.data?.conciliacion?.saldo_final_real || 0))}
              </p>
              <p className="text-sm text-slate-700">
                Diferencia: {formatCOP(Number(estadoFlujoQuery.data?.conciliacion?.diferencia_conciliacion || 0))}
              </p>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Alcance del reporte</p>
              {(estadoFlujoQuery.data?.notas || []).map((n, idx) => (
                <p key={idx} className="text-xs text-amber-800 mt-1">
                  - {n}
                </p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'estado_patrimonio' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Estado de cambios en el patrimonio</h3>
                <p className="text-sm text-slate-600">
                  Reporte gerencial preliminar de patrimonio inicial, movimientos del periodo y patrimonio final.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoPatrimonioDesde}
                  onChange={(e) => setEstadoPatrimonioDesde(e.target.value)}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoPatrimonioHasta}
                  onChange={(e) => setEstadoPatrimonioHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Patrimonio inicial</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoPatrimonioQuery.data?.patrimonio?.patrimonio_inicial_estimado || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Patrimonio final estimado</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoPatrimonioQuery.data?.patrimonio?.patrimonio_final_estimado || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Patrimonio final real</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoPatrimonioQuery.data?.patrimonio?.patrimonio_final_real || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Conciliación</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {estadoPatrimonioQuery.data?.conciliacion?.conciliacion_ok ? 'OK' : 'Revisar'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Movimientos del periodo</p>
                <p className="text-sm text-slate-700">
                  Resultado neto estimado: {formatCOP(Number(estadoPatrimonioQuery.data?.movimientos?.resultado_neto_estimado_periodo || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Aportes de socios: {formatCOP(Number(estadoPatrimonioQuery.data?.movimientos?.aportes_socios || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Retiros de socios: {formatCOP(Number(estadoPatrimonioQuery.data?.movimientos?.retiros_socios || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Ajustes patrimoniales netos: {formatCOP(Number(estadoPatrimonioQuery.data?.movimientos?.ajustes_patrimoniales_netos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Control y conciliación</p>
                <p className="text-sm text-slate-700">
                  Patrimonio inicial + cambios: {formatCOP(Number(estadoPatrimonioQuery.data?.conciliacion?.patrimonio_inicial_mas_cambios || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Patrimonio final real: {formatCOP(Number(estadoPatrimonioQuery.data?.conciliacion?.patrimonio_final_real || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  Diferencia conciliación: {formatCOP(Number(estadoPatrimonioQuery.data?.conciliacion?.diferencia_conciliacion || 0))}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Alcance del reporte</p>
              {(estadoPatrimonioQuery.data?.notas || []).map((n, idx) => (
                <p key={idx} className="text-xs text-amber-800 mt-1">
                  - {n}
                </p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'estado_situacion' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Estado de situación financiera</h3>
                <p className="text-sm text-slate-600">
                  Versión gerencial preliminar para control interno, con corte por fecha.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500">Fecha corte</span>
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoSituacionCorte}
                  onChange={(e) => setEstadoSituacionCorte(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total activos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoSituacionQuery.data?.activos?.total_activos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total pasivos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoSituacionQuery.data?.pasivos?.total_pasivos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Patrimonio estimado</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(estadoSituacionQuery.data?.patrimonio?.patrimonio_estimado || 0))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Activos</p>
                <p className="text-sm text-slate-700">
                  Efectivo equivalente: {formatCOP(Number(estadoSituacionQuery.data?.activos?.efectivo_equivalente || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  CxC operativa: {formatCOP(Number(estadoSituacionQuery.data?.activos?.cxc_operativa || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Pasivos</p>
                <p className="text-sm text-slate-700">
                  CxP proveedores: {formatCOP(Number(estadoSituacionQuery.data?.pasivos?.cxp_proveedores || 0))}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  * CxP formal quedará automatizado cuando se implemente el módulo de obligaciones por pagar.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Alcance del reporte</p>
              {(estadoSituacionQuery.data?.notas || []).map((n, idx) => (
                <p key={idx} className="text-xs text-amber-800 mt-1">
                  - {n}
                </p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'balance_prueba' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Balance de prueba general</h3>
                <p className="text-sm text-slate-600">
                  Reporte gerencial preliminar de debitos y creditos por cuenta de control.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={balancePruebaCorte}
                  onChange={(e) => setBalancePruebaCorte(e.target.value)}
                />
                <input
                  className="input-corporate min-w-[220px]"
                  placeholder="Buscar por codigo, cuenta u origen..."
                  value={balancePruebaFiltro}
                  onChange={(e) => setBalancePruebaFiltro(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total débitos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(balancePruebaQuery.data?.resumen?.total_debitos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total créditos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(balancePruebaQuery.data?.resumen?.total_creditos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Diferencia</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(balancePruebaQuery.data?.resumen?.diferencia_debito_credito || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Cuadre</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {balancePruebaQuery.data?.resumen?.cuadre_ok ? 'OK' : 'Revisar'}
                </p>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2">Código</th>
                    <th className="text-left px-3 py-2">Cuenta</th>
                    <th className="text-left px-3 py-2">Naturaleza</th>
                    <th className="text-right px-3 py-2">Débito</th>
                    <th className="text-right px-3 py-2">Crédito</th>
                    <th className="text-right px-3 py-2">Saldo</th>
                    <th className="text-left px-3 py-2">Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {balancePruebaQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        Cargando balance de prueba...
                      </td>
                    </tr>
                  )}
                  {!balancePruebaQuery.isLoading && balancePruebaRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        No hay cuentas para el corte o filtro seleccionado.
                      </td>
                    </tr>
                  )}
                  {balancePruebaRows.map((r) => (
                    <tr key={`${r.codigo}-${r.nombre}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{r.codigo}</td>
                      <td className="px-3 py-2">{r.nombre}</td>
                      <td className="px-3 py-2">{r.naturaleza}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(Number(r.debito || 0))}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(Number(r.credito || 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCOP(Number(r.saldo || 0))}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{(r.origenes || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Alcance del balance</p>
              {(balancePruebaQuery.data?.notas || []).map((n, idx) => (
                <p key={idx} className="text-xs text-amber-800 mt-1">
                  - {n}
                </p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'balance_tercero' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Balance de prueba por tercero</h3>
                <p className="text-sm text-slate-600">
                  Reporte gerencial preliminar por cuenta y tercero, para trazabilidad de movimientos.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input-corporate"
                  value={balanceTerceroCorte}
                  onChange={(e) => setBalanceTerceroCorte(e.target.value)}
                />
                <input
                  className="input-corporate min-w-[260px]"
                  placeholder="Buscar por cuenta, documento o tercero..."
                  value={balanceTerceroFiltro}
                  onChange={(e) => setBalanceTerceroFiltro(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total débitos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(balanceTerceroQuery.data?.resumen?.total_debitos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total créditos</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(balanceTerceroQuery.data?.resumen?.total_creditos || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Diferencia</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {formatCOP(Number(balanceTerceroQuery.data?.resumen?.diferencia_debito_credito || 0))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Filas</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {balanceTerceroQuery.data?.resumen?.total_filas || 0}
                </p>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2">Cuenta</th>
                    <th className="text-left px-3 py-2">Tercero</th>
                    <th className="text-left px-3 py-2">Documento</th>
                    <th className="text-right px-3 py-2">Débito</th>
                    <th className="text-right px-3 py-2">Crédito</th>
                    <th className="text-right px-3 py-2">Saldo</th>
                    <th className="text-left px-3 py-2">Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceTerceroQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        Cargando balance por tercero...
                      </td>
                    </tr>
                  )}
                  {!balanceTerceroQuery.isLoading && balanceTerceroRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        No hay filas para el corte o filtro seleccionado.
                      </td>
                    </tr>
                  )}
                  {balanceTerceroRows.map((r) => (
                    <tr
                      key={`${r.codigo_cuenta}-${r.tercero_tipo_documento}-${r.tercero_documento}-${r.tercero_nombre}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{r.codigo_cuenta}</div>
                        <div className="text-xs text-slate-500">{r.nombre_cuenta}</div>
                      </td>
                      <td className="px-3 py-2">{r.tercero_nombre}</td>
                      <td className="px-3 py-2">
                        <div>{r.tercero_documento}</div>
                        <div className="text-xs text-slate-500">{r.tercero_tipo_documento}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{formatCOP(Number(r.debito || 0))}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(Number(r.credito || 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCOP(Number(r.saldo || 0))}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{(r.origenes || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Alcance del reporte</p>
              {(balanceTerceroQuery.data?.notas || []).map((n, idx) => (
                <p key={idx} className="text-xs text-amber-800 mt-1">
                  - {n}
                </p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'exogena' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Año gravable</span>
                <input
                  className="input-corporate"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  maxLength={4}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">UVT anual</span>
                <input
                  type="number"
                  className="input-corporate"
                  value={uvt}
                  onChange={(e) => setUvt(Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Versión normativa</span>
                <input
                  className="input-corporate"
                  value={versionNormativa}
                  onChange={(e) => setVersionNormativa(e.target.value)}
                  placeholder="ej. resolucion-2026-v1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Tope mín. 1001</span>
                <input
                  type="number"
                  className="input-corporate"
                  min={0}
                  value={topeMinimo1001}
                  onChange={(e) => setTopeMinimo1001(Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Tope mín. 1007</span>
                <input
                  type="number"
                  className="input-corporate"
                  min={0}
                  value={topeMinimo1007}
                  onChange={(e) => setTopeMinimo1007(Number(e.target.value || 0))}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Modo exportación</span>
                <select
                  className="input-corporate text-sm"
                  value={modoExportacion}
                  onChange={(e) => setModoExportacion(e.target.value as 'consolidado' | 'detalle')}
                >
                  <option value="consolidado">Consolidado</option>
                  <option value="detalle">Detalle</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-corporate-primary px-4"
                onClick={() => guardarMutation.mutate()}
                disabled={guardarMutation.isLoading}
              >
                Guardar configuración
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4"
                onClick={() => validarMutation.mutate()}
                disabled={validarMutation.isLoading}
              >
                Validar
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={cargarPlantillaBase}
              >
                <Plus className="w-4 h-4" />
                Plantilla base 1001/1007
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={() => exportarMutation.mutate('1001')}
                disabled={exportarMutation.isLoading}
              >
                <FileUp className="w-4 h-4" />
                Exportar 1001
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={() => exportarMutation.mutate('1007')}
                disabled={exportarMutation.isLoading}
              >
                <FileUp className="w-4 h-4" />
                Exportar 1007
              </button>
            </div>

            {mensaje && <p className="text-sm text-emerald-700">{mensaje}</p>}
            {error && (
              <p className="text-sm text-red-700 inline-flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {error}
              </p>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">Mapeos ({mapeos.length})</h3>
                <button type="button" className="btn-chip inline-flex items-center gap-1" onClick={addMapeo}>
                  <Plus className="w-3.5 h-3.5" />
                  Agregar mapeo
                </button>
              </div>
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="font-medium text-slate-700">Ayudante de reglas (`source_rule`)</p>
                <p className="mt-1">
                  Sintaxis: <code>clave:valor1|valor2;otra_clave:valor</code>
                </p>
                <p className="mt-1">
                  Claves soportadas: <code>fuente</code>, <code>categoria_egreso</code>, <code>estado</code>,{' '}
                  <code>metodo_pago</code>, <code>tipo</code>, <code>concepto_contains</code>.
                </p>
                <p className="mt-1">
                  Ejemplo 1001 deducible:{' '}
                  <code>
                    fuente:movimientos_caja|movimientos_tesoreria;categoria_egreso:proveedores|servicios_publicos|arriendo
                  </code>
                </p>
                <p className="mt-1">
                  Ejemplo 1001 no deducible:{' '}
                  <code>fuente:movimientos_tesoreria;categoria_egreso:impuestos|otros_gastos|ajuste_correccion</code>
                </p>
                <p className="mt-1">
                  Ejemplo 1007 devoluciones: <code>fuente:vehiculos_proceso;estado:rechazado</code>
                </p>
              </div>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2">Formato</th>
                      <th className="text-left px-3 py-2">Cuenta</th>
                      <th className="text-left px-3 py-2">Concepto</th>
                      <th className="text-left px-3 py-2">Categoría</th>
                      <th className="text-left px-3 py-2">Saldo</th>
                      <th className="text-left px-3 py-2">Regla</th>
                      <th className="text-left px-3 py-2">Activo</th>
                      <th className="text-left px-3 py-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeos.map((m) => (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <select
                            className="input-corporate"
                            value={m.formato}
                            onChange={(e) => updateMapeo(m.id, { formato: e.target.value })}
                          >
                            <option value="1001">1001</option>
                            <option value="1007">1007</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-corporate"
                            value={m.cuenta_contable}
                            onChange={(e) => updateMapeo(m.id, { cuenta_contable: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-corporate"
                            value={m.concepto}
                            onChange={(e) => updateMapeo(m.id, { concepto: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-corporate"
                            value={m.categoria || ''}
                            onChange={(e) => updateMapeo(m.id, { categoria: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input-corporate"
                            value={m.saldo_a_reportar || 'saldo_final'}
                            onChange={(e) => updateMapeo(m.id, { saldo_a_reportar: e.target.value })}
                          >
                            <option value="saldo_final">Saldo final</option>
                            <option value="saldo_debito">Saldo débito</option>
                            <option value="saldo_credito">Saldo crédito</option>
                            <option value="debito_menos_credito">Débito - Crédito</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 min-w-[280px]">
                          <input
                            className="input-corporate"
                            value={m.source_rule || ''}
                            onChange={(e) => updateMapeo(m.id, { source_rule: e.target.value })}
                            placeholder="ej: fuente:movimientos_tesoreria;categoria_egreso:impuestos|otros_gastos"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input-corporate"
                            value={m.activo || 'si'}
                            onChange={(e) => updateMapeo(m.id, { activo: e.target.value })}
                          >
                            <option value="si">si</option>
                            <option value="no">no</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="btn-chip text-red-600 inline-flex items-center gap-1"
                            onClick={() => removeMapeo(m.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {mapeos.length === 0 && (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={8}>
                          Sin mapeos en este año.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Historial de ejecuciones ({ejecuciones.length})
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Vista</span>
                  <select
                    className="input-corporate text-sm"
                    value={historialFiltro}
                    onChange={(e) => setHistorialFiltro(e.target.value as 'success' | 'error' | 'all')}
                  >
                    <option value="success">Solo success</option>
                    <option value="error">Solo error</option>
                    <option value="all">Todos</option>
                  </select>
                </div>
              </div>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Formato</th>
                      <th className="text-left px-3 py-2">Estado</th>
                      <th className="text-left px-3 py-2">Filas</th>
                      <th className="text-left px-3 py-2">Fuentes</th>
                      <th className="text-left px-3 py-2">Omitidos</th>
                      <th className="text-left px-3 py-2">Errores</th>
                      <th className="text-left px-3 py-2">Validaciones</th>
                      <th className="text-left px-3 py-2">Archivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ejecuciones.map((e) => {
                      const items = validacionesByEjecucion[e.id] || [];
                      const byCode = items.reduce((acc, v) => {
                        const key = String(v.codigo || 'SIN_CODIGO');
                        acc[key] = (acc[key] || 0) + 1;
                        return acc;
                      }, {} as { [key: string]: number });
                      const resumen = (Object.entries(byCode) as Array<[string, number]>)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6)
                        .map(([code, n]) => `${code}: ${n}`)
                        .join(' | ');
                      return (
                        <Fragment key={e.id}>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 py-2">{new Date(e.created_at).toLocaleString('es-CO')}</td>
                        <td className="px-3 py-2">{e.formato}</td>
                        <td className="px-3 py-2">{e.status}</td>
                        <td className="px-3 py-2">{e.total_rows}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {(e.fuente_resumen_json || [])
                            .map((f) => `${f.fuente}: ${f.rows}`)
                            .join(' | ') || '—'}
                        </td>
                        <td className="px-3 py-2">
                          {(e.omitidos_rows || 0) > 0 ? (
                            <button
                              type="button"
                              className="btn-chip inline-flex items-center gap-1"
                              onClick={() => descargarOmitidos(e.id)}
                            >
                              <Download className="w-3.5 h-3.5" />
                              {e.omitidos_rows}
                            </button>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{e.total_errors}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="btn-chip inline-flex items-center gap-1"
                            onClick={() => toggleValidacionesEjecucion(e.id)}
                          >
                            {expandedEjecucionId === e.id ? 'Ocultar' : 'Ver'}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          {e.archivo_relpath ? (
                            <button
                              type="button"
                              className="btn-chip inline-flex items-center gap-1"
                              onClick={() => descargarArchivo(e.id)}
                            >
                              <Download className="w-3.5 h-3.5" />
                              Descargar
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                      {expandedEjecucionId === e.id && (
                        <tr className="border-t border-slate-100 bg-slate-50">
                          <td className="px-3 py-3 text-xs text-slate-700" colSpan={9}>
                            {loadingValidacionesEjecId === e.id ? (
                              <span>Cargando validaciones...</span>
                            ) : (
                              <div className="space-y-1">
                                <p>
                                  <strong>Total validaciones:</strong> {items.length}
                                </p>
                                <p>
                                  <strong>Resumen por código:</strong> {resumen || 'Sin validaciones.'}
                                </p>
                                {items.slice(0, 5).map((v) => (
                                  <p key={v.id}>
                                    - [{String(v.severidad || '').toUpperCase()}] {v.codigo}: {v.mensaje}
                                  </p>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                        </Fragment>
                      );
                    })}
                    {ejecuciones.length === 0 && (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={9}>
                          No hay ejecuciones para el filtro actual.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
