import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileUp,
  Landmark,
  Plus,
  Receipt,
  Scale,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
  AlertTriangle,
  ClipboardCheck,
  Settings2,
  Eye,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { exogenaApi, type ExogenaValidarResponse } from '../api/exogena';
import { reportesApi } from '../api/reportes';
import { obligacionesApi, type ObligacionProveedor } from '../api/obligaciones';
import { cajasApi } from '../api/cajas';
import { tesoreriaApi } from '../api/tesoreria';
import { downloadXlsx } from '../utils/downloadXlsx';
import { formatCOP } from '../utils/formatNumber';
import { useToast } from '../contexts/ToastContext';

type ContadorTab =
  | 'panel'
  | 'cxc'
  | 'cxp'
  | 'obligaciones'
  | 'gastos'
  | 'ventas_vendedor'
  | 'ventas_sucursal'
  | 'estado_resultado'
  | 'estado_flujo'
  | 'estado_patrimonio'
  | 'estado_situacion'
  | 'balance_prueba'
  | 'balance_tercero'
  | 'exogena';

type ContadorZona = 'operacion' | 'cierre' | 'maestros';
type ExogenaPaso = 1 | 2 | 3 | 4;

const ICONO_POR_CATEGORIA: Record<string, LucideIcon> = {
  Cartera: Wallet,
  Ventas: BarChart3,
  Estados: Scale,
  Impuestos: Receipt,
  Cierre: FileSpreadsheet,
  Maestros: Building2,
};

const ICONO_POR_ACCESO: Record<string, LucideIcon> = {
  'cxc-clientes': Wallet,
  'cxp-proveedores': Users,
  'obligaciones-cxp': Receipt,
  'gastos-periodo': Receipt,
  'ventas-cliente': Users,
  'ventas-sucursal': Building2,
  'ventas-vendedor': BarChart3,
  'estado-resultado': Landmark,
  'estado-flujo': Landmark,
  'estado-patrimonio': BookOpen,
  'estado-situacion': Scale,
  'balance-prueba': Scale,
  'balance-tercero': Users,
  'impuestos-detallados': Receipt,
  'exogena-cierre': FileSpreadsheet,
  'terceros-rut': Building2,
  'cierres-caja': Receipt,
};

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
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<ContadorTab>('panel');
  const [exogenaPaso, setExogenaPaso] = useState<ExogenaPaso>(1);
  const [periodoDesde, setPeriodoDesde] = useState(firstDayOfMonthLocalDate());
  const [periodoHasta, setPeriodoHasta] = useState(currentLocalDate());
  const [fechaCorte, setFechaCorte] = useState(currentLocalDate());
  const [anio, setAnio] = useState(currentYear());
  const [uvt, setUvt] = useState<number>(0);
  const [topeMinimo1001, setTopeMinimo1001] = useState<number>(0);
  const [topeMinimo1007, setTopeMinimo1007] = useState<number>(0);
  const [versionNormativa, setVersionNormativa] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validacionResult, setValidacionResult] = useState<ExogenaValidarResponse | null>(null);
  const [historialFiltro, setHistorialFiltro] = useState<'success' | 'error' | 'all'>('success');
  const [historialPagina, setHistorialPagina] = useState(1);
  const [mapeosAbiertos, setMapeosAbiertos] = useState(false);
  const [modoExportacion, setModoExportacion] = useState<'consolidado' | 'detalle'>('consolidado');
  const [formatoExportActivo, setFormatoExportActivo] = useState<'1001' | '1007' | null>(null);
  const [expandedEjecucionId, setExpandedEjecucionId] = useState<string | null>(null);
  const [validacionesByEjecucion, setValidacionesByEjecucion] = useState<Record<string, any[]>>({});
  const [loadingValidacionesEjecId, setLoadingValidacionesEjecId] = useState<string | null>(null);
  const [cxcFiltro, setCxcFiltro] = useState('');
  const [cxpFiltro, setCxpFiltro] = useState('');
  const [gastosFiltro, setGastosFiltro] = useState('');
  const [gastosDesde, setGastosDesde] = useState(firstDayOfMonthLocalDate());
  const [gastosHasta, setGastosHasta] = useState(currentLocalDate());
  const [gastosOrigen, setGastosOrigen] = useState<'todos' | 'caja' | 'tesoreria'>('todos');
  const [gastosIncluirDevoluciones, setGastosIncluirDevoluciones] = useState(true);
  const [gastoDetalleId, setGastoDetalleId] = useState<string | null>(null);
  const [gastoDocPreview, setGastoDocPreview] = useState<{
    blobUrl: string;
    title: string;
    fileName: string;
    mime: string;
  } | null>(null);
  const [cxcDetalleDoc, setCxcDetalleDoc] = useState<string | null>(null);
  const [cxcDetalleNombre, setCxcDetalleNombre] = useState<string | null>(null);
  const [obligacionesFiltro, setObligacionesFiltro] = useState('');
  const [obligacionesSoloPendientes, setObligacionesSoloPendientes] = useState(true);
  const [oblForm, setOblForm] = useState({
    proveedor_nombre: '',
    proveedor_documento: '',
    numero_documento: '',
    fecha_emision: currentLocalDate(),
    fecha_vencimiento: '',
    concepto: '',
    valor_total: '',
  });
  const [oblPagoId, setOblPagoId] = useState<string | null>(null);
  const [oblPagoMonto, setOblPagoMonto] = useState('');
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

  const cerrarGastoDocPreview = () => {
    setGastoDocPreview((prev) => {
      if (prev?.blobUrl) {
        try {
          URL.revokeObjectURL(prev.blobUrl);
        } catch {
          /* ignore */
        }
      }
      return null;
    });
  };

  const abrirGastoDocPreview = (next: {
    blobUrl: string;
    title: string;
    fileName: string;
    mime?: string | null;
  }) => {
    setGastoDocPreview((prev) => {
      if (prev?.blobUrl && prev.blobUrl !== next.blobUrl) {
        try {
          URL.revokeObjectURL(prev.blobUrl);
        } catch {
          /* ignore */
        }
      }
      return {
        blobUrl: next.blobUrl,
        title: next.title,
        fileName: next.fileName,
        mime: String(next.mime || 'application/pdf').split(';')[0].trim() || 'application/pdf',
      };
    });
  };

  const abrirFacturaSoporteGasto = async (g: {
    id: string;
    origen: string;
    factura_soporte_nombre?: string | null;
  }) => {
    try {
      const { blob, filename, mime } = await reportesApi.obtenerFacturaSoporteGastoBlob(
        g.origen,
        g.id,
      );
      if (!blob || blob.size <= 0) throw new Error('Archivo vacío');
      abrirGastoDocPreview({
        blobUrl: URL.createObjectURL(blob),
        title: g.factura_soporte_nombre || filename || 'Factura de compra',
        fileName: filename,
        mime,
      });
    } catch (err: any) {
      showToast(
        'error',
        'Factura',
        err?.message || 'No se pudo abrir la factura de compra adjunta.',
      );
    }
  };

  const accesosRapidosContables: Array<{
    id: string;
    titulo: string;
    detalle: string;
    ruta: string;
    categoria: string;
    zona: ContadorZona;
  }> = [
    {
      id: 'cxc-clientes',
      titulo: 'Cuentas por cobrar',
      detalle: 'Cartera operativa por cliente, aging y Excel.',
      ruta: 'tab:cxc',
      categoria: 'Cartera',
      zona: 'operacion',
    },
    {
      id: 'cxp-proveedores',
      titulo: 'Egresos a proveedores',
      detalle: 'Pagos ya egresados (tesorería). No es CxP por pagar.',
      ruta: 'tab:cxp',
      categoria: 'Cartera',
      zona: 'operacion',
    },
    {
      id: 'obligaciones-cxp',
      titulo: 'Obligaciones / compras',
      detalle: 'Facturas por pagar (CxP real). Alta y seguimiento de saldo.',
      ruta: 'tab:obligaciones',
      categoria: 'Cartera',
      zona: 'operacion',
    },
    {
      id: 'gastos-periodo',
      titulo: 'Gastos del periodo',
      detalle: 'Detalle de egresos de caja y tesorería. Solo consulta + Excel.',
      ruta: 'tab:gastos',
      categoria: 'Cartera',
      zona: 'operacion',
    },
    {
      id: 'ventas-cliente',
      titulo: 'Ventas por cliente',
      detalle: 'Detalle operativo de trámites para filtrar y exportar.',
      ruta: '/reportes?seccion=detalle',
      categoria: 'Ventas',
      zona: 'operacion',
    },
    {
      id: 'ventas-sucursal',
      titulo: 'Ventas por sucursal',
      detalle: 'Consolidado por sede. CSV disponible.',
      ruta: 'tab:ventas_sucursal',
      categoria: 'Ventas',
      zona: 'operacion',
    },
    {
      id: 'ventas-vendedor',
      titulo: 'Ventas por vendedor',
      detalle: 'Ranking y ticket promedio por usuario de cobro. Excel.',
      ruta: 'tab:ventas_vendedor',
      categoria: 'Ventas',
      zona: 'operacion',
    },
    {
      id: 'estado-resultado',
      titulo: 'Estado de resultado',
      detalle: 'Ingresos, gastos y resultado neto estimado (gerencial). Excel.',
      ruta: 'tab:estado_resultado',
      categoria: 'Estados',
      zona: 'operacion',
    },
    {
      id: 'estado-flujo',
      titulo: 'Flujo de efectivo',
      detalle: 'Operación, inversión y financiación (gerencial). Excel.',
      ruta: 'tab:estado_flujo',
      categoria: 'Estados',
      zona: 'operacion',
    },
    {
      id: 'estado-patrimonio',
      titulo: 'Cambios en el patrimonio',
      detalle: 'Movimiento patrimonial con conciliación gerencial. Excel.',
      ruta: 'tab:estado_patrimonio',
      categoria: 'Estados',
      zona: 'operacion',
    },
    {
      id: 'estado-situacion',
      titulo: 'Situación financiera',
      detalle: 'Vista gerencial con corte por fecha. Excel.',
      ruta: 'tab:estado_situacion',
      categoria: 'Estados',
      zona: 'operacion',
    },
    {
      id: 'balance-prueba',
      titulo: 'Balance de prueba',
      detalle: 'Débitos y créditos por cuenta. Excel.',
      ruta: 'tab:balance_prueba',
      categoria: 'Estados',
      zona: 'operacion',
    },
    {
      id: 'balance-tercero',
      titulo: 'Balance por tercero',
      detalle: 'Cuenta y tercero para trazabilidad. Excel.',
      ruta: 'tab:balance_tercero',
      categoria: 'Estados',
      zona: 'operacion',
    },
    {
      id: 'impuestos-detallados',
      titulo: 'Impuestos detallados',
      detalle: 'IVA causado y provisionado por periodo.',
      ruta: '/reportes?seccion=provisiones',
      categoria: 'Impuestos',
      zona: 'operacion',
    },
    {
      id: 'exogena-cierre',
      titulo: 'Exógena DIAN 1001 / 1007',
      detalle: 'Configurar, validar y exportar el cierre anual.',
      ruta: 'tab:exogena',
      categoria: 'Cierre',
      zona: 'cierre',
    },
    {
      id: 'terceros-rut',
      titulo: 'Catálogo de terceros (RUT)',
      detalle: 'Datos fiscales base para exógena y soporte.',
      ruta: '/proveedores-catalogo',
      categoria: 'Maestros',
      zona: 'maestros',
    },
    {
      id: 'cierres-caja',
      titulo: 'Recibos y cierres de caja',
      detalle: 'Historial de caja con evidencia de auditoría.',
      ruta: '/reportes?seccion=cierres',
      categoria: 'Maestros',
      zona: 'maestros',
    },
  ];
  const accesosPorZona = useMemo(
    () => ({
      operacion: accesosRapidosContables.filter((a) => a.zona === 'operacion'),
      cierre: accesosRapidosContables.filter((a) => a.zona === 'cierre'),
      maestros: accesosRapidosContables.filter((a) => a.zona === 'maestros'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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
  const gastosQuery = useQuery({
    queryKey: [
      'reportes-gastos-periodo',
      gastosDesde,
      gastosHasta,
      gastosOrigen,
      gastosIncluirDevoluciones,
    ],
    queryFn: () =>
      reportesApi.getGastosPeriodo({
        fechaInicio: gastosDesde,
        fechaFin: gastosHasta,
        origen: gastosOrigen === 'todos' ? undefined : gastosOrigen,
        incluirDevoluciones: gastosIncluirDevoluciones,
        limit: 2000,
      }),
    staleTime: 60000,
    refetchInterval: 120000,
    enabled: activeTab === 'gastos' && !!gastosDesde && !!gastosHasta,
  });
  const obligacionesQuery = useQuery({
    queryKey: ['obligaciones-list', obligacionesFiltro, obligacionesSoloPendientes],
    queryFn: () =>
      obligacionesApi.listar({
        q: obligacionesFiltro.trim() || undefined,
        soloPendientes: obligacionesSoloPendientes,
        limit: 500,
      }),
    staleTime: 30000,
    enabled: activeTab === 'obligaciones' || activeTab === 'panel' || activeTab === 'estado_situacion',
  });
  const cierreQuery = useQuery({
    queryKey: ['reportes-cierre-periodo', periodoDesde, periodoHasta],
    queryFn: () =>
      reportesApi.getCierrePeriodoResumen({
        fechaInicio: periodoDesde,
        fechaFin: periodoHasta,
      }),
    staleTime: 60000,
    enabled: activeTab === 'panel' && !!periodoDesde && !!periodoHasta,
  });
  const cxcDetalleQuery = useQuery({
    queryKey: ['reportes-cxc-detalle', cxcDetalleDoc, cxcDetalleNombre, fechaCorte],
    queryFn: () =>
      reportesApi.getCxcClienteDetalle({
        clienteDocumento: cxcDetalleDoc || '',
        clienteNombre: cxcDetalleNombre || undefined,
        fechaCorte,
        limit: 200,
      }),
    enabled: !!cxcDetalleDoc,
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
      setValidacionResult(res);
      setMensaje(`Validación: ${res.total_errors} errores, ${res.total_warnings} advertencias.`);
      queryClient.invalidateQueries({ queryKey: ['exogena-ejecuciones', anio] });
      const items = res.items || [];
      const tieneTerceros = items.some((it) =>
        ['DOC_TYPE_INVALID', 'DOC_NUMBER_INVALID', 'CITY_MISSING', 'ADDRESS_MISSING'].includes(it.codigo),
      );
      const tieneMapeo = items.some((it) => it.codigo === 'MAPEO_EMPTY' || it.codigo === 'PARAMS_MISSING');
      if ((res.total_errors || 0) === 0) {
        setExogenaPaso(tieneTerceros ? 3 : 4);
      } else if (tieneMapeo) {
        setExogenaPaso(1);
      } else if (tieneTerceros) {
        setExogenaPaso(3);
      } else {
        setExogenaPaso(2);
      }
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo validar.');
    },
  });

  const clonarMutation = useMutation({
    mutationFn: (reemplazar_destino: boolean) => {
      const origen = String(Number(anio) - 1);
      return exogenaApi.clonarConfig({
        anio_origen: origen,
        anio_destino: anio,
        reemplazar_destino,
      });
    },
    onSuccess: (res, reemplazar) => {
      setError(null);
      setMensaje(
        reemplazar
          ? `Mapeos de ${Number(anio) - 1} reemplazados en ${anio} (${res.mapeos?.length || 0}). Capture UVT y topes del año ${anio} antes de exportar.`
          : `Mapeos de ${Number(anio) - 1} copiados a ${anio} (${res.mapeos?.length || 0}). Capture UVT y topes del año ${anio} (no se clonan).`,
      );
      setMapeosAbiertos(true);
      queryClient.invalidateQueries({ queryKey: ['exogena-config', anio] });
      setExogenaPaso(1);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409) {
        const ok = window.confirm(
          `${typeof detail === 'string' ? detail : `Ya existen mapeos para ${anio}.`}\n\n¿Reemplazar solo los mapeos? La UVT y los topes de ${anio} no se modifican.`,
        );
        if (ok) {
          clonarMutation.mutate(true);
          return;
        }
      }
      setMensaje(null);
      setError(typeof detail === 'string' ? detail : 'No se pudieron clonar los mapeos.');
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
      setMensaje('Configuración guardada. Siguiente: validar.');
      queryClient.invalidateQueries({ queryKey: ['exogena-config', anio] });
      setExogenaPaso(2);
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo guardar configuración.');
    },
  });

  const exportarMutation = useMutation({
    mutationFn: (formato: '1001' | '1007') => {
      setFormatoExportActivo(formato);
      return exogenaApi.exportar({ anio, formato, include_warnings: true, modo_exportacion: modoExportacion });
    },
    onSuccess: (res) => {
      setError(null);
      if (res.formato === '1001' || res.formato === '1007') {
        setFormatoExportActivo(res.formato);
      }
      setMensaje(
        res.ok
          ? `Exportación ${res.formato} (${modoExportacion}) OK (${res.total_rows} filas, omitidos: ${res.omitidos_rows || 0}).`
          : `Exportación ${res.formato} bloqueada: ${res.error_message || 'revisar validaciones'}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['exogena-ejecuciones', anio] });
      if (res.ok) setExogenaPaso(4);
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo exportar.');
    },
  });

  const mapeos = mapeosDraft;
  const HISTORIAL_PAGE_SIZE = 8;
  const ejecuciones = (ejecucionesQuery.data || []).filter((e) => {
    if (historialFiltro === 'all') return true;
    return (e.status || '').toLowerCase() === historialFiltro;
  });
  const historialTotalPaginas = Math.max(1, Math.ceil(ejecuciones.length / HISTORIAL_PAGE_SIZE));
  const historialPaginaActual = Math.min(historialPagina, historialTotalPaginas);
  const ejecucionesPagina = ejecuciones.slice(
    (historialPaginaActual - 1) * HISTORIAL_PAGE_SIZE,
    historialPaginaActual * HISTORIAL_PAGE_SIZE,
  );
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
  const gastosRows = (gastosQuery.data?.items || []).filter((r) => {
    const q = gastosFiltro.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.concepto || '').toLowerCase().includes(q) ||
      String(r.beneficiario || '').toLowerCase().includes(q) ||
      String(r.documento || '').toLowerCase().includes(q) ||
      String(r.categoria || '').toLowerCase().includes(q) ||
      String(r.sucursal_nombre || '').toLowerCase().includes(q) ||
      String(r.numero_comprobante || '').toLowerCase().includes(q)
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

  const exogenaCompletitud = useMemo(() => {
    const activos = (mapeosDraft || []).filter((m) => (m.activo || 'si').toLowerCase() === 'si');
    const mapeos1001 = activos.filter((m) => m.formato === '1001').length;
    const mapeos1007 = activos.filter((m) => m.formato === '1007').length;
    const ejecs = ejecucionesQuery.data || [];
    const lastByFormato = (formato: string) =>
      [...ejecs]
        .filter((e) => e.formato === formato)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const last1001 = lastByFormato('1001');
    const last1007 = lastByFormato('1007');
    const labelExport = (e?: { status?: string; created_at?: string }) => {
      if (!e) return 'Sin exportación';
      const st = (e.status || '').toLowerCase();
      const when = e.created_at ? new Date(e.created_at).toLocaleDateString('es-CO') : '';
      if (st === 'success') return `OK${when ? ` (${when})` : ''}`;
      if (st === 'error') return `Error${when ? ` (${when})` : ''}`;
      return `${st || '—'}${when ? ` (${when})` : ''}`;
    };
    return {
      mapeos1001,
      mapeos1007,
      export1001: labelExport(last1001),
      export1007: labelExport(last1007),
      export1001Ok: (last1001?.status || '').toLowerCase() === 'success',
      export1007Ok: (last1007?.status || '').toLowerCase() === 'success',
    };
  }, [mapeosDraft, ejecucionesQuery.data]);

  const validacionChecklist = useMemo(() => {
    const items = validacionResult?.items || [];
    const counts = new Map<string, { codigo: string; severidad: string; mensaje: string; count: number }>();
    for (const it of items) {
      const key = `${it.severidad}|${it.codigo}|${it.mensaje}`;
      const prev = counts.get(key);
      if (prev) prev.count += 1;
      else counts.set(key, { codigo: it.codigo, severidad: it.severidad, mensaje: it.mensaje, count: 1 });
    }
    return [...counts.values()].sort((a, b) => {
      if (a.severidad !== b.severidad) return a.severidad === 'error' ? -1 : 1;
      return b.count - a.count;
    });
  }, [validacionResult]);

  const hintCorreccionTercero = (codigo: string): string | null => {
    if (['CITY_MISSING', 'ADDRESS_MISSING'].includes(codigo)) {
      return 'Complete ciudad/dirección en Proveedores. Al validar de nuevo se toma del catálogo aunque el egreso antiguo no lo tenga.';
    }
    if (['DOC_TYPE_INVALID', 'DOC_NUMBER_INVALID'].includes(codigo)) {
      return 'Corregir tipo o número de documento del tercero en Proveedores / Caja / Tesorería.';
    }
    if (codigo === 'MAPEO_EMPTY' || codigo === 'PARAMS_MISSING') {
      return 'Falta configuración anual o mapeos activos.';
    }
    return null;
  };

  const accionChecklist = (
    codigo: string,
  ): { label: string; onClick: () => void } | null => {
    if (codigo === 'MAPEO_EMPTY' || codigo === 'PARAMS_MISSING') {
      return {
        label: `Copiar mapeos ${Number(anio) - 1}`,
        onClick: () => {
          setExogenaPaso(1);
          clonarMutation.mutate(false);
        },
      };
    }
    if (['DOC_TYPE_INVALID', 'DOC_NUMBER_INVALID', 'CITY_MISSING', 'ADDRESS_MISSING'].includes(codigo)) {
      return {
        label: 'Ir a Proveedores',
        onClick: () => navigate('/proveedores-catalogo'),
      };
    }
    return null;
  };

  const aplicarPeriodoGlobal = () => {
    setVentasVendedorDesde(periodoDesde);
    setVentasVendedorHasta(periodoHasta);
    setVentasSucursalDesde(periodoDesde);
    setVentasSucursalHasta(periodoHasta);
    setGastosDesde(periodoDesde);
    setGastosHasta(periodoHasta);
    setEstadoResultadoDesde(periodoDesde);
    setEstadoResultadoHasta(periodoHasta);
    setEstadoFlujoDesde(periodoDesde);
    setEstadoFlujoHasta(periodoHasta);
    setEstadoPatrimonioDesde(periodoDesde);
    setEstadoPatrimonioHasta(periodoHasta);
    setEstadoSituacionCorte(fechaCorte);
    setBalancePruebaCorte(fechaCorte);
    setBalanceTerceroCorte(fechaCorte);
  };

  const intentActivo: 'inicio' | 'operacion' | 'cierre' =
    activeTab === 'panel' ? 'inicio' : activeTab === 'exogena' ? 'cierre' : 'operacion';

  const tabsOperacion: Array<{ id: ContadorTab; label: string }> = [
    { id: 'cxc', label: 'CxC' },
    { id: 'obligaciones', label: 'Obligaciones' },
    { id: 'cxp', label: 'Egresos prov.' },
    { id: 'gastos', label: 'Gastos' },
    { id: 'ventas_vendedor', label: 'Ventas vendedor' },
    { id: 'ventas_sucursal', label: 'Ventas sucursal' },
    { id: 'estado_resultado', label: 'Resultado' },
    { id: 'estado_flujo', label: 'Flujo' },
    { id: 'estado_patrimonio', label: 'Patrimonio' },
    { id: 'estado_situacion', label: 'Situación' },
    { id: 'balance_prueba', label: 'Balance' },
    { id: 'balance_tercero', label: 'Balance tercero' },
  ];

  const exogenaSemaforo = useMemo(() => {
    const tieneMapeos = exogenaCompletitud.mapeos1001 > 0 && exogenaCompletitud.mapeos1007 > 0;
    if (!tieneMapeos) {
      return { estado: 'bloqueado' as const, label: 'Bloqueado: faltan mapeos 1001/1007' };
    }
    if (!validacionResult) {
      return { estado: 'revisar' as const, label: 'Pendiente validar' };
    }
    if ((validacionResult.total_errors || 0) > 0) {
      return {
        estado: 'bloqueado' as const,
        label: `Bloqueado: ${validacionResult.total_errors} error(es)`,
      };
    }
    if ((validacionResult.total_warnings || 0) > 0) {
      return {
        estado: 'revisar' as const,
        label: `Listo con ${validacionResult.total_warnings} advertencia(s)`,
      };
    }
    return { estado: 'listo' as const, label: 'Listo para exportar 1001/1007' };
  }, [exogenaCompletitud.mapeos1001, exogenaCompletitud.mapeos1007, validacionResult]);

  const descargarCxcCsv = () => {
    const agingLabel = (t?: string) =>
      t === '31_60' ? '31-60' : t === '61_90' ? '61-90' : t === 'mas_90' ? '+90' : '0-30';
    downloadXlsx(
      `cxc_${currentLocalDate()}.xlsx`,
      [
        'Cliente',
        'Documento',
        'Telefono',
        'Email',
        'Sucursal',
        'Tramites',
        'Antiguedad_max_dias',
        'Tramo',
        'Placas',
        'Saldo_pendiente',
      ],
      [
        ...cxcRows.map((r) => [
          r.cliente_nombre,
          r.cliente_documento,
          r.cliente_telefono || '',
          r.cliente_email || '',
          r.sucursal_nombre || '',
          r.tramites_pendientes,
          r.antiguedad_max_dias,
          agingLabel(r.aging_tramo),
          (r.placas || []).join('; '),
          Number(r.monto_pendiente_total || 0),
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          '',
          cxcQuery.data?.resumen?.total_tramites_pendientes || 0,
          '',
          `Clientes: ${cxcQuery.data?.resumen?.total_clientes || 0}`,
          '',
          Number(cxcQuery.data?.resumen?.saldo_total_pendiente || 0),
        ],
      ],
      'CxC',
    );
  };

  const descargarCxpCsv = () => {
    downloadXlsx(
      `egresos_proveedores_${currentLocalDate()}.xlsx`,
      [
        'Proveedor',
        'Documento',
        'Tipo_doc',
        'Origen',
        'Telefono',
        'Email',
        'Sucursal',
        'Movimientos',
        'Ultimo_egreso',
        'Comprobantes',
        'Total_egresado',
      ],
      [
        ...cxpRows.map((r) => [
          r.proveedor_nombre,
          r.proveedor_documento,
          r.proveedor_tipo_documento || '',
          r.desde_catalogo ? 'Catalogo' : 'Manual',
          r.proveedor_telefono || '',
          r.proveedor_email || '',
          r.sucursal_nombre || '',
          r.movimientos_egreso,
          r.fecha_ultimo_egreso ? new Date(r.fecha_ultimo_egreso).toLocaleDateString('es-CO') : '',
          (r.referencias_comprobante || []).join('; '),
          Number(r.valor_egresado_total || 0),
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          '',
          '',
          '',
          cxpQuery.data?.resumen?.total_movimientos || 0,
          `Proveedores: ${cxpQuery.data?.resumen?.total_proveedores || 0}`,
          '',
          Number(cxpQuery.data?.resumen?.valor_egresado_total || 0),
        ],
      ],
      'EgresosProv',
    );
  };

  const descargarBalancePruebaCsv = () => {
    downloadXlsx(
      `balance_prueba_${balancePruebaCorte || currentLocalDate()}.xlsx`,
      ['Codigo', 'Cuenta', 'Naturaleza', 'Debito', 'Credito', 'Saldo', 'Origen'],
      [
        ...balancePruebaRows.map((r) => [
          r.codigo,
          r.nombre,
          r.naturaleza || '',
          Number(r.debito || 0),
          Number(r.credito || 0),
          Number(r.saldo || 0),
          (r.origenes || []).join('; '),
        ]),
        [
          'TOTAL',
          '',
          '',
          Number(balancePruebaQuery.data?.resumen?.total_debitos || 0),
          Number(balancePruebaQuery.data?.resumen?.total_creditos || 0),
          Number(balancePruebaQuery.data?.resumen?.diferencia_debito_credito || 0),
          balancePruebaQuery.data?.resumen?.cuadre_ok ? 'Cuadre OK' : 'Revisar',
        ],
      ],
    );
  };

  const descargarBalanceTerceroCsv = () => {
    downloadXlsx(
      `balance_tercero_${balanceTerceroCorte || currentLocalDate()}.xlsx`,
      [
        'Codigo_cuenta',
        'Nombre_cuenta',
        'Tercero',
        'Documento',
        'Tipo_doc',
        'Debito',
        'Credito',
        'Saldo',
        'Origen',
      ],
      [
        ...balanceTerceroRows.map((r) => [
          r.codigo_cuenta,
          r.nombre_cuenta,
          r.tercero_nombre,
          r.tercero_documento,
          r.tercero_tipo_documento || '',
          Number(r.debito || 0),
          Number(r.credito || 0),
          Number(r.saldo || 0),
          (r.origenes || []).join('; '),
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          '',
          Number(balanceTerceroQuery.data?.resumen?.total_debitos || 0),
          Number(balanceTerceroQuery.data?.resumen?.total_creditos || 0),
          Number(balanceTerceroQuery.data?.resumen?.diferencia_debito_credito || 0),
          `Filas: ${balanceTerceroQuery.data?.resumen?.total_filas ?? balanceTerceroRows.length}`,
        ],
      ],
    );
  };

  const descargarEstadoResultadoCsv = () => {
    const d = estadoResultadoQuery.data;
    downloadXlsx(
      `estado_resultado_${estadoResultadoDesde}_${estadoResultadoHasta}.xlsx`,
      ['Concepto', 'Valor'],
      [
        ['Periodo_desde', estadoResultadoDesde],
        ['Periodo_hasta', estadoResultadoHasta],
        ['Ingresos_operacionales_brutos', Number(d?.ingresos?.operacionales_brutos || 0)],
        ['Contra_ingresos', Number(d?.ingresos?.contra_ingresos || 0)],
        ['Otros_ingresos', Number(d?.ingresos?.otros_ingresos || 0)],
        ['Ingresos_operacionales_netos', Number(d?.ingresos?.operacionales_netos || 0)],
        ['Gastos_caja', Number(d?.gastos?.gastos_caja || 0)],
        ['Gastos_tesoreria', Number(d?.gastos?.gastos_tesoreria || 0)],
        ['Gastos_operacionales_totales', Number(d?.gastos?.gastos_operacionales_totales || 0)],
        ['Resultado_antes_impuestos', Number(d?.resultado?.resultado_antes_impuestos || 0)],
        ['Resultado_neto_estimado', Number(d?.resultado?.resultado_neto_estimado || 0)],
        ['Margen_neto_pct', Number(d?.resultado?.margen_neto_pct || 0)],
        ...(d?.notas || []).map((n: string, i: number) => [`Nota_${i + 1}`, n]),
      ],
    );
  };

  const descargarVentasSucursalCsv = () => {
    downloadXlsx(
      `ventas_sucursal_${ventasSucursalDesde}_${ventasSucursalHasta}.xlsx`,
      [
        'Sucursal',
        'Codigo',
        'Vendedores_unicos',
        'Tramites',
        'Ticket_promedio',
        'Total_vendido',
        'Primera_venta',
        'Ultima_venta',
        'Metodos_pago',
        'Placas',
      ],
      [
        ...ventasSucursalRows.map((r) => [
          r.sucursal_nombre,
          r.sucursal_codigo || '',
          r.vendedores_unicos,
          r.tramites_vendidos,
          Number(r.ticket_promedio || 0),
          Number(r.total_vendido || 0),
          r.primera_venta_at ? new Date(r.primera_venta_at).toLocaleDateString('es-CO') : '',
          r.ultima_venta_at ? new Date(r.ultima_venta_at).toLocaleDateString('es-CO') : '',
          Object.entries(r.metodos_pago || {})
            .map(([k, v]) => `${k}:${Number(v || 0)}`)
            .join('; '),
          (r.placas || []).join('; '),
        ]),
        [
          'TOTAL',
          '',
          '',
          ventasSucursalQuery.data?.resumen?.total_tramites || 0,
          Number(ventasSucursalQuery.data?.resumen?.ticket_promedio_general || 0),
          Number(ventasSucursalQuery.data?.resumen?.total_vendido || 0),
          `Sucursales: ${ventasSucursalQuery.data?.resumen?.total_sucursales || 0}`,
          '',
          '',
          '',
        ],
      ],
    );
  };

  const descargarVentasVendedorCsv = () => {
    downloadXlsx(
      `ventas_vendedor_${ventasVendedorDesde}_${ventasVendedorHasta}.xlsx`,
      [
        'Vendedor',
        'Sucursal',
        'Tramites',
        'Ticket_promedio',
        'Total_vendido',
        'Primera_venta',
        'Ultima_venta',
        'Metodos_pago',
        'Placas',
      ],
      [
        ...ventasVendedorRows.map((r) => [
          r.vendedor_nombre,
          r.sucursal_nombre || '',
          r.tramites_vendidos,
          Number(r.ticket_promedio || 0),
          Number(r.total_vendido || 0),
          r.primera_venta_at ? new Date(r.primera_venta_at).toLocaleDateString('es-CO') : '',
          r.ultima_venta_at ? new Date(r.ultima_venta_at).toLocaleDateString('es-CO') : '',
          Object.entries(r.metodos_pago || {})
            .map(([k, v]) => `${k}:${Number(v || 0)}`)
            .join('; '),
          (r.placas || []).join('; '),
        ]),
        [
          'TOTAL',
          '',
          ventasVendedorQuery.data?.resumen?.total_tramites || 0,
          Number(ventasVendedorQuery.data?.resumen?.ticket_promedio_general || 0),
          Number(ventasVendedorQuery.data?.resumen?.total_vendido || 0),
          `Vendedores: ${ventasVendedorQuery.data?.resumen?.total_vendedores || 0}`,
          '',
          '',
          '',
        ],
      ],
    );
  };

  const descargarEstadoFlujoCsv = () => {
    const d = estadoFlujoQuery.data;
    downloadXlsx(
      `estado_flujo_${estadoFlujoDesde}_${estadoFlujoHasta}.xlsx`,
      ['Concepto', 'Valor'],
      [
        ['Periodo_desde', estadoFlujoDesde],
        ['Periodo_hasta', estadoFlujoHasta],
        ['Saldo_inicial', Number(d?.saldos?.saldo_inicial || 0)],
        ['Variacion_neta', Number(d?.saldos?.variacion_neta || 0)],
        ['Saldo_final', Number(d?.saldos?.saldo_final || 0)],
        ['Operacion_entradas', Number(d?.operacion?.entradas || 0)],
        ['Operacion_salidas', Number(d?.operacion?.salidas || 0)],
        ['Operacion_neto', Number(d?.operacion?.neto || 0)],
        ['Inversion_entradas', Number(d?.inversion?.entradas || 0)],
        ['Inversion_salidas', Number(d?.inversion?.salidas || 0)],
        ['Inversion_neto', Number(d?.inversion?.neto || 0)],
        ['Financiacion_entradas', Number(d?.financiacion?.entradas || 0)],
        ['Financiacion_salidas', Number(d?.financiacion?.salidas || 0)],
        ['Financiacion_neto', Number(d?.financiacion?.neto || 0)],
        ['Traslados_caja_tesoreria', Number(d?.internos?.traslados_caja_tesoreria || 0)],
        ['Diferencia_conciliacion', Number(d?.conciliacion?.diferencia_conciliacion || 0)],
        ['Conciliacion_ok', d?.conciliacion?.conciliacion_ok ? 'SI' : 'NO'],
        ...(d?.notas || []).map((n: string, i: number) => [`Nota_${i + 1}`, n]),
      ],
    );
  };

  const descargarEstadoPatrimonioCsv = () => {
    const d = estadoPatrimonioQuery.data;
    downloadXlsx(
      `estado_patrimonio_${estadoPatrimonioDesde}_${estadoPatrimonioHasta}.xlsx`,
      ['Concepto', 'Valor'],
      [
        ['Periodo_desde', estadoPatrimonioDesde],
        ['Periodo_hasta', estadoPatrimonioHasta],
        ['Patrimonio_inicial', Number(d?.patrimonio?.patrimonio_inicial_estimado || 0)],
        ['Patrimonio_final_estimado', Number(d?.patrimonio?.patrimonio_final_estimado || 0)],
        ['Patrimonio_final_real', Number(d?.patrimonio?.patrimonio_final_real || 0)],
        ['Resultado_neto_periodo', Number(d?.movimientos?.resultado_neto_estimado_periodo || 0)],
        ['Aportes_socios', Number(d?.movimientos?.aportes_socios || 0)],
        ['Retiros_socios', Number(d?.movimientos?.retiros_socios || 0)],
        ['Ajustes_patrimoniales_netos', Number(d?.movimientos?.ajustes_patrimoniales_netos || 0)],
        ['Diferencia_conciliacion', Number(d?.conciliacion?.diferencia_conciliacion || 0)],
        ['Conciliacion_ok', d?.conciliacion?.conciliacion_ok ? 'SI' : 'NO'],
        ...(d?.notas || []).map((n: string, i: number) => [`Nota_${i + 1}`, n]),
      ],
    );
  };

  const descargarEstadoSituacionCsv = () => {
    const d = estadoSituacionQuery.data;
    downloadXlsx(
      `estado_situacion_${estadoSituacionCorte || currentLocalDate()}.xlsx`,
      ['Concepto', 'Valor'],
      [
        ['Fecha_corte', estadoSituacionCorte],
        ['Efectivo_equivalente', Number(d?.activos?.efectivo_equivalente || 0)],
        ['CxC_operativa', Number(d?.activos?.cxc_operativa || 0)],
        ['Total_activos', Number(d?.activos?.total_activos || 0)],
        ['CxP_proveedores', Number(d?.pasivos?.cxp_proveedores || 0)],
        ['Total_pasivos', Number(d?.pasivos?.total_pasivos || 0)],
        ['Patrimonio_estimado', Number(d?.patrimonio?.patrimonio_estimado || 0)],
        ...(d?.notas || []).map((n: string, i: number) => [`Nota_${i + 1}`, n]),
      ],
    );
  };

  const descargarGastosCsv = () => {
    downloadXlsx(
      `gastos_${gastosDesde}_${gastosHasta}.xlsx`,
      [
        'Fecha',
        'Origen',
        'Clasificacion',
        'Tipo',
        'Categoria',
        'Concepto',
        'Beneficiario',
        'Documento',
        'Metodo_pago',
        'Sucursal',
        'Comprobante',
        'Monto',
      ],
      [
        ...gastosRows.map((r) => [
          r.fecha ? new Date(r.fecha).toLocaleString('es-CO') : '',
          r.origen,
          r.clasificacion,
          r.tipo,
          r.categoria || '',
          r.concepto,
          r.beneficiario || '',
          r.documento || '',
          r.metodo_pago || '',
          r.sucursal_nombre || '',
          r.numero_comprobante || '',
          Number(r.monto || 0),
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          '',
          `Movs: ${gastosRows.length}`,
          '',
          '',
          '',
          '',
          '',
          gastosRows.reduce((acc, r) => acc + Number(r.monto || 0), 0),
        ],
      ],
    );
  };

  useEffect(() => {
    setValidacionResult(null);
  }, [anio]);

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
    setMapeosAbiertos(true);
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
    setExogenaPaso(1);
    setMapeosAbiertos(true);
    setMensaje('Plantilla base cargada. Revisa cuentas/conceptos y pulsa Guardar y continuar.');
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
    if (ruta === 'tab:exogena') {
      setActiveTab('exogena');
      return;
    }
    if (ruta === 'tab:cxp') {
      setActiveTab('cxp');
      return;
    }
    if (ruta === 'tab:gastos') {
      setActiveTab('gastos');
      return;
    }
    if (ruta === 'tab:obligaciones') {
      setActiveTab('obligaciones');
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

  const renderAccesoCard = (
    item: (typeof accesosRapidosContables)[number],
    opts?: { featured?: boolean },
  ) => {
    const Icon = ICONO_POR_ACCESO[item.id] || ICONO_POR_CATEGORIA[item.categoria] || Database;
    return (
      <div
        key={item.id}
        className={`kpi-card p-4 flex flex-col h-full ${
          opts?.featured ? 'border-primary-200 bg-gradient-to-br from-primary-50/70 to-white' : ''
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
              opts?.featured ? 'bg-primary-100 border-primary-200' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <Icon className={`w-5 h-5 ${opts?.featured ? 'text-primary-700' : 'text-primary-600'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="kpi-label text-primary-600">{item.categoria}</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900 leading-snug">{item.titulo}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600 flex-1 leading-relaxed">{item.detalle}</p>
        <button
          type="button"
          className="mt-4 btn-corporate-muted w-full inline-flex items-center justify-center gap-1.5 text-xs"
          onClick={() => abrirRutaContable(item.ruta)}
        >
          Abrir
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  const renderZonaHeader = (opts: {
    paso: string;
    titulo: string;
    detalle: string;
    Icon: LucideIcon;
  }) => (
    <div className="flex items-start gap-3">
      <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
        <opts.Icon className="w-5 h-5 text-primary-600" />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">{opts.paso}</p>
        <h3 className="text-base font-semibold text-slate-900">{opts.titulo}</h3>
        <p className="text-xs text-slate-600 mt-0.5">{opts.detalle}</p>
      </div>
    </div>
  );

  const renderReporteHeader = (opts: {
    Icon: LucideIcon;
    titulo: string;
    detalle: string;
    actions?: ReactNode;
  }) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
          <opts.Icon className="w-5 h-5 text-primary-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{opts.titulo}</h3>
          <p className="text-sm text-slate-600 mt-0.5">{opts.detalle}</p>
        </div>
      </div>
      {opts.actions ? <div className="flex flex-wrap items-center gap-2">{opts.actions}</div> : null}
    </div>
  );

  const chipActivo = 'bg-primary-600 text-white border-primary-600 shadow-sm';
  const chipInactivo = 'text-slate-700';
  const pasoIcons: Record<ExogenaPaso, LucideIcon> = {
    1: Settings2,
    2: ClipboardCheck,
    3: AlertTriangle,
    4: FileUp,
  };

  return (
    <Layout title="Contador">
      <div className="space-y-6">
        <div className="module-hero space-y-4 mb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="module-hero-title mb-1">
                <Database className="w-7 h-7 text-primary-600" />
                Módulo Contador
              </h2>
              <p className="module-hero-subtitle">
                Control operativo e insumos para el contador. No es contabilidad NIIF oficial.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 shadow-sm">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">Periodo desde</span>
                <input
                  type="date"
                  className="input-corporate text-sm"
                  value={periodoDesde}
                  onChange={(e) => setPeriodoDesde(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">Periodo hasta</span>
                <input
                  type="date"
                  className="input-corporate text-sm"
                  value={periodoHasta}
                  onChange={(e) => setPeriodoHasta(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">Corte</span>
                <input
                  type="date"
                  className="input-corporate text-sm"
                  value={fechaCorte}
                  onChange={(e) => setFechaCorte(e.target.value)}
                />
              </label>
              <button type="button" className="btn-corporate-primary px-3 text-sm" onClick={aplicarPeriodoGlobal}>
                Aplicar a reportes
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn-chip px-4 py-2 ${intentActivo === 'inicio' ? chipActivo : chipInactivo}`}
              onClick={() => setActiveTab('panel')}
            >
              Inicio
            </button>
            <button
              type="button"
              className={`btn-chip px-4 py-2 ${intentActivo === 'operacion' ? chipActivo : chipInactivo}`}
              onClick={() => setActiveTab(activeTab === 'exogena' || activeTab === 'panel' ? 'cxc' : activeTab)}
            >
              Operación del periodo
            </button>
            <button
              type="button"
              className={`btn-chip px-4 py-2 ${intentActivo === 'cierre' ? chipActivo : chipInactivo}`}
              onClick={() => setActiveTab('exogena')}
            >
              Cierre / Exógena
            </button>
          </div>

          {intentActivo === 'operacion' && (
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              {tabsOperacion.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`btn-chip text-xs ${activeTab === t.id ? chipActivo : chipInactivo}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === 'panel' && (
          <div className="space-y-5">
            <div className="section-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">¿Qué quieres hacer?</h3>
                  <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                    Elige por intención. Los reportes son gerenciales (insumo Excel); la exógena es el cierre DIAN.
                  </p>
                </div>
                <span className="badge badge-info">Gerencial + DIAN</span>
              </div>
              <div className="rounded-xl border border-primary-100 bg-gradient-to-r from-primary-50/80 to-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">Alcance del módulo</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Insumo gerencial y operativo para el contador del CDA. <strong>No es contabilidad NIIF
                  oficial</strong>. CxC = cartera de trámites sin pago. Obligaciones = facturas por pagar.
                  Egresos proveedores = pagos ya ejecutados. Excel en reportes de operación; exógena DIAN en
                  su flujo.
                </p>
              </div>
            </div>

            <div className="section-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Cierre del periodo</h3>
                  <p className="text-sm text-slate-600">
                    Checklist calculado ({periodoDesde} → {periodoHasta}). Usa “Aplicar a reportes” en la
                    cabecera para cambiar el rango.
                  </p>
                </div>
                {cierreQuery.isFetching && (
                  <span className="text-xs text-slate-500">Actualizando…</span>
                )}
              </div>
              {cierreQuery.data && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="kpi-card p-3">
                      <p className="kpi-label">Ventas cobradas</p>
                      <p className="kpi-value text-xl">
                        {formatCOP(Number(cierreQuery.data.conciliacion.ventas_cobradas || 0))}
                      </p>
                    </div>
                    <div className="kpi-card p-3">
                      <p className="kpi-label">Gastos totales</p>
                      <p className="kpi-value text-xl">
                        {formatCOP(Number(cierreQuery.data.conciliacion.gastos_totales || 0))}
                      </p>
                    </div>
                    <div className="kpi-card p-3">
                      <p className="kpi-label">Resultado neto est.</p>
                      <p className="kpi-value text-xl">
                        {formatCOP(Number(cierreQuery.data.conciliacion.resultado_neto_estimado || 0))}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {cierreQuery.data.checklist.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition flex items-start justify-between gap-3"
                        onClick={() => {
                          if (item.tab === 'exogena') setActiveTab('exogena');
                          else setActiveTab(item.tab as ContadorTab);
                        }}
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                            {item.ok ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                            )}
                            {item.label}
                          </p>
                          <p className="text-xs text-slate-600 mt-1">{item.detalle}</p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {cierreQuery.isError && (
                <p className="text-sm text-red-700">No se pudo cargar el resumen de cierre.</p>
              )}
            </div>

            <div className="section-card p-5 sm:p-6 space-y-4">
              {renderZonaHeader({
                paso: 'Zona 1',
                titulo: 'Operación del periodo',
                detalle: 'Cartera, obligaciones, ventas y estados gerenciales.',
                Icon: BarChart3,
              })}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {accesosPorZona.operacion.map((item) => renderAccesoCard(item))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="section-card p-5 sm:p-6 space-y-4">
                {renderZonaHeader({
                  paso: 'Zona 2',
                  titulo: 'Cierre / impuestos',
                  detalle: 'Configurar → validar → corregir → exportar.',
                  Icon: FileSpreadsheet,
                })}
                <div className="grid grid-cols-1 gap-3">
                  {accesosPorZona.cierre.map((item) => renderAccesoCard(item, { featured: true }))}
                </div>
              </div>

              <div className="section-card p-5 sm:p-6 space-y-4">
                {renderZonaHeader({
                  paso: 'Zona 3',
                  titulo: 'Maestros y soporte',
                  detalle: 'Terceros y evidencia de caja para alimentar reportes.',
                  Icon: Building2,
                })}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                  {accesosPorZona.maestros.map((item) => renderAccesoCard(item))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cxc' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
            {renderReporteHeader({
              Icon: Wallet,
              titulo: 'Cuentas por cobrar',
              detalle:
                'Cartera operativa (corte actual): trámites registrados y aún no pagados. Clic en fila para detalle.',
              actions: (
                <>
                  <input
                    className="input-corporate min-w-[220px]"
                    placeholder="Buscar por cliente, doc o placa..."
                    value={cxcFiltro}
                    onChange={(e) => setCxcFiltro(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    onClick={descargarCxcCsv}
                    disabled={cxcQuery.isLoading || cxcRows.length === 0}
                  >
                    <Download className="w-4 h-4" />
                    Exportar Excel
                  </button>
                </>
              ),
            })}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Clientes con saldo</p>
                <p className="kpi-value text-2xl">{cxcQuery.data?.resumen?.total_clientes || 0}</p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Tramites pendientes</p>
                <p className="kpi-value text-2xl">
                  {cxcQuery.data?.resumen?.total_tramites_pendientes || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Saldo total pendiente</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(cxcQuery.data?.resumen?.saldo_total_pendiente || 0))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(
                [
                  ['0_30', '0-30 días'],
                  ['31_60', '31-60'],
                  ['61_90', '61-90'],
                  ['mas_90', '+90 días'],
                ] as const
              ).map(([key, label]) => {
                const bucket = cxcQuery.data?.resumen?.aging?.[key];
                return (
                  <div key={key} className="kpi-card p-3">
                    <p className="kpi-label">Aging {label}</p>
                    <p className="kpi-value text-lg">
                      {formatCOP(Number(bucket?.monto || 0))}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {bucket?.clientes || 0} cliente(s) · {bucket?.tramites || 0} trámite(s)
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Documento</th>
                    <th>Contacto</th>
                    <th>Sucursal</th>
                    <th>Trámites</th>
                    <th>Antigüedad max</th>
                    <th>Tramo</th>
                    <th>Placas</th>
                    <th className="table-enterprise-col-monto">Saldo pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {cxcQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={9}>
                        Cargando cartera...
                      </td>
                    </tr>
                  )}
                  {!cxcQuery.isLoading && cxcRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={9}>
                        No hay registros para el filtro actual.
                      </td>
                    </tr>
                  )}
                  {cxcRows.map((r) => (
                    <tr
                      key={`${r.cliente_documento}-${r.cliente_nombre}`}
                      className="cursor-pointer hover:bg-primary-50/40"
                      onClick={() => {
                        setCxcDetalleDoc(r.cliente_documento);
                        setCxcDetalleNombre(r.cliente_nombre);
                      }}
                    >
                      <td className="font-medium text-slate-900">{r.cliente_nombre}</td>
                      <td>{r.cliente_documento}</td>
                      <td className="text-slate-600">
                        {[r.cliente_telefono, r.cliente_email].filter(Boolean).join(' | ') || '—'}
                      </td>
                      <td>{r.sucursal_nombre || '—'}</td>
                      <td>{r.tramites_pendientes}</td>
                      <td>{r.antiguedad_max_dias} días</td>
                      <td>
                        <span className="badge badge-info">
                          {r.aging_tramo === 'mas_90'
                            ? '+90'
                            : r.aging_tramo === '61_90'
                              ? '61-90'
                              : r.aging_tramo === '31_60'
                                ? '31-60'
                                : '0-30'}
                        </span>
                      </td>
                      <td className="text-slate-600">{(r.placas || []).join(', ') || '—'}</td>
                      <td className="table-enterprise-col-monto font-semibold text-slate-900">
                        {formatCOP(Number(r.monto_pendiente_total || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {cxcDetalleDoc && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
                <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-auto p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Detalle CxC — {cxcDetalleQuery.data?.cliente_nombre || cxcDetalleNombre}
                      </h3>
                      <p className="text-sm text-slate-600">
                        Doc: {cxcDetalleDoc} · Saldo:{' '}
                        {formatCOP(Number(cxcDetalleQuery.data?.resumen?.saldo_pendiente || 0))}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-chip"
                      onClick={() => {
                        setCxcDetalleDoc(null);
                        setCxcDetalleNombre(null);
                      }}
                    >
                      Cerrar
                    </button>
                  </div>
                  <div className="table-shell">
                    <table className="table-enterprise min-w-full">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Placa</th>
                          <th>Tramo</th>
                          <th>Sucursal</th>
                          <th className="table-enterprise-col-monto">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cxcDetalleQuery.isLoading && (
                          <tr>
                            <td colSpan={5} className="text-slate-500">
                              Cargando trámites...
                            </td>
                          </tr>
                        )}
                        {(cxcDetalleQuery.data?.tramites || []).map((t) => (
                          <tr key={t.vehiculo_id}>
                            <td className="whitespace-nowrap">
                              {t.fecha_registro
                                ? new Date(t.fecha_registro).toLocaleDateString('es-CO')
                                : '—'}
                            </td>
                            <td>{t.placa || '—'}</td>
                            <td>{t.aging_tramo}</td>
                            <td>{t.sucursal_nombre || '—'}</td>
                            <td className="table-enterprise-col-monto">
                              {formatCOP(Number(t.total_cobrado || 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'cxp' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
            {renderReporteHeader({
              Icon: Users,
              titulo: 'Egresos a proveedores (pagados)',
              detalle:
                'Ya egresados desde tesorería. No es CxP por pagar — use la pestaña Obligaciones para facturas pendientes.',
              actions: (
                <>
                  <input
                    className="input-corporate min-w-[240px]"
                    placeholder="Buscar por proveedor, doc o comprobante..."
                    value={cxpFiltro}
                    onChange={(e) => setCxpFiltro(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    onClick={descargarCxpCsv}
                    disabled={cxpQuery.isLoading || cxpRows.length === 0}
                  >
                    <Download className="w-4 h-4" />
                    Exportar Excel
                  </button>
                </>
              ),
            })}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Proveedores</p>
                <p className="kpi-value text-2xl">
                  {cxpQuery.data?.resumen?.total_proveedores || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Movimientos egreso</p>
                <p className="kpi-value text-2xl">
                  {cxpQuery.data?.resumen?.total_movimientos || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Valor total egresado</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(cxpQuery.data?.resumen?.valor_egresado_total || 0))}
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Documento</th>
                    <th>Origen</th>
                    <th>Contacto</th>
                    <th>Sucursal</th>
                    <th>Movs</th>
                    <th>Últ. egreso</th>
                    <th>Comprobantes</th>
                    <th className="table-enterprise-col-monto">Total egresado</th>
                  </tr>
                </thead>
                <tbody>
                  {cxpQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={9}>
                        Cargando egresos a proveedores...
                      </td>
                    </tr>
                  )}
                  {!cxpQuery.isLoading && cxpRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={9}>
                        No hay egresos a proveedores para el filtro actual.
                      </td>
                    </tr>
                  )}
                  {cxpRows.map((r) => (
                    <tr
                      key={`${r.proveedor_catalogo_id || 'manual'}-${r.proveedor_documento}-${r.proveedor_nombre}`}
                    >
                      <td>
                        <div className="font-medium text-slate-900">{r.proveedor_nombre}</div>
                        <div className="text-xs text-slate-500">{r.concepto_retencion_dse || '—'}</div>
                      </td>
                      <td>
                        <div>{r.proveedor_documento}</div>
                        <div className="text-xs text-slate-500">{r.proveedor_tipo_documento || '—'}</div>
                      </td>
                      <td>
                        {r.desde_catalogo ? (
                          <button
                            type="button"
                            className="text-primary-700 hover:underline text-sm inline-flex items-center gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate('/proveedores-catalogo');
                            }}
                          >
                            Catálogo <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          'Manual'
                        )}
                      </td>
                      <td className="text-slate-600">
                        {[r.proveedor_telefono, r.proveedor_email].filter(Boolean).join(' | ') || '—'}
                      </td>
                      <td>{r.sucursal_nombre || '—'}</td>
                      <td>{r.movimientos_egreso}</td>
                      <td className="whitespace-nowrap">
                        {r.fecha_ultimo_egreso ? new Date(r.fecha_ultimo_egreso).toLocaleDateString('es-CO') : '—'}
                      </td>
                      <td className="text-slate-600">
                        {(r.referencias_comprobante || []).join(', ') || '—'}
                      </td>
                      <td className="table-enterprise-col-monto font-semibold text-slate-900">
                        {formatCOP(Number(r.valor_egresado_total || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'obligaciones' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
            {renderReporteHeader({
              Icon: Receipt,
              titulo: 'Obligaciones / facturas de compra',
              detalle:
                'CxP formal (crédito) — en estudio. Para el caso “ya pagué y luego llega la factura del almacén”, adjunte la factura al egreso en Tesorería; el contador la ve en Gastos.',
              actions: (
                <>
                  <input
                    className="input-corporate min-w-[200px]"
                    placeholder="Buscar proveedor, factura..."
                    value={obligacionesFiltro}
                    onChange={(e) => setObligacionesFiltro(e.target.value)}
                  />
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={obligacionesSoloPendientes}
                      onChange={(e) => setObligacionesSoloPendientes(e.target.checked)}
                    />
                    Solo pendientes
                  </label>
                  <button
                    type="button"
                    className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300"
                    disabled={(obligacionesQuery.data?.items || []).length === 0}
                    onClick={() => {
                      const rows = obligacionesQuery.data?.items || [];
                      downloadXlsx(
                        `obligaciones_${currentLocalDate()}.xlsx`,
                        [
                          'Proveedor',
                          'Documento',
                          'Factura',
                          'Emision',
                          'Vence',
                          'Estado',
                          'Concepto',
                          'Valor',
                          'Saldo',
                          'Tramo',
                        ],
                        rows.map((r) => [
                          r.proveedor_nombre,
                          r.proveedor_documento,
                          r.numero_documento,
                          r.fecha_emision,
                          r.fecha_vencimiento || '',
                          r.estado,
                          r.concepto,
                          Number(r.valor_total),
                          Number(r.saldo_pendiente),
                          r.tramo_vencimiento,
                        ]),
                        'Obligaciones',
                      );
                    }}
                  >
                    <Download className="w-4 h-4" />
                    Exportar Excel
                  </button>
                </>
              ),
            })}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Items</p>
                <p className="kpi-value text-2xl">
                  {obligacionesQuery.data?.resumen?.total_items || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Saldo pendiente</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(obligacionesQuery.data?.resumen?.saldo_pendiente_total || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Vencidas</p>
                <p className="kpi-value text-2xl">
                  {obligacionesQuery.data?.resumen?.vencidas_count || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Saldo vencido</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(obligacionesQuery.data?.resumen?.vencidas_saldo || 0))}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900">Registrar obligación</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  className="input-corporate"
                  placeholder="Proveedor"
                  value={oblForm.proveedor_nombre}
                  onChange={(e) => setOblForm((f) => ({ ...f, proveedor_nombre: e.target.value }))}
                />
                <input
                  className="input-corporate"
                  placeholder="NIT / documento"
                  value={oblForm.proveedor_documento}
                  onChange={(e) => setOblForm((f) => ({ ...f, proveedor_documento: e.target.value }))}
                />
                <input
                  className="input-corporate"
                  placeholder="Nº factura"
                  value={oblForm.numero_documento}
                  onChange={(e) => setOblForm((f) => ({ ...f, numero_documento: e.target.value }))}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={oblForm.fecha_emision}
                  onChange={(e) => setOblForm((f) => ({ ...f, fecha_emision: e.target.value }))}
                />
                <input
                  type="date"
                  className="input-corporate"
                  value={oblForm.fecha_vencimiento}
                  onChange={(e) => setOblForm((f) => ({ ...f, fecha_vencimiento: e.target.value }))}
                />
                <input
                  className="input-corporate"
                  placeholder="Valor total"
                  value={oblForm.valor_total}
                  onChange={(e) => setOblForm((f) => ({ ...f, valor_total: e.target.value }))}
                />
                <input
                  className="input-corporate md:col-span-2"
                  placeholder="Concepto"
                  value={oblForm.concepto}
                  onChange={(e) => setOblForm((f) => ({ ...f, concepto: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn-primary-solid inline-flex items-center justify-center gap-2"
                  onClick={async () => {
                    try {
                      await obligacionesApi.crear({
                        proveedor_nombre: oblForm.proveedor_nombre,
                        proveedor_documento: oblForm.proveedor_documento,
                        numero_documento: oblForm.numero_documento,
                        fecha_emision: oblForm.fecha_emision,
                        fecha_vencimiento: oblForm.fecha_vencimiento || null,
                        concepto: oblForm.concepto,
                        valor_total: Number(oblForm.valor_total),
                      });
                      setOblForm({
                        proveedor_nombre: '',
                        proveedor_documento: '',
                        numero_documento: '',
                        fecha_emision: currentLocalDate(),
                        fecha_vencimiento: '',
                        concepto: '',
                        valor_total: '',
                      });
                      setMensaje('Obligación registrada.');
                      setError(null);
                      await obligacionesQuery.refetch();
                    } catch (err: any) {
                      setMensaje(null);
                      setError(err?.response?.data?.detail || 'No se pudo crear la obligación.');
                    }
                  }}
                >
                  <Plus className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Factura</th>
                    <th>Emisión / vence</th>
                    <th>Estado</th>
                    <th>Concepto</th>
                    <th className="table-enterprise-col-monto">Saldo</th>
                    <th className="table-enterprise-col-actions">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {obligacionesQuery.isLoading && (
                    <tr>
                      <td colSpan={7} className="text-slate-500">
                        Cargando obligaciones...
                      </td>
                    </tr>
                  )}
                  {!obligacionesQuery.isLoading &&
                    (obligacionesQuery.data?.items || []).length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-slate-500">
                          Sin obligaciones para el filtro.
                        </td>
                      </tr>
                    )}
                  {(obligacionesQuery.data?.items || []).map((r: ObligacionProveedor) => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium text-slate-900">{r.proveedor_nombre}</div>
                        <div className="text-xs text-slate-500">{r.proveedor_documento}</div>
                      </td>
                      <td>{r.numero_documento}</td>
                      <td className="text-slate-600 whitespace-nowrap">
                        <div>{r.fecha_emision}</div>
                        <div className="text-xs">{r.fecha_vencimiento || 'Sin vencimiento'}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            r.tramo_vencimiento === 'vencida'
                              ? 'badge-danger'
                              : r.estado === 'pagada'
                                ? 'badge-success'
                                : 'badge-info'
                          }`}
                        >
                          {r.estado}
                          {r.tramo_vencimiento === 'vencida' ? ' · vencida' : ''}
                        </span>
                      </td>
                      <td className="max-w-[220px] truncate" title={r.concepto}>
                        {r.concepto}
                      </td>
                      <td className="table-enterprise-col-monto font-semibold">
                        {formatCOP(Number(r.saldo_pendiente))}
                      </td>
                      <td className="table-enterprise-col-actions">
                        {r.estado !== 'pagada' && r.estado !== 'anulada' && (
                          <button
                            type="button"
                            className="btn-chip"
                            onClick={() => {
                              setOblPagoId(r.id);
                              setOblPagoMonto(String(r.saldo_pendiente));
                            }}
                          >
                            Registrar pago
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {oblPagoId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
                <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4">
                  <h3 className="text-base font-semibold">Registrar pago / abono</h3>
                  <input
                    className="input-corporate"
                    type="number"
                    min={0}
                    value={oblPagoMonto}
                    onChange={(e) => setOblPagoMonto(e.target.value)}
                    placeholder="Monto"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-chip flex-1"
                      onClick={() => {
                        setOblPagoId(null);
                        setOblPagoMonto('');
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn-primary-solid flex-1"
                      onClick={async () => {
                        try {
                          await obligacionesApi.registrarPago(oblPagoId, {
                            monto: Number(oblPagoMonto),
                          });
                          setOblPagoId(null);
                          setOblPagoMonto('');
                          setMensaje('Pago registrado.');
                          await obligacionesQuery.refetch();
                        } catch (err: any) {
                          setError(err?.response?.data?.detail || 'No se pudo registrar el pago.');
                        }
                      }}
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'gastos' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
            {renderReporteHeader({
              Icon: Receipt,
              titulo: 'Gastos del periodo',
              detalle:
                'Egresos ejecutados. Si hay factura de compra adjunta al egreso, ábrala aquí (sin entrar a Tesorería).',
              actions: (
                <>
                  <input
                    type="date"
                    className="input-corporate"
                    value={gastosDesde}
                    onChange={(e) => setGastosDesde(e.target.value)}
                  />
                  <input
                    type="date"
                    className="input-corporate"
                    value={gastosHasta}
                    onChange={(e) => setGastosHasta(e.target.value)}
                  />
                  <select
                    className="input-corporate"
                    value={gastosOrigen}
                    onChange={(e) => setGastosOrigen(e.target.value as 'todos' | 'caja' | 'tesoreria')}
                  >
                    <option value="todos">Origen: todos</option>
                    <option value="caja">Solo caja</option>
                    <option value="tesoreria">Solo tesorería</option>
                  </select>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={gastosIncluirDevoluciones}
                      onChange={(e) => setGastosIncluirDevoluciones(e.target.checked)}
                    />
                    Incluir devoluciones
                  </label>
                  <input
                    className="input-corporate min-w-[200px]"
                    placeholder="Buscar concepto, beneficiario..."
                    value={gastosFiltro}
                    onChange={(e) => setGastosFiltro(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    onClick={descargarGastosCsv}
                    disabled={gastosQuery.isLoading || gastosRows.length === 0}
                  >
                    <Download className="w-4 h-4" />
                    Exportar Excel
                  </button>
                </>
              ),
            })}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Movimientos</p>
                <p className="kpi-value text-2xl">{gastosQuery.data?.resumen?.total_movimientos || 0}</p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total caja</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(gastosQuery.data?.resumen?.total_caja || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total tesorería</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(gastosQuery.data?.resumen?.total_tesoreria || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total egresado</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(gastosQuery.data?.resumen?.total_egresado || 0))}
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Origen</th>
                    <th>Clasif.</th>
                    <th>Categoría</th>
                    <th>Concepto</th>
                    <th>Beneficiario</th>
                    <th>Sucursal</th>
                    <th>Método</th>
                    <th>Factura</th>
                    <th className="table-enterprise-col-monto">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {gastosQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={10}>
                        Cargando gastos...
                      </td>
                    </tr>
                  )}
                  {!gastosQuery.isLoading && gastosRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={10}>
                        No hay egresos para el filtro actual.
                      </td>
                    </tr>
                  )}
                  {gastosRows.map((r) => (
                    <tr
                      key={`${r.origen}-${r.id}`}
                      className="cursor-pointer"
                      onClick={() => setGastoDetalleId(`${r.origen}:${r.id}`)}
                    >
                      <td className="text-slate-600 whitespace-nowrap align-top">
                        {r.fecha ? (
                          <>
                            <div>{new Date(r.fecha).toLocaleDateString('es-CO')}</div>
                            <div className="text-xs text-slate-400 font-normal">
                              {new Date(r.fecha).toLocaleTimeString('es-CO', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="capitalize">{r.origen}</td>
                      <td>
                        <span
                          className={
                            r.clasificacion === 'devolucion'
                              ? 'badge badge-warning'
                              : 'badge badge-info'
                          }
                        >
                          {r.clasificacion}
                        </span>
                      </td>
                      <td className="text-slate-600">{r.categoria || '—'}</td>
                      <td className="text-slate-900 break-words min-w-0">
                        <div className="font-medium max-w-[280px]" title={r.concepto}>
                          {r.concepto}
                        </div>
                        {r.numero_comprobante ? (
                          <div className="text-xs text-slate-500">Comp: {r.numero_comprobante}</div>
                        ) : null}
                      </td>
                      <td className="text-slate-600">
                        <div>{r.beneficiario || '—'}</div>
                        {r.documento ? <div className="text-xs text-slate-500">{r.documento}</div> : null}
                      </td>
                      <td>{r.sucursal_nombre || '—'}</td>
                      <td className="text-slate-600 capitalize">{r.metodo_pago || '—'}</td>
                      <td>
                        {r.tiene_factura_soporte ? (
                          <button
                            type="button"
                            className="badge badge-success hover:opacity-90 cursor-pointer"
                            title="Ver factura de compra adjunta"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void abrirFacturaSoporteGasto(r);
                            }}
                          >
                            Adjunta
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="table-enterprise-col-monto text-slate-900 font-semibold">
                        {formatCOP(Number(r.monto || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {gastoDetalleId && (() => {
              const [origen, id] = gastoDetalleId.split(':');
              const g = gastosRows.find((x) => x.id === id && x.origen === origen);
              if (!g) return null;
              const fechaTxt = g.fecha
                ? `${new Date(g.fecha).toLocaleDateString('es-CO')} ${new Date(g.fecha).toLocaleTimeString(
                    'es-CO',
                    { hour: '2-digit', minute: '2-digit' },
                  )}`
                : '—';
              return (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
                  role="presentation"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setGastoDetalleId(null);
                  }}
                >
                  <div
                    className="modal-panel max-w-lg w-full shadow-xl"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="gasto-detalle-titulo"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="min-w-0">
                          <h3
                            id="gasto-detalle-titulo"
                            className="text-lg font-bold text-slate-900 flex items-center gap-2"
                          >
                            <Receipt className="w-5 h-5 text-primary-600 shrink-0" />
                            Detalle del egreso
                          </h3>
                          <p className="text-sm text-slate-500 mt-0.5 truncate" title={g.concepto}>
                            {g.concepto}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="modal-close-btn inline-flex items-center justify-center shrink-0"
                          aria-label="Cerrar"
                          onClick={() => setGastoDetalleId(null)}
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 mb-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="badge badge-info capitalize">{g.origen}</span>
                            <span
                              className={
                                g.clasificacion === 'devolucion'
                                  ? 'badge badge-warning'
                                  : 'badge badge-info'
                              }
                            >
                              {g.clasificacion}
                            </span>
                            {g.categoria ? (
                              <span className="text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-full px-2.5 py-0.5">
                                {g.categoria}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xl font-bold text-slate-900 tabular-nums">
                            {formatCOP(Number(g.monto || 0))}
                          </p>
                        </div>
                        <dl className="space-y-2 text-sm">
                          {[
                            { label: 'Fecha', value: fechaTxt },
                            { label: 'Beneficiario', value: g.beneficiario || '—' },
                            { label: 'Documento', value: g.documento || '—' },
                            { label: 'Método', value: g.metodo_pago || '—' },
                            { label: 'Sucursal', value: g.sucursal_nombre || '—' },
                            ...(g.numero_comprobante
                              ? [{ label: 'Nº comprobante', value: g.numero_comprobante }]
                              : []),
                          ].map((row) => (
                            <div
                              key={row.label}
                              className="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-3 gap-y-1"
                            >
                              <dt className="text-slate-500 font-medium">{row.label}</dt>
                              <dd className="text-slate-900 break-words">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>

                      {g.tiene_factura_soporte ? (
                        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex gap-2 items-start">
                          <FileText className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-emerald-900">
                              Factura de compra adjunta
                            </p>
                            <p className="text-xs text-emerald-800 truncate" title={g.factura_soporte_nombre || undefined}>
                              {g.factura_soporte_nombre || 'Archivo disponible'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                          <p className="text-xs text-slate-600">
                            Sin factura de compra adjunta. Quien registra el egreso en Tesorería/Caja
                            debe subir el PDF o imagen de la factura del proveedor.
                          </p>
                        </div>
                      )}

                      <div className="flex flex-col-reverse sm:flex-row gap-2 pt-4 border-t border-slate-200">
                        <button
                          type="button"
                          className="flex-1 btn-corporate-muted px-3 py-2 text-sm inline-flex items-center justify-center gap-2"
                          onClick={async () => {
                            try {
                              const { blob, filename } =
                                g.origen === 'caja'
                                  ? await cajasApi.obtenerComprobanteEgresoCajaPdf(g.id)
                                  : await tesoreriaApi.obtenerComprobanteEgresoPdf(g.id);
                              if (!blob || blob.size <= 0) throw new Error('Archivo vacío');
                              abrirGastoDocPreview({
                                blobUrl: URL.createObjectURL(blob),
                                title: `Comprobante interno · ${g.beneficiario || g.concepto}`,
                                fileName: filename,
                                mime: blob.type || 'application/pdf',
                              });
                            } catch (err: any) {
                              showToast(
                                'error',
                                'Comprobante',
                                err?.message || 'No se pudo abrir el comprobante interno de egreso.',
                              );
                            }
                          }}
                        >
                          <Eye className="w-4 h-4" />
                          Comprobante interno
                        </button>
                        {g.tiene_factura_soporte && (
                          <button
                            type="button"
                            className="flex-1 btn-success-solid px-3 py-2 text-sm inline-flex items-center justify-center gap-2"
                            onClick={() => void abrirFacturaSoporteGasto(g)}
                          >
                            <Eye className="w-4 h-4" />
                            Ver factura compra
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {(gastosQuery.data?.notas || []).length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Alcance</p>
                {(gastosQuery.data?.notas || []).map((n, idx) => (
                  <p key={idx} className="text-xs text-amber-800 mt-1">
                    - {n}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'ventas_sucursal' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarVentasSucursalCsv}
                  disabled={ventasSucursalQuery.isLoading || ventasSucursalRows.length === 0}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Sucursales</p>
                <p className="kpi-value text-2xl">
                  {ventasSucursalQuery.data?.resumen?.total_sucursales || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Tramites vendidos</p>
                <p className="kpi-value text-2xl">
                  {ventasSucursalQuery.data?.resumen?.total_tramites || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total vendido</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(ventasSucursalQuery.data?.resumen?.total_vendido || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Ticket promedio</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(ventasSucursalQuery.data?.resumen?.ticket_promedio_general || 0))}
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th>Código</th>
                    <th>Vendedores únicos</th>
                    <th>Trámites</th>
                    <th className="table-enterprise-col-monto">Ticket prom.</th>
                    <th className="table-enterprise-col-monto">Total vendido</th>
                    <th>Primera / última</th>
                    <th>Métodos de pago</th>
                    <th>Placas</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasSucursalQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={9}>
                        Cargando ventas por sucursal...
                      </td>
                    </tr>
                  )}
                  {!ventasSucursalQuery.isLoading && ventasSucursalRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={9}>
                        No hay datos para el rango o filtro actual.
                      </td>
                    </tr>
                  )}
                  {ventasSucursalRows.map((r) => (
                    <tr key={`${r.sucursal_id || 'sin'}-${r.sucursal_nombre}`}>
                      <td className="font-medium text-slate-900">{r.sucursal_nombre}</td>
                      <td>{r.sucursal_codigo || '—'}</td>
                      <td>{r.vendedores_unicos}</td>
                      <td>{r.tramites_vendidos}</td>
                      <td className="table-enterprise-col-monto">
                        {formatCOP(Number(r.ticket_promedio || 0))}
                      </td>
                      <td className="table-enterprise-col-monto font-semibold text-slate-900">
                        {formatCOP(Number(r.total_vendido || 0))}
                      </td>
                      <td className="text-slate-600 whitespace-nowrap">
                        {(r.primera_venta_at ? new Date(r.primera_venta_at).toLocaleDateString('es-CO') : '—') +
                          ' / ' +
                          (r.ultima_venta_at ? new Date(r.ultima_venta_at).toLocaleDateString('es-CO') : '—')}
                      </td>
                      <td className="text-slate-600">
                        {Object.entries(r.metodos_pago || {})
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${formatCOP(Number(v || 0))}`)
                          .join(' | ') || '—'}
                      </td>
                      <td className="text-slate-600">{(r.placas || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'ventas_vendedor' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarVentasVendedorCsv}
                  disabled={ventasVendedorQuery.isLoading || ventasVendedorRows.length === 0}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Vendedores</p>
                <p className="kpi-value text-2xl">
                  {ventasVendedorQuery.data?.resumen?.total_vendedores || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Tramites vendidos</p>
                <p className="kpi-value text-2xl">
                  {ventasVendedorQuery.data?.resumen?.total_tramites || 0}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total vendido</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(ventasVendedorQuery.data?.resumen?.total_vendido || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Ticket promedio</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(ventasVendedorQuery.data?.resumen?.ticket_promedio_general || 0))}
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Sucursal</th>
                    <th>Trámites</th>
                    <th className="table-enterprise-col-monto">Ticket prom.</th>
                    <th className="table-enterprise-col-monto">Total vendido</th>
                    <th>Primera / última</th>
                    <th>Métodos de pago</th>
                    <th>Placas</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasVendedorQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={8}>
                        Cargando ventas por vendedor...
                      </td>
                    </tr>
                  )}
                  {!ventasVendedorQuery.isLoading && ventasVendedorRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={8}>
                        No hay datos para el rango o filtro actual.
                      </td>
                    </tr>
                  )}
                  {ventasVendedorRows.map((r) => (
                    <tr key={`${r.vendedor_id || 'sin'}-${r.vendedor_nombre}`}>
                      <td className="font-medium text-slate-900">{r.vendedor_nombre}</td>
                      <td>{r.sucursal_nombre || '—'}</td>
                      <td>{r.tramites_vendidos}</td>
                      <td className="table-enterprise-col-monto">
                        {formatCOP(Number(r.ticket_promedio || 0))}
                      </td>
                      <td className="table-enterprise-col-monto font-semibold text-slate-900">
                        {formatCOP(Number(r.total_vendido || 0))}
                      </td>
                      <td className="text-slate-600 whitespace-nowrap">
                        {(r.primera_venta_at ? new Date(r.primera_venta_at).toLocaleDateString('es-CO') : '—') +
                          ' / ' +
                          (r.ultima_venta_at ? new Date(r.ultima_venta_at).toLocaleDateString('es-CO') : '—')}
                      </td>
                      <td className="text-slate-600">
                        {Object.entries(r.metodos_pago || {})
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${formatCOP(Number(v || 0))}`)
                          .join(' | ') || '—'}
                      </td>
                      <td className="text-slate-600">{(r.placas || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'estado_resultado' && (
          <div className="section-card p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                  <Landmark className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Estado de resultado integral</h3>
                  <p className="text-sm text-slate-600">
                    Periodo seleccionado · gerencial preliminar (insumo para el contador, no NIIF oficial).
                  </p>
                </div>
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarEstadoResultadoCsv}
                  disabled={estadoResultadoQuery.isLoading || !estadoResultadoQuery.data}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Ingresos netos oper.</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoResultadoQuery.data?.ingresos?.operacionales_netos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Gastos operacionales</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoResultadoQuery.data?.gastos?.gastos_operacionales_totales || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Resultado neto estimado</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoResultadoQuery.data?.resultado?.resultado_neto_estimado || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Margen neto %</p>
                <p className="kpi-value text-2xl">
                  {Number(estadoResultadoQuery.data?.resultado?.margen_neto_pct || 0).toFixed(2)}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="kpi-card p-3">
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
              <div className="kpi-card p-3">
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

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
          <div className="section-card p-5 sm:p-6 space-y-4">
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarEstadoFlujoCsv}
                  disabled={estadoFlujoQuery.isLoading || !estadoFlujoQuery.data}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Saldo inicial</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoFlujoQuery.data?.saldos?.saldo_inicial || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Variación neta</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoFlujoQuery.data?.saldos?.variacion_neta || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Saldo final</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoFlujoQuery.data?.saldos?.saldo_final || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Conciliación</p>
                <p className="kpi-value text-2xl">
                  {estadoFlujoQuery.data?.conciliacion?.conciliacion_ok ? 'OK' : 'Revisar'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="kpi-card p-3">
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
              <div className="kpi-card p-3">
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
              <div className="kpi-card p-3">
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

            <div className="kpi-card p-3">
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

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
          <div className="section-card p-5 sm:p-6 space-y-4">
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarEstadoPatrimonioCsv}
                  disabled={estadoPatrimonioQuery.isLoading || !estadoPatrimonioQuery.data}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Patrimonio inicial</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoPatrimonioQuery.data?.patrimonio?.patrimonio_inicial_estimado || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Patrimonio final estimado</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoPatrimonioQuery.data?.patrimonio?.patrimonio_final_estimado || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Patrimonio final real</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoPatrimonioQuery.data?.patrimonio?.patrimonio_final_real || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Conciliación</p>
                <p className="kpi-value text-2xl">
                  {estadoPatrimonioQuery.data?.conciliacion?.conciliacion_ok ? 'OK' : 'Revisar'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="kpi-card p-3">
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
              <div className="kpi-card p-3">
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

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
          <div className="section-card p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Estado de situación financiera</h3>
                <p className="text-sm text-slate-600">
                  Versión gerencial preliminar para control interno, con corte por fecha.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="kpi-label">Fecha corte</span>
                <input
                  type="date"
                  className="input-corporate"
                  value={estadoSituacionCorte}
                  onChange={(e) => setEstadoSituacionCorte(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarEstadoSituacionCsv}
                  disabled={estadoSituacionQuery.isLoading || !estadoSituacionQuery.data}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Total activos</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoSituacionQuery.data?.activos?.total_activos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total pasivos</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoSituacionQuery.data?.pasivos?.total_pasivos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Patrimonio estimado</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(estadoSituacionQuery.data?.patrimonio?.patrimonio_estimado || 0))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="kpi-card p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Activos</p>
                <p className="text-sm text-slate-700">
                  Efectivo equivalente: {formatCOP(Number(estadoSituacionQuery.data?.activos?.efectivo_equivalente || 0))}
                </p>
                <p className="text-sm text-slate-700">
                  CxC operativa: {formatCOP(Number(estadoSituacionQuery.data?.activos?.cxc_operativa || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="text-sm font-semibold text-slate-900 mb-2">Pasivos</p>
                <p className="text-sm text-slate-700">
                  CxP obligaciones (por pagar):{' '}
                  {formatCOP(Number(estadoSituacionQuery.data?.pasivos?.cxp_proveedores || 0))}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  * Suma saldos de Obligaciones abiertas/parciales. Los egresos ya pagados están en
                  “Egresos prov.” / Gastos.
                </p>
                <button
                  type="button"
                  className="btn-chip mt-2 text-xs"
                  onClick={() => setActiveTab('obligaciones')}
                >
                  Ir a Obligaciones
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
          <div className="section-card p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                  <Scale className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Balance de prueba general</h3>
                  <p className="text-sm text-slate-600">
                    Corte {balancePruebaCorte} · gerencial preliminar de débitos y créditos por cuenta de control.
                  </p>
                </div>
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarBalancePruebaCsv}
                  disabled={balancePruebaQuery.isLoading || balancePruebaRows.length === 0}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Total débitos</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(balancePruebaQuery.data?.resumen?.total_debitos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total créditos</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(balancePruebaQuery.data?.resumen?.total_creditos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Diferencia</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(balancePruebaQuery.data?.resumen?.diferencia_debito_credito || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Cuadre</p>
                <p className="kpi-value text-2xl">
                  {balancePruebaQuery.data?.resumen?.cuadre_ok ? 'OK' : 'Revisar'}
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cuenta</th>
                    <th>Naturaleza</th>
                    <th className="table-enterprise-col-monto">Débito</th>
                    <th className="table-enterprise-col-monto">Crédito</th>
                    <th className="table-enterprise-col-monto">Saldo</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {balancePruebaQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={7}>
                        Cargando balance de prueba...
                      </td>
                    </tr>
                  )}
                  {!balancePruebaQuery.isLoading && balancePruebaRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={7}>
                        No hay cuentas para el corte o filtro seleccionado.
                      </td>
                    </tr>
                  )}
                  {balancePruebaRows.map((r) => (
                    <tr key={`${r.codigo}-${r.nombre}`}>
                      <td className="font-medium text-slate-900">{r.codigo}</td>
                      <td>{r.nombre}</td>
                      <td>{r.naturaleza}</td>
                      <td className="table-enterprise-col-monto">{formatCOP(Number(r.debito || 0))}</td>
                      <td className="table-enterprise-col-monto">{formatCOP(Number(r.credito || 0))}</td>
                      <td className="table-enterprise-col-monto font-semibold text-slate-900">
                        {formatCOP(Number(r.saldo || 0))}
                      </td>
                      <td className="text-slate-600">{(r.origenes || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
          <div className="section-card p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Balance de prueba por tercero</h3>
                  <p className="text-sm text-slate-600">
                    Corte {balanceTerceroCorte} · gerencial preliminar por cuenta y tercero.
                  </p>
                </div>
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
                <button
                  type="button"
                  className="btn-success-solid px-3 inline-flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={descargarBalanceTerceroCsv}
                  disabled={balanceTerceroQuery.isLoading || balanceTerceroRows.length === 0}
                >
                  <Download className="w-4 h-4" />
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="kpi-card p-3">
                <p className="kpi-label">Total débitos</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(balanceTerceroQuery.data?.resumen?.total_debitos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Total créditos</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(balanceTerceroQuery.data?.resumen?.total_creditos || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Diferencia</p>
                <p className="kpi-value text-2xl">
                  {formatCOP(Number(balanceTerceroQuery.data?.resumen?.diferencia_debito_credito || 0))}
                </p>
              </div>
              <div className="kpi-card p-3">
                <p className="kpi-label">Filas</p>
                <p className="kpi-value text-2xl">
                  {balanceTerceroQuery.data?.resumen?.total_filas || 0}
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="table-enterprise min-w-full">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Tercero</th>
                    <th>Documento</th>
                    <th className="table-enterprise-col-monto">Débito</th>
                    <th className="table-enterprise-col-monto">Crédito</th>
                    <th className="table-enterprise-col-monto">Saldo</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceTerceroQuery.isLoading && (
                    <tr>
                      <td className="text-slate-500" colSpan={7}>
                        Cargando balance por tercero...
                      </td>
                    </tr>
                  )}
                  {!balanceTerceroQuery.isLoading && balanceTerceroRows.length === 0 && (
                    <tr>
                      <td className="text-slate-500" colSpan={7}>
                        No hay filas para el corte o filtro seleccionado.
                      </td>
                    </tr>
                  )}
                  {balanceTerceroRows.map((r) => (
                    <tr
                      key={`${r.codigo_cuenta}-${r.tercero_tipo_documento}-${r.tercero_documento}-${r.tercero_nombre}`}
                    >
                      <td>
                        <div className="font-medium text-slate-900">{r.codigo_cuenta}</div>
                        <div className="text-xs text-slate-500">{r.nombre_cuenta}</div>
                      </td>
                      <td>{r.tercero_nombre}</td>
                      <td>
                        <div>{r.tercero_documento}</div>
                        <div className="text-xs text-slate-500">{r.tercero_tipo_documento}</div>
                      </td>
                      <td className="table-enterprise-col-monto">{formatCOP(Number(r.debito || 0))}</td>
                      <td className="table-enterprise-col-monto">{formatCOP(Number(r.credito || 0))}</td>
                      <td className="table-enterprise-col-monto font-semibold text-slate-900">
                        {formatCOP(Number(r.saldo || 0))}
                      </td>
                      <td className="text-slate-600">{(r.origenes || []).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
          <div className="space-y-4">
            <div className="section-card p-5 sm:p-6 space-y-4 bg-gradient-to-br from-primary-50/50 to-white border-primary-100">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary-100 border border-primary-200 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-6 h-6 text-primary-700" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Cierre DIAN</p>
                    <h3 className="text-lg font-semibold text-slate-900">Exógena 1001 / 1007</h3>
                    <p className="text-sm text-slate-600 mt-0.5">
                      Configurar → validar → corregir terceros → exportar.
                    </p>
                  </div>
                </div>
                <span
                  className={`badge ${
                    exogenaSemaforo.estado === 'listo'
                      ? 'badge-success'
                      : exogenaSemaforo.estado === 'revisar'
                        ? 'badge-warning'
                        : 'badge-danger'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {exogenaSemaforo.label}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(
                  [
                    { n: 1 as ExogenaPaso, t: 'Configurar' },
                    { n: 2 as ExogenaPaso, t: 'Validar' },
                    { n: 3 as ExogenaPaso, t: 'Corregir' },
                    { n: 4 as ExogenaPaso, t: 'Exportar' },
                  ] as const
                ).map((p) => {
                  const PasoIcon = pasoIcons[p.n];
                  const done = exogenaPaso > p.n;
                  const active = exogenaPaso === p.n;
                  return (
                    <button
                      key={p.n}
                      type="button"
                      onClick={() => setExogenaPaso(p.n)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        active
                          ? 'border-primary-500 bg-white shadow-sm ring-2 ring-primary-100'
                          : done
                            ? 'border-emerald-200 bg-emerald-50/60'
                            : 'border-slate-200 bg-white/80 hover:border-primary-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            active
                              ? 'bg-primary-100 text-primary-700'
                              : done
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <PasoIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">Paso {p.n}</p>
                          <p className="text-sm font-semibold text-slate-900">{p.t}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="kpi-card p-3">
                  <p className="kpi-label">Mapeos 1001</p>
                  <p className="kpi-value text-xl">{exogenaCompletitud.mapeos1001}</p>
                </div>
                <div className="kpi-card p-3">
                  <p className="kpi-label">Mapeos 1007</p>
                  <p className="kpi-value text-xl">{exogenaCompletitud.mapeos1007}</p>
                </div>
                <div className="kpi-card p-3">
                  <p className="kpi-label">Última export 1001</p>
                  <p
                    className={`text-sm font-semibold ${
                      exogenaCompletitud.export1001Ok
                        ? 'text-emerald-700'
                        : exogenaCompletitud.export1001.startsWith('Error')
                          ? 'text-red-700'
                          : 'text-slate-900'
                    }`}
                  >
                    {exogenaCompletitud.export1001}
                  </p>
                </div>
                <div className="kpi-card p-3">
                  <p className="kpi-label">Última export 1007</p>
                  <p
                    className={`text-sm font-semibold ${
                      exogenaCompletitud.export1007Ok
                        ? 'text-emerald-700'
                        : exogenaCompletitud.export1007.startsWith('Error')
                          ? 'text-red-700'
                          : 'text-slate-900'
                    }`}
                  >
                    {exogenaCompletitud.export1007}
                  </p>
                </div>
              </div>
            </div>

            <div className="section-card p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary-600" />
                <h4 className="text-sm font-semibold text-slate-900">Parámetros del año</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="flex flex-col gap-1">
                <span className="kpi-label">Año gravable</span>
                <input
                  className="input-corporate"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  maxLength={4}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="kpi-label">UVT anual</span>
                <input
                  type="number"
                  className="input-corporate"
                  value={uvt}
                  onChange={(e) => setUvt(Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="kpi-label">Versión normativa</span>
                <input
                  className="input-corporate"
                  value={versionNormativa}
                  onChange={(e) => setVersionNormativa(e.target.value)}
                  placeholder="ej. resolucion-2026-v1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="kpi-label">Tope mín. 1001</span>
                <input
                  type="number"
                  className="input-corporate"
                  min={0}
                  value={topeMinimo1001}
                  onChange={(e) => setTopeMinimo1001(Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="kpi-label">Tope mín. 1007</span>
                <input
                  type="number"
                  className="input-corporate"
                  min={0}
                  value={topeMinimo1007}
                  onChange={(e) => setTopeMinimo1007(Number(e.target.value || 0))}
                />
              </label>
            </div>
            </div>

            <div className="section-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {(() => {
                    const PasoIcon = pasoIcons[exogenaPaso];
                    return (
                      <div className="w-9 h-9 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center">
                        <PasoIcon className="w-4 h-4 text-primary-600" />
                      </div>
                    );
                  })()}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Acción del paso</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {exogenaPaso === 1 && 'Configurar año y mapeos'}
                      {exogenaPaso === 2 && 'Validar antes de exportar'}
                      {exogenaPaso === 3 && 'Corregir hallazgos de terceros'}
                      {exogenaPaso === 4 && 'Exportar 1001 / 1007'}
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2">
                  <span className="kpi-label">Modo</span>
                  <select
                    className="input-corporate text-sm"
                    value={modoExportacion}
                    onChange={(e) => setModoExportacion(e.target.value as 'consolidado' | 'detalle')}
                  >
                    <option value="consolidado">Consolidado</option>
                    <option value="detalle">Detalle</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                {exogenaPaso === 1 && (
                  <>
                    <button
                      type="button"
                      className="btn-corporate-primary px-4"
                      onClick={() => guardarMutation.mutate()}
                      disabled={guardarMutation.isLoading}
                    >
                      Guardar y continuar
                    </button>
                    <button
                      type="button"
                      className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                      onClick={() => clonarMutation.mutate(false)}
                      disabled={clonarMutation.isLoading || !/^\d{4}$/.test(anio)}
                      title={`Copia solo mapeos/reglas de ${Number(anio) - 1}. No copia UVT ni topes.`}
                    >
                      <Copy className="w-4 h-4" />
                      Copiar mapeos {Number(anio) - 1}
                    </button>
                    <button
                      type="button"
                      className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                      onClick={cargarPlantillaBase}
                    >
                      <Plus className="w-4 h-4" />
                      Plantilla base
                    </button>
                  </>
                )}
                {exogenaPaso === 2 && (
                  <>
                    <button
                      type="button"
                      className="btn-corporate-primary px-4"
                      onClick={() => validarMutation.mutate()}
                      disabled={validarMutation.isLoading}
                    >
                      Validar ahora
                    </button>
                    <button type="button" className="btn-corporate-muted px-4" onClick={() => setExogenaPaso(1)}>
                      Volver a configurar
                    </button>
                  </>
                )}
                {exogenaPaso === 3 && (
                  <>
                    <button
                      type="button"
                      className="btn-corporate-primary px-4 inline-flex items-center gap-2"
                      onClick={() => navigate('/proveedores-catalogo')}
                    >
                      <ExternalLink className="w-4 h-4" />
                      Ir a Proveedores
                    </button>
                    <button
                      type="button"
                      className="btn-corporate-muted px-4"
                      onClick={() => validarMutation.mutate()}
                      disabled={validarMutation.isLoading}
                    >
                      Revalidar
                    </button>
                    <button
                      type="button"
                      className="btn-corporate-muted px-4"
                      onClick={() => setExogenaPaso(4)}
                      disabled={(validacionResult?.total_errors || 0) > 0}
                    >
                      Continuar a exportar
                    </button>
                  </>
                )}
                {exogenaPaso === 4 && (
                  <>
                    <button
                      type="button"
                      className={`${formatoExportActivo === '1001' ? 'btn-corporate-primary' : 'btn-corporate-muted'} px-4 inline-flex items-center gap-2`}
                      onClick={() => exportarMutation.mutate('1001')}
                      disabled={exportarMutation.isLoading || exogenaSemaforo.estado === 'bloqueado'}
                    >
                      <FileUp className="w-4 h-4" />
                      Exportar 1001
                    </button>
                    <button
                      type="button"
                      className={`${formatoExportActivo === '1007' ? 'btn-corporate-primary' : 'btn-corporate-muted'} px-4 inline-flex items-center gap-2`}
                      onClick={() => exportarMutation.mutate('1007')}
                      disabled={exportarMutation.isLoading || exogenaSemaforo.estado === 'bloqueado'}
                    >
                      <FileUp className="w-4 h-4" />
                      Exportar 1007
                    </button>
                    <button
                      type="button"
                      className="btn-corporate-muted px-4"
                      onClick={() => validarMutation.mutate()}
                      disabled={validarMutation.isLoading}
                    >
                      Revalidar
                    </button>
                  </>
                )}
              </div>
              {exogenaPaso === 4 && exogenaSemaforo.estado === 'bloqueado' && (
                <p className="text-xs text-red-700">
                  No se puede exportar mientras haya errores. Vuelve a Validar o Corregir.
                </p>
              )}
            </div>

            {mensaje && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{mensaje}</div>
            )}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 inline-flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {validacionResult && (
              <div className="section-card p-5 sm:p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-primary-600" />
                    <p className="text-sm font-semibold text-slate-900">Checklist de validación</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="badge badge-danger">{validacionResult.total_errors} errores</span>
                    <span className="badge badge-warning">{validacionResult.total_warnings} advertencias</span>
                  </div>
                </div>
                {validacionChecklist.length === 0 ? (
                  <p className="text-xs text-emerald-700">Sin hallazgos. Puede exportar 1001/1007.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-56 overflow-auto">
                    {validacionChecklist.map((item) => {
                      const hint = hintCorreccionTercero(item.codigo);
                      const accion = accionChecklist(item.codigo);
                      return (
                        <li
                          key={`${item.severidad}-${item.codigo}-${item.mensaje}`}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`badge ${item.severidad === 'error' ? 'badge-danger' : 'badge-warning'}`}
                            >
                              {item.severidad}
                            </span>
                            <span className="font-mono text-slate-600">{item.codigo}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                              ×{item.count}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-800">{item.mensaje}</p>
                          {hint && <p className="mt-1 text-slate-600">{hint}</p>}
                          {accion && (
                            <button
                              type="button"
                              className="mt-2 btn-chip inline-flex items-center gap-1 text-primary-700"
                              onClick={accion.onClick}
                            >
                              {accion.label}
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {validacionChecklist.some((i) => i.codigo === 'MAPEO_EMPTY') && (
                  <button
                    type="button"
                    className="btn-corporate-muted px-3 text-xs inline-flex items-center gap-1"
                    onClick={cargarPlantillaBase}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Cargar plantilla base 1001/1007
                  </button>
                )}
              </div>
            )}

            <div className="section-card p-5 sm:p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 text-left min-w-0"
                  onClick={() => setMapeosAbiertos((v) => !v)}
                  aria-expanded={mapeosAbiertos}
                >
                  <Scale className="w-4 h-4 text-primary-600 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-900">Mapeos ({mapeos.length})</h3>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-500 transition-transform ${mapeosAbiertos ? 'rotate-180' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  className="btn-chip inline-flex items-center gap-1"
                  onClick={addMapeo}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Agregar mapeo
                </button>
              </div>
              {mapeosAbiertos && (
                <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
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
              <div className="table-shell">
                <table className="table-enterprise min-w-full">
                  <thead>
                    <tr>
                      <th>Formato</th>
                      <th>Cuenta</th>
                      <th>Concepto</th>
                      <th>Categoría</th>
                      <th>Saldo</th>
                      <th>Regla</th>
                      <th>Activo</th>
                      <th className="table-enterprise-col-actions">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeos.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <select
                            className="input-corporate"
                            value={m.formato}
                            onChange={(e) => updateMapeo(m.id, { formato: e.target.value })}
                          >
                            <option value="1001">1001</option>
                            <option value="1007">1007</option>
                          </select>
                        </td>
                        <td>
                          <input
                            className="input-corporate"
                            value={m.cuenta_contable}
                            onChange={(e) => updateMapeo(m.id, { cuenta_contable: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="input-corporate"
                            value={m.concepto}
                            onChange={(e) => updateMapeo(m.id, { concepto: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="input-corporate"
                            value={m.categoria || ''}
                            onChange={(e) => updateMapeo(m.id, { categoria: e.target.value })}
                          />
                        </td>
                        <td>
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
                        <td className="min-w-[280px]">
                          <input
                            className="input-corporate"
                            value={m.source_rule || ''}
                            onChange={(e) => updateMapeo(m.id, { source_rule: e.target.value })}
                            placeholder="ej: fuente:movimientos_tesoreria;categoria_egreso:impuestos|otros_gastos"
                          />
                        </td>
                        <td>
                          <select
                            className="input-corporate"
                            value={m.activo || 'si'}
                            onChange={(e) => updateMapeo(m.id, { activo: e.target.value })}
                          >
                            <option value="si">si</option>
                            <option value="no">no</option>
                          </select>
                        </td>
                        <td className="table-enterprise-col-actions">
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
                        <td className="text-slate-500" colSpan={8}>
                          Sin mapeos en este año.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                </>
              )}
              {!mapeosAbiertos && (
                <p className="text-xs text-slate-500">
                  Sección colapsada. Pulsa el título para ver o editar los mapeos del año.
                </p>
              )}
            </div>

            <div className="section-card p-5 sm:p-6 space-y-3">
              <div className="flex items-center justify-between mb-0 gap-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Historial de ejecuciones ({ejecuciones.length})
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Vista</span>
                  <select
                    className="input-corporate text-sm"
                    value={historialFiltro}
                    onChange={(e) => {
                      setHistorialFiltro(e.target.value as 'success' | 'error' | 'all');
                      setHistorialPagina(1);
                    }}
                  >
                    <option value="success">Solo success</option>
                    <option value="error">Solo error</option>
                    <option value="all">Todos</option>
                  </select>
                </div>
              </div>
              <div className="table-shell">
                <table className="table-enterprise min-w-full">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Formato</th>
                      <th>Estado</th>
                      <th>Filas</th>
                      <th>Fuentes</th>
                      <th>Omitidos</th>
                      <th>Errores</th>
                      <th>Validaciones</th>
                      <th className="table-enterprise-col-actions">Archivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ejecucionesPagina.map((e) => {
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
                      <tr>
                        <td className="text-slate-600 whitespace-nowrap align-top">
                          <div>{new Date(e.created_at).toLocaleDateString('es-CO')}</div>
                          <div className="text-xs text-slate-400 font-normal">
                            {new Date(e.created_at).toLocaleTimeString('es-CO', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </td>
                        <td>{e.formato}</td>
                        <td>
                          <span className={`badge ${(e.status || '').toLowerCase() === 'success' ? 'badge-success' : (e.status || '').toLowerCase() === 'error' ? 'badge-danger' : 'badge-info'}`}>
                            {e.status}
                          </span>
                        </td>
                        <td>{e.total_rows}</td>
                        <td className="text-slate-600">
                          {(e.fuente_resumen_json || [])
                            .map((f) => `${f.fuente}: ${f.rows}`)
                            .join(' | ') || '—'}
                        </td>
                        <td>
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
                        <td>{e.total_errors}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-chip inline-flex items-center gap-1"
                            onClick={() => toggleValidacionesEjecucion(e.id)}
                          >
                            {expandedEjecucionId === e.id ? 'Ocultar' : 'Ver'}
                          </button>
                        </td>
                        <td className="table-enterprise-col-actions">
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
                        <tr className="bg-slate-50/80">
                          <td className="text-xs text-slate-700" colSpan={9}>
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
                        <td className="text-slate-500" colSpan={9}>
                          No hay ejecuciones para el filtro actual.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {ejecuciones.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-xs text-slate-500">
                    Mostrando {(historialPaginaActual - 1) * HISTORIAL_PAGE_SIZE + 1}–
                    {Math.min(historialPaginaActual * HISTORIAL_PAGE_SIZE, ejecuciones.length)} de{' '}
                    {ejecuciones.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-chip inline-flex items-center gap-1"
                      disabled={historialPaginaActual <= 1}
                      onClick={() => setHistorialPagina((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Anterior
                    </button>
                    <span className="text-xs text-slate-600 tabular-nums">
                      Página {historialPaginaActual} de {historialTotalPaginas}
                    </span>
                    <button
                      type="button"
                      className="btn-chip inline-flex items-center gap-1"
                      disabled={historialPaginaActual >= historialTotalPaginas}
                      onClick={() =>
                        setHistorialPagina((p) => Math.min(historialTotalPaginas, p + 1))
                      }
                    >
                      Siguiente
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {gastoDocPreview && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gasto-doc-preview-titulo"
          onClick={(e) => {
            if (e.target === e.currentTarget) cerrarGastoDocPreview();
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h4
                id="gasto-doc-preview-titulo"
                className="font-bold text-slate-900 flex items-center gap-2 text-sm sm:text-base min-w-0 pr-2"
              >
                <FileText className="w-5 h-5 text-primary-600 shrink-0" />
                <span className="truncate">{gastoDocPreview.title}</span>
              </h4>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={gastoDocPreview.blobUrl}
                  download={gastoDocPreview.fileName}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <Download className="w-4 h-4" />
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={cerrarGastoDocPreview}
                  className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
                  aria-label="Cerrar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 flex flex-col">
              {(gastoDocPreview.mime || '').startsWith('image/') ? (
                <div className="overflow-auto p-4 flex justify-center">
                  <img
                    src={gastoDocPreview.blobUrl}
                    alt={gastoDocPreview.title}
                    className="max-w-full max-h-[75vh] object-contain rounded shadow"
                  />
                </div>
              ) : (
                <iframe
                  title={gastoDocPreview.title}
                  src={gastoDocPreview.blobUrl}
                  className="w-full flex-1 min-h-[70vh] border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
