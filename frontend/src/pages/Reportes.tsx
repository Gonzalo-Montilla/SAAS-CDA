import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, TrendingUp, TrendingDown, Wallet, Building2, FileText, Download, DollarSign, ArrowUpCircle, ArrowDownCircle, CalendarDays, TimerReset, AlertTriangle, GaugeCircle, Receipt, Landmark, X, Lock, Printer, FileCheck, Eye, Info } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import {
  reportesApi,
  type AgendamientoMetricasResponse,
  type CierreCajaReporteItem,
  type FacturacionContingenciaListResponse,
} from '../api/reportes';
import { tesoreriaApi } from '../api/tesoreria';
import { cajasApi } from '../api/cajas';
import { vehiculosApi } from '../api/vehiculos';
import { useAuth } from '../contexts/AuthContext';
import { useBrand } from '../contexts/BrandContext';
import { useToast } from '../contexts/ToastContext';
import type { Usuario } from '../types';
import { formatCOP } from '../utils/formatNumber';

const ReportesIngresosChart = lazy(() => import('../components/ReportesIngresosChart'));

const formatLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Enlace que Factus a veces mete en JSON (logo PNG, CDN) y no es el visor DIAN del documento. */
function urlPareceAssetMarcaOImagen(raw: string): boolean {
  const s = raw.trim().split('?')[0].toLowerCase();
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|bmp)(\/?|$)/.test(s)) return true;
  return /\/logo|\/logos\/|\/favicon|\/icon\/|\/icons\/|\/img\/|\/images\/|\/assets\//i.test(s);
}

/**
 * Factus/DIAN suelen entregar URLs del catálogo VPFE que abren «Buscar documento» con CUFE/CUDS precargado:
 * el usuario debe pulsar «Buscar». No es fallo de integración; para «ver el documento» conviene el PDF vía API.
 */
function urlDianPareceConsultaConPasoExtra(raw: string): boolean {
  const u = raw.trim().toLowerCase();
  if (!u.startsWith('http')) return false;
  if (!u.includes('dian.gov.co') && !u.includes('catalogo-vpfe')) return false;
  if (u.includes('searchqr')) return true;
  if (u.includes('documentkey=') || u.includes('documentkey?')) return true;
  if (u.includes('buscar') && u.includes('documento')) return true;
  return false;
}

interface DashboardData {
  fecha: string;
  resumen: {
    total_ingresos_dia: number;
    total_egresos_dia: number;
    utilidad_dia: number;
    saldo_total: number;
    tramites_atendidos: number;
  };
  desglose_modulos: {
    caja: {
      ingresos: number;
      egresos: number;
      saldo: number;
    };
    tesoreria: {
      ingresos: number;
      egresos: number;
      saldo: number;
    };
  };
  grafica_ingresos_7_dias: Array<{
    fecha: string;
    dia_semana: string;
    ingresos: number;
  }>;
}

interface Movimiento {
  id: string;
  hora: string;
  modulo: string;
  turno: string;
  tipo_movimiento: string;
  concepto: string;
  categoria: string;
  monto: number;
  es_ingreso: boolean;
  metodo_pago: string;
  usuario: string;
  numero_comprobante?: string;
  /** Tesorería / egresos de caja manual (reporte detalle). */
  beneficiario?: string | null;
  beneficiario_tipo_identificacion?: string | null;
  beneficiario_numero_identificacion?: string | null;
  beneficiario_direccion?: string | null;
  beneficiario_email?: string | null;
  beneficiario_telefono?: string | null;
  beneficiario_factus_municipality_id?: number | null;
  sede?: string | null;
  vehiculo_id?: string | null;
  numero_factura_dian?: string | null;
  factura_public_url?: string | null;
  /** Solo filas de tesorería (reporte movimientos detallados). */
  anulado?: boolean;
  motivo_anulacion?: string | null;
  fecha_anulacion?: string | null;
  anulado_por?: string | null;
  documento_soporte_numero?: string | null;
  documento_soporte_public_url?: string | null;
  documento_soporte_emitido_por?: string | null;
  documento_soporte_emitido_en?: string | null;
  documento_soporte_pdf_archivado?: boolean;
  /** Concepto de retención del catálogo, instantánea al emitir DSE (si hubo proveedor de catálogo). */
  documento_soporte_concepto_retencion?: string | null;
  /** Monto sugerido por el motor (UVT + tasas en BD) al emitir DSE; puede ser 0. */
  documento_soporte_retencion_calculada?: number | null;
  documento_soporte_retencion_anio?: number | null;
  factura_emitida_por?: string | null;
  factura_emitida_en?: string | null;
  factura_pdf_archivado?: boolean;
  factura_corregida?: boolean;
  factura_correccion_estado?: string | null;
  factura_correccion_motivo?: string | null;
  factura_correccion_at?: string | null;
  factura_correccion_factura_original?: string | null;
  factura_correccion_nota_credito?: string | null;
  factura_correccion_factura_nueva?: string | null;
  /** Campos solo UI para vista compacta de pagos mixtos. */
  ui_pago_mixto_compacto?: boolean;
  ui_desglose_metodos?: Array<{ metodo: string; monto: number }>;
  ui_concepto_base?: string;
  ui_subitems_count?: number;
}

interface Tramite {
  id: string;
  hora_registro: string;
  placa: string;
  tipo_vehiculo: string;
  cliente: string;
  documento: string;
  valor_rtm: number;
  comision_soat: number;
  total_cobrado: number;
  metodo_pago: string;
  estado: string;
  pagado: boolean;
  registrado_por: string;
  sede?: string | null;
  factura_corregida?: boolean;
  factura_correccion_estado?: string | null;
  factura_correccion_motivo?: string | null;
  factura_correccion_at?: string | null;
  factura_original_numero?: string | null;
  nota_credito_numero?: string | null;
  factura_nueva_numero?: string | null;
}

interface ProvisionIvaVenta {
  vehiculo_id: string;
  fecha_pago?: string | null;
  sucursal_id?: string | null;
  placa: string;
  cliente_nombre: string;
  cliente_documento: string;
  numero_factura_dian?: string | null;
  metodo_pago: string;
  base_gravable: number;
  iva_causado: number;
  valor_excluido: number;
  total_servicio: number;
  fuente_calculo: string;
  provisionado: boolean;
  provisionado_lote_id?: string | null;
  provisionado_en?: string | null;
}

interface ProvisionIvaData {
  periodo: string;
  resumen: {
    ventas_total: number;
    base_gravable_total: number;
    iva_causado_total: number;
    valor_excluido_total: number;
    iva_provisionado_total: number;
    iva_pendiente_total: number;
  };
  ventas: ProvisionIvaVenta[];
}

type ReporteSedeScope = 'activa' | 'todas' | 'sucursal';

type ReportesSeccion =
  | 'resumen'
  | 'finanzas'
  | 'operacion'
  | 'citas'
  | 'cierres'
  | 'provisiones'
  | 'contingencia'
  | 'detalle';

const REPORTES_SECCIONES: { id: ReportesSeccion; label: string; hint: string }[] = [
  { id: 'resumen', label: 'Resumen', hint: 'KPIs del día, comparativo por sede y tendencia de ingresos' },
  { id: 'finanzas', label: 'Finanzas', hint: 'Caja, tesorería y recaudo por concepto y medio de pago' },
  { id: 'operacion', label: 'Operación', hint: 'SLA, colas de atención y casos en riesgo' },
  { id: 'citas', label: 'Citas', hint: 'Métricas de agendamiento del tenant' },
  { id: 'cierres', label: 'Cierres caja', hint: 'Historial de cierres por cajero y sede (auditoría)' },
  { id: 'provisiones', label: 'Provisiones IVA', hint: 'IVA causado por ventas y control de provisionado por periodo' },
  {
    id: 'contingencia',
    label: 'Contingencia',
    hint: 'Cobros sin factura electrónica para emisión individual cuando Factus se normaliza',
  },
  { id: 'detalle', label: 'Detalle', hint: 'Movimientos y trámites con exportación CSV' },
];

const REPORTES_SECCIONES_SET = new Set<ReportesSeccion>(REPORTES_SECCIONES.map((s) => s.id));

function movimientoElegibleDocumentoSoporte(m: Movimiento): boolean {
  const esEgresoCajaManual =
    m.modulo === 'Caja' &&
    !m.es_ingreso &&
    !m.anulado &&
    ['gasto', 'devolucion', 'ajuste'].includes(m.categoria);
  const esEgresoTesoreria = m.modulo === 'Tesorería' && !m.es_ingreso && !m.anulado;
  if (!esEgresoCajaManual && !esEgresoTesoreria) return false;
  const doc = (m.beneficiario_numero_identificacion || '').replace(/\D/g, '');
  if (doc.length < 5) return false;
  const nom = (m.beneficiario || '').trim();
  if (nom.length < 2) return false;
  const dir = (m.beneficiario_direccion || '').trim();
  if (dir.length < 8) return false;
  const mail = (m.beneficiario_email || '').trim().toLowerCase();
  const at = mail.indexOf('@');
  if (at < 1) return false;
  const dom = mail.slice(at + 1);
  if (!dom.includes('.') || dom.length < 3) return false;
  const tel = (m.beneficiario_telefono || '').replace(/\D/g, '');
  if (tel.length < 7) return false;
  const mid = m.beneficiario_factus_municipality_id;
  if (mid == null || mid < 1) return false;
  return true;
}

function moduloDocumentoSoporteApi(m: Movimiento): 'caja' | 'tesoreria' {
  return m.modulo === 'Caja' ? 'caja' : 'tesoreria';
}

function formatearMetodoPagoEtiqueta(metodo: string): string {
  const raw = (metodo || '').replace(/_/g, ' ').trim();
  if (!raw) return 'N/A';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function esMovimientoElegibleCompactacionMixto(m: Movimiento): boolean {
  return (
    m.modulo === 'Caja' &&
    !!m.vehiculo_id &&
    m.es_ingreso &&
    (m.categoria === 'rtm' || m.categoria === 'comision_soat')
  );
}

function normalizarConceptoBaseMixto(concepto: string): string {
  // Remueve "(Método)" justo antes del " - Cliente" para agrupar RTM/SOAT mixtos.
  return (concepto || '')
    .replace(/\s*\(([^)]+)\)(?=\s*-\s*)/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function compactarMovimientosMixtos(rows: Movimiento[]): Movimiento[] {
  type GroupInfo = {
    firstIndex: number;
    rows: Movimiento[];
    methods: Set<string>;
  };
  const groups = new Map<string, GroupInfo>();

  rows.forEach((m, index) => {
    if (!esMovimientoElegibleCompactacionMixto(m)) return;
    const baseConcept = normalizarConceptoBaseMixto(m.concepto);
    const key = [
      m.modulo,
      m.vehiculo_id,
      m.categoria,
      m.tipo_movimiento,
      m.turno,
      m.usuario,
      m.sede || '',
      baseConcept,
    ].join('|');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        firstIndex: index,
        rows: [m],
        methods: new Set([m.metodo_pago]),
      });
      return;
    }
    existing.rows.push(m);
    existing.methods.add(m.metodo_pago);
  });

  const rendered = new Set<string>();
  const out: Movimiento[] = [];

  rows.forEach((m, index) => {
    if (!esMovimientoElegibleCompactacionMixto(m)) {
      out.push(m);
      return;
    }
    const baseConcept = normalizarConceptoBaseMixto(m.concepto);
    const key = [
      m.modulo,
      m.vehiculo_id,
      m.categoria,
      m.tipo_movimiento,
      m.turno,
      m.usuario,
      m.sede || '',
      baseConcept,
    ].join('|');
    const g = groups.get(key);
    if (!g) {
      out.push(m);
      return;
    }
    const esMixtoReal = g.rows.length > 1 && g.methods.size > 1;
    if (!esMixtoReal) {
      out.push(m);
      return;
    }
    if (rendered.has(key) || g.firstIndex !== index) {
      return;
    }
    rendered.add(key);

    const montoTotal = g.rows.reduce((acc, row) => acc + row.monto, 0);
    const byMethod = new Map<string, number>();
    g.rows.forEach((row) => {
      byMethod.set(row.metodo_pago, (byMethod.get(row.metodo_pago) || 0) + row.monto);
    });

    const desglose = Array.from(byMethod.entries())
      .map(([metodo, monto]) => ({ metodo, monto }))
      .sort((a, b) => b.monto - a.monto);

    const base = g.rows[0];
    out.push({
      ...base,
      id: `mix-${base.id}`,
      monto: montoTotal,
      metodo_pago: 'mixto',
      concepto: `${baseConcept} (Mixto)`,
      ui_pago_mixto_compacto: true,
      ui_desglose_metodos: desglose,
      ui_concepto_base: baseConcept,
      ui_subitems_count: g.rows.length,
    });
  });

  return out;
}

function anotarMovimientosMixtosParaCsv(rows: Movimiento[]): Array<Movimiento & {
  pago_mixto: 'si' | 'no';
  desglose_metodos_mixto: string;
}> {
  type GroupInfo = {
    rows: Movimiento[];
    methods: Set<string>;
  };
  const groups = new Map<string, GroupInfo>();

  rows.forEach((m) => {
    if (!esMovimientoElegibleCompactacionMixto(m)) return;
    const baseConcept = normalizarConceptoBaseMixto(m.concepto);
    const key = [
      m.modulo,
      m.vehiculo_id,
      m.categoria,
      m.tipo_movimiento,
      m.turno,
      m.usuario,
      m.sede || '',
      baseConcept,
    ].join('|');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { rows: [m], methods: new Set([m.metodo_pago]) });
      return;
    }
    existing.rows.push(m);
    existing.methods.add(m.metodo_pago);
  });

  return rows.map((m) => {
    if (!esMovimientoElegibleCompactacionMixto(m)) {
      return { ...m, pago_mixto: 'no', desglose_metodos_mixto: '' };
    }
    const baseConcept = normalizarConceptoBaseMixto(m.concepto);
    const key = [
      m.modulo,
      m.vehiculo_id,
      m.categoria,
      m.tipo_movimiento,
      m.turno,
      m.usuario,
      m.sede || '',
      baseConcept,
    ].join('|');
    const g = groups.get(key);
    if (!g || g.rows.length <= 1 || g.methods.size <= 1) {
      return { ...m, pago_mixto: 'no', desglose_metodos_mixto: '' };
    }
    const byMethod = new Map<string, number>();
    g.rows.forEach((row) => {
      byMethod.set(row.metodo_pago, (byMethod.get(row.metodo_pago) || 0) + row.monto);
    });
    const desglose = Array.from(byMethod.entries())
      .map(([metodo, monto]) => `${formatearMetodoPagoEtiqueta(metodo)}: ${formatCOP(monto)}`)
      .join(' | ');
    return {
      ...m,
      pago_mixto: 'si',
      desglose_metodos_mixto: desglose,
    };
  });
}

export default function ReportesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const brand = useBrand();
  const { showToast } = useToast();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const puedeElegirSedeReporte =
    !!tenantUser && (tenantUser.rol === 'administrador' || tenantUser.rol === 'contador');

  const todayLocal = formatLocalDate(new Date());
  /** Permite analizar citas ya programadas en el futuro; el tope evita fechas absurdas. */
  const maxFechaReportes = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 18);
    return formatLocalDate(d);
  }, []);
  const [modoVista, setModoVista] = useState<'dia' | 'rango'>('dia');
  const [fechaSeleccionada, setFechaSeleccionada] = useState<string>(todayLocal);
  const [fechaInicio, setFechaInicio] = useState<string>(todayLocal);
  const [fechaFin, setFechaFin] = useState<string>(todayLocal);
  const [reporteSedeScope, setReporteSedeScope] = useState<ReporteSedeScope>('activa');
  const [reporteSedeId, setReporteSedeId] = useState<string>('');

  // Estados para filtros locales de movimientos
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');
  const [filtroMetodo, setFiltroMetodo] = useState<string>('todos');
  const [filtroConcepto, setFiltroConcepto] = useState<string>('');
  const [verDetalleContable, setVerDetalleContable] = useState<boolean>(false);
  /** Vista previa de PDFs propios (recibo, comprobantes); la factura DIAN sigue en nueva pestaña. */
  const [pdfPreview, setPdfPreview] = useState<{
    blobUrl: string;
    title: string;
    fileName: string;
  } | null>(null);
  const [reportesSeccion, setReportesSeccion] = useState<ReportesSeccion>('resumen');
  const [cierrePdfLoadingId, setCierrePdfLoadingId] = useState<string | null>(null);
  const [tesoreriaEgresoPdfLoadingId, setTesoreriaEgresoPdfLoadingId] = useState<string | null>(null);
  const [cajaEgresoPdfLoadingId, setCajaEgresoPdfLoadingId] = useState<string | null>(null);
  const [dsEmitLoadingId, setDsEmitLoadingId] = useState<string | null>(null);
  const [dsPdfLoadingId, setDsPdfLoadingId] = useState<string | null>(null);
  const [contingenciaEmitLoadingId, setContingenciaEmitLoadingId] = useState<string | null>(null);
  const [contingenciaRegularizar, setContingenciaRegularizar] = useState<{
    vehiculoId: string;
    sucursalId?: string | null;
    placa: string;
    numero: string;
  } | null>(null);
  const [contingenciaRegularizarLoading, setContingenciaRegularizarLoading] = useState(false);
  const rangoInvalido = modoVista === 'rango' && fechaInicio > fechaFin;
  const periodoActual = modoVista === 'rango' ? `${fechaInicio} a ${fechaFin}` : fechaSeleccionada;
  const reportesEnabled = !rangoInvalido;
  const dashboardEnabled = modoVista === 'dia';

  const sedeQuerySuffix = useMemo(() => {
    if (!puedeElegirSedeReporte) return '';
    if (reporteSedeScope === 'todas') return '&consolidar_todas=true';
    if (reporteSedeScope === 'sucursal' && reporteSedeId) {
      return `&sucursal_id=${encodeURIComponent(reporteSedeId)}`;
    }
    return '';
  }, [puedeElegirSedeReporte, reporteSedeScope, reporteSedeId]);

  const cierresCajaQueryString = useMemo(() => {
    const desde = modoVista === 'rango' ? fechaInicio : fechaSeleccionada;
    const hasta = modoVista === 'rango' ? fechaFin : fechaSeleccionada;
    let qs = `fecha_cierre_desde=${encodeURIComponent(desde)}&fecha_cierre_hasta=${encodeURIComponent(hasta)}&limit=200`;
    if (puedeElegirSedeReporte) {
      if (reporteSedeScope === 'todas') qs += '&consolidar_todas=true';
      else if (reporteSedeScope === 'sucursal' && reporteSedeId) {
        qs += `&sucursal_id=${encodeURIComponent(reporteSedeId)}`;
      }
    }
    return qs;
  }, [
    modoVista,
    fechaInicio,
    fechaFin,
    fechaSeleccionada,
    puedeElegirSedeReporte,
    reporteSedeScope,
    reporteSedeId,
  ]);

  const queryParams = useMemo(() => {
    const base =
      modoVista === 'rango'
        ? `fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`
        : `fecha=${fechaSeleccionada}`;
    return base + sedeQuerySuffix;
  }, [modoVista, fechaInicio, fechaFin, fechaSeleccionada, sedeQuerySuffix]);

  const dashboardQueryString = useMemo(
    () => `fecha=${fechaSeleccionada}${sedeQuerySuffix}`,
    [fechaSeleccionada, sedeQuerySuffix],
  );

  useEffect(() => {
    const seccionParam = (searchParams.get('seccion') || '').trim().toLowerCase() as ReportesSeccion;
    if (REPORTES_SECCIONES_SET.has(seccionParam) && seccionParam !== reportesSeccion) {
      setReportesSeccion(seccionParam);
    }
  }, [searchParams, reportesSeccion]);

  const seleccionarSeccion = useCallback(
    (next: ReportesSeccion) => {
      setReportesSeccion(next);
      const updated = new URLSearchParams(searchParams);
      updated.set('seccion', next);
      setSearchParams(updated, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Query principal: Dashboard general
  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['dashboard-general', fechaSeleccionada, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/dashboard-general?${dashboardQueryString}`);
      return response.data;
    },
    enabled: dashboardEnabled,
    refetchInterval: 60000, // Actualizar cada minuto
  });

  // Query: Movimientos detallados
  const { data: movimientosData, isFetching: isFetchingMovimientos } = useQuery({
    queryKey: ['movimientos-detallados', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/movimientos-detallados?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled && reportesSeccion === 'detalle',
    refetchInterval: reportesSeccion === 'detalle' ? 60000 : false,
  });

  const emitirDocumentoSoporteMutation = useMutation({
    mutationFn: async (payload: { modulo: 'caja' | 'tesoreria'; movimiento_id: string }) => {
      const response = await apiClient.post('/factus/documentos-soporte/emitir', payload);
      return response.data as {
        numero_documento?: string | null;
        public_url?: string | null;
        reference_code: string;
      };
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['movimientos-detallados'], type: 'active' });
      showToast(
        'success',
        'Documento soporte',
        'Emitido en Factus / DIAN. Use «Ver» para abrir el visor en una pestaña nueva.',
      );
    },
    onError: (err: unknown) => {
      const msg =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        err.response &&
        typeof err.response === 'object' &&
        'data' in err.response &&
        err.response.data &&
        typeof err.response.data === 'object' &&
        'detail' in err.response.data
          ? String((err.response.data as { detail: unknown }).detail)
          : err instanceof Error
            ? err.message
            : 'No fue posible emitir el documento soporte.';
      showToast('error', 'Factus', msg);
    },
  });

  // Query: Desglose por conceptos
  const { data: conceptosData } = useQuery({
    queryKey: ['desglose-conceptos', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/desglose-conceptos?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled && reportesSeccion === 'finanzas',
    refetchInterval: reportesSeccion === 'finanzas' ? 60000 : false,
  });

  // Query: Desglose por medios de pago
  const { data: mediosPagoData } = useQuery({
    queryKey: ['desglose-medios-pago', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/desglose-medios-pago?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled && reportesSeccion === 'finanzas',
    refetchInterval: reportesSeccion === 'finanzas' ? 60000 : false,
  });

  // Query: Trámites detallados
  const { data: tramitesData, isFetching: isFetchingTramites } = useQuery({
    queryKey: ['tramites-detallados', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/tramites-detallados?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled && reportesSeccion === 'detalle',
    refetchInterval: reportesSeccion === 'detalle' ? 60000 : false,
  });

  const { data: comparativoData } = useQuery({
    queryKey: ['comparativo-sedes', fechaSeleccionada],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/comparativo-sedes?fecha=${fechaSeleccionada}`);
      return response.data as {
        fecha: string;
        sedes: Array<{
          sucursal_id: string;
          nombre: string;
          tramites_registrados: number;
          ingresos_caja: number;
          ingresos_tesoreria: number;
          ingresos_total: number;
        }>;
      };
    },
    enabled: reportesEnabled && reportesSeccion === 'resumen' && modoVista === 'dia' && puedeElegirSedeReporte,
    refetchInterval: reportesSeccion === 'resumen' ? 60000 : false,
  });

  const { data: operativoData } = useQuery({
    queryKey: ['dashboard-operativo', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: () =>
      reportesApi.getDashboardOperativo({
        modoVista,
        fechaSeleccionada,
        fechaInicio,
        fechaFin,
        sedeQuerySuffix,
      }),
    enabled: reportesEnabled && reportesSeccion === 'operacion',
    refetchInterval: reportesSeccion === 'operacion' ? 60000 : false,
  });

  const agendamientoQueryParams = useMemo(() => {
    return modoVista === 'rango'
      ? `fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`
      : `fecha=${fechaSeleccionada}`;
  }, [modoVista, fechaInicio, fechaFin, fechaSeleccionada]);

  const {
    data: agendamientoMetricas,
    isFetching: isFetchingAgendamiento,
    isError: isErrorAgendamiento,
  } = useQuery<AgendamientoMetricasResponse>({
    queryKey: ['reportes-agendamiento-metricas', agendamientoQueryParams],
    queryFn: () => reportesApi.getAgendamientoMetricas(agendamientoQueryParams),
    enabled: reportesEnabled && reportesSeccion === 'citas',
    refetchInterval: reportesSeccion === 'citas' ? 60000 : false,
  });

  const {
    data: cierresCajaRows = [],
    isFetching: isFetchingCierresCaja,
    isError: isErrorCierresCaja,
  } = useQuery<CierreCajaReporteItem[]>({
    queryKey: ['reportes-cierres-caja', cierresCajaQueryString, reportesSeccion],
    queryFn: () => reportesApi.getCierresCaja(cierresCajaQueryString),
    enabled: reportesEnabled && reportesSeccion === 'cierres',
    refetchInterval: reportesSeccion === 'cierres' ? 60000 : false,
  });

  const {
    data: provisionIvaData,
    isFetching: isFetchingProvisionIva,
    isError: isErrorProvisionIva,
  } = useQuery<ProvisionIvaData>({
    queryKey: ['reportes-provision-iva', queryParams, reportesSeccion],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/provisiones-iva?${queryParams}`);
      return response.data as ProvisionIvaData;
    },
    enabled: reportesEnabled && reportesSeccion === 'provisiones',
    refetchInterval: reportesSeccion === 'provisiones' ? 60000 : false,
  });

  const marcarProvisionIvaMutation = useMutation({
    mutationFn: async () => {
      const body: {
        fecha_inicio: string;
        fecha_fin: string;
        sucursal_id?: string;
        consolidar_todas?: boolean;
      } = {
        fecha_inicio: modoVista === 'rango' ? fechaInicio : fechaSeleccionada,
        fecha_fin: modoVista === 'rango' ? fechaFin : fechaSeleccionada,
      };
      if (puedeElegirSedeReporte) {
        if (reporteSedeScope === 'todas') {
          body.consolidar_todas = true;
        } else if (reporteSedeScope === 'sucursal' && reporteSedeId.trim()) {
          body.sucursal_id = reporteSedeId.trim();
        }
      }
      const response = await apiClient.post('/reportes/provisiones-iva/marcar-rango', body);
      return response.data as {
        lote_id?: string | null;
        ventas_en_rango: number;
        ventas_marcadas: number;
        ventas_ya_provisionadas: number;
        iva_marcado_total: number;
      };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['reportes-provision-iva'] });
      const msg = `Marcadas: ${data.ventas_marcadas} · Ya provisionadas: ${data.ventas_ya_provisionadas}`;
      showToast('success', 'Provisión IVA actualizada', `${msg} · IVA marcado: ${formatCOP(data.iva_marcado_total)}`);
    },
    onError: (error: unknown) => {
      const message =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'data' in error.response &&
        error.response.data &&
        typeof error.response.data === 'object' &&
        'detail' in error.response.data
          ? String((error.response.data as { detail: unknown }).detail)
          : 'No se pudo marcar la provisión de IVA del rango seleccionado.';
      showToast('error', 'Provisión IVA', message);
    },
  });

  const contingenciaParams = useMemo(() => {
    const params: {
      dias: number;
      consolidarTodas?: boolean;
      sucursalId?: string;
      limit?: number;
    } = {
      dias: 45,
      limit: 300,
    };
    if (puedeElegirSedeReporte) {
      if (reporteSedeScope === 'todas') {
        params.consolidarTodas = true;
      } else if (reporteSedeScope === 'sucursal' && reporteSedeId.trim()) {
        params.sucursalId = reporteSedeId.trim();
      }
    }
    return params;
  }, [puedeElegirSedeReporte, reporteSedeId, reporteSedeScope]);

  const {
    data: facturacionContingenciaData,
    isFetching: isFetchingFacturacionContingencia,
    isError: isErrorFacturacionContingencia,
  } = useQuery<FacturacionContingenciaListResponse>({
    queryKey: ['reportes-facturacion-contingencia', contingenciaParams, reportesSeccion],
    queryFn: () => reportesApi.getFacturacionContingencia(contingenciaParams),
    enabled: reportesEnabled && reportesSeccion === 'contingencia',
    refetchInterval: reportesSeccion === 'contingencia' ? 60000 : false,
  });

  const emitirFacturaContingenciaMutation = useMutation({
    mutationFn: async (payload: { vehiculoId: string; sucursalId?: string | null }) =>
      reportesApi.emitirFacturaContingencia(payload.vehiculoId, { sucursalId: payload.sucursalId }),
    onMutate: (payload: { vehiculoId: string }) => {
      setContingenciaEmitLoadingId(payload.vehiculoId);
    },
    onSuccess: async (resp) => {
      await queryClient.invalidateQueries({ queryKey: ['reportes-facturacion-contingencia'] });
      await queryClient.invalidateQueries({ queryKey: ['tramites-detallados'] });
      showToast(
        'success',
        'Factura emitida',
        `Factura ${resp.numero_factura_dian} generada correctamente desde contingencia.`,
      );
    },
    onError: (error: unknown) => {
      const message =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'data' in error.response &&
        error.response.data &&
        typeof error.response.data === 'object' &&
        'detail' in error.response.data
          ? String((error.response.data as { detail: unknown }).detail)
          : 'No se pudo emitir la factura de contingencia.';
      showToast('error', 'Facturación contingencia', message);
    },
    onSettled: () => {
      setContingenciaEmitLoadingId(null);
    },
  });

  const marcarContingenciaRegularizada = async () => {
    if (!contingenciaRegularizar) return;
    const numero = contingenciaRegularizar.numero.trim();
    if (!numero) {
      showToast('error', 'Facturación contingencia', 'Indique el número de factura ya emitida en Factus.');
      return;
    }
    setContingenciaRegularizarLoading(true);
    try {
      const resp = await reportesApi.marcarFacturaContingenciaRegularizada(
        contingenciaRegularizar.vehiculoId,
        { numero_factura_dian: numero },
        { sucursalId: contingenciaRegularizar.sucursalId },
      );
      const placaOk = contingenciaRegularizar.placa;
      setContingenciaRegularizar(null);
      await queryClient.invalidateQueries({ queryKey: ['reportes-facturacion-contingencia'] });
      await queryClient.invalidateQueries({ queryKey: ['tramites-detallados'] });
      showToast(
        'success',
        'Contingencia',
        `Placa ${placaOk}: marcada con factura ${resp.numero_factura_dian} (sin reemitir).`,
      );
    } catch (error: unknown) {
      const message =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'data' in error.response &&
        error.response.data &&
        typeof error.response.data === 'object' &&
        'detail' in error.response.data
          ? String((error.response.data as { detail: unknown }).detail)
          : 'No se pudo marcar como regularizada.';
      showToast('error', 'Facturación contingencia', message);
    } finally {
      setContingenciaRegularizarLoading(false);
    }
  };

  // Filtrar movimientos localmente (memoizado para evitar recálculo en cada render).
  const movimientosFiltrados = useMemo(() => {
    const movimientos = movimientosData?.movimientos || [];
    const q = filtroConcepto.trim().toLowerCase();
    const sinFiltroTipo = filtroTipo === 'todos';
    const sinFiltroMetodo = filtroMetodo === 'todos';
    const sinFiltroTexto = q === '';
    if (sinFiltroTipo && sinFiltroMetodo && sinFiltroTexto) return movimientos;
    return movimientos.filter((m: Movimiento) => {
      const cumpleTipo = sinFiltroTipo || m.tipo_movimiento === filtroTipo;
      const cumpleMetodo = sinFiltroMetodo || m.metodo_pago === filtroMetodo;
      const cumpleTexto =
        sinFiltroTexto ||
        m.concepto.toLowerCase().includes(q) ||
        (m.beneficiario && m.beneficiario.toLowerCase().includes(q)) ||
        (m.beneficiario_tipo_identificacion &&
          m.beneficiario_tipo_identificacion.toLowerCase().includes(q)) ||
        (m.beneficiario_numero_identificacion &&
          m.beneficiario_numero_identificacion.toLowerCase().includes(q)) ||
        (m.numero_comprobante && m.numero_comprobante.toLowerCase().includes(q));
      return cumpleTipo && cumpleMetodo && cumpleTexto;
    });
  }, [movimientosData?.movimientos, filtroTipo, filtroMetodo, filtroConcepto]);
  const movimientosMostrados = useMemo(
    () => (verDetalleContable ? movimientosFiltrados : compactarMovimientosMixtos(movimientosFiltrados)),
    [movimientosFiltrados, verDetalleContable]
  );

  // Obtener valores únicos para los filtros
  const tiposUnicos: string[] = useMemo(
    () => Array.from(new Set((movimientosData?.movimientos || []).map((m: Movimiento) => m.tipo_movimiento))),
    [movimientosData?.movimientos],
  );
  const metodosUnicos: string[] = useMemo(
    () => Array.from(new Set((movimientosData?.movimientos || []).map((m: Movimiento) => m.metodo_pago))),
    [movimientosData?.movimientos],
  );

  // Función para limpiar filtros
  const limpiarFiltros = () => {
    setFiltroTipo('todos');
    setFiltroMetodo('todos');
    setFiltroConcepto('');
  };

  const cerrarPdfPreview = useCallback(() => {
    setPdfPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.blobUrl);
      }
      return null;
    });
  }, []);

  /** Sustituye la vista previa y libera el blob anterior si había uno abierto. */
  const abrirPdfPreview = useCallback((next: { blobUrl: string; title: string; fileName: string }) => {
    setPdfPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.blobUrl);
      }
      return next;
    });
  }, []);

  const abrirReciboCliente = async (vehiculoId: string) => {
    try {
      const v = await vehiculosApi.obtenerPorId(vehiculoId);
      const comisionFinal = v.tiene_soat ? v.comision_soat : 0;
      const { generarPDFReciboPagoParaEnvio } = await import('../utils/generarPDFReciboPago');
      const { blob } = await generarPDFReciboPagoParaEnvio({
        placa: v.placa,
        tipoVehiculo: v.tipo_vehiculo,
        marca: v.marca,
        modelo: v.modelo,
        anoModelo: v.ano_modelo,
        clienteNombre: v.cliente_nombre,
        clienteDocumento: v.cliente_documento,
        valorRTM: v.valor_rtm,
        comisionSOAT: comisionFinal,
        totalCobrado: v.total_cobrado,
        metodoPago: v.metodo_pago || 'efectivo',
        numeroFacturaDIAN: v.numero_factura_dian || '',
        fecha: v.fecha_pago ? new Date(v.fecha_pago) : new Date(),
        nombreCajero: v.cajero_nombre?.trim() || user?.nombre_completo || 'Cajero',
        logoUrl: brand.logoSrc,
      });
      const url = URL.createObjectURL(blob);
      abrirPdfPreview({
        blobUrl: url,
        title: 'Recibo de pago',
        fileName: `Recibo_${v.placa.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`,
      });
    } catch {
      alert('No fue posible generar el recibo. El trámite debe estar cobrado.');
    }
  };

  const abrirEnlaceNuevoTab = (url: string | null | undefined, mensajeSiVacio: string) => {
    const u = (url || '').trim();
    if (!u) {
      alert(mensajeSiVacio);
      return;
    }
    // Factus/DIAN suelen bloquear iframes (X-Frame-Options); en pestaña nueva sí carga.
    const w = window.open(u, '_blank', 'noopener,noreferrer');
    if (!w) {
      alert('Permita ventanas emergentes para este sitio o abra el enlace manualmente.');
    }
  };

  const abrirFacturaOficial = (url: string | null | undefined) => {
    abrirEnlaceNuevoTab(
      url,
      'No hay factura electrónica registrada para este cobro (modo manual o aún sin URL).',
    );
  };

  useEffect(() => {
    if (!pdfPreview) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cerrarPdfPreview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdfPreview, cerrarPdfPreview]);

  // Función para exportar a CSV
  const exportarCSV = (datos: any[], nombreArchivo: string) => {
    const periodoArchivo = modoVista === 'rango'
      ? `${fechaInicio}_a_${fechaFin}`
      : fechaSeleccionada;

    if (!datos || datos.length === 0) return;

    // Obtener encabezados
    const headers = Object.keys(datos[0]);
    
    // Crear filas CSV
    const csvContent = [
      headers.join(','),
      ...datos.map(row => 
        headers.map(header => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          // Escapar comas y comillas
          if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
            return `"${value.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
          }
          return value;
        }).join(',')
      )
    ].join('\n');

    // Crear blob y descargar
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${nombreArchivo}_${periodoArchivo}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reporteSedeOpts = {
    consolidarTodas: reporteSedeScope === 'todas',
    sucursalId:
      reporteSedeScope === 'sucursal' && reporteSedeId.trim()
        ? reporteSedeId.trim()
        : undefined,
  };

  const verComprobanteCierreReporte = async (cajaId: string) => {
    setCierrePdfLoadingId(cajaId);
    try {
      const blob = await cajasApi.descargarComprobanteCierre(cajaId);
      if (!blob || blob.size === 0) {
        showToast('error', 'PDF vacío', 'El comprobante no se generó correctamente.');
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      abrirPdfPreview({
        blobUrl,
        title: 'Comprobante de cierre de caja',
        fileName: `comprobante_cierre_${cajaId.slice(0, 8)}.pdf`,
      });
    } catch {
      showToast('error', 'No se pudo abrir', 'No fue posible obtener el comprobante de cierre.');
    } finally {
      setCierrePdfLoadingId(null);
    }
  };

  const verComprobanteEgresoTesoreriaReporte = async (movimientoId: string) => {
    setTesoreriaEgresoPdfLoadingId(movimientoId);
    try {
      const { blob, filename } = await tesoreriaApi.obtenerComprobanteEgresoPdf(movimientoId, reporteSedeOpts);
      if (!blob || blob.size === 0) {
        showToast('error', 'PDF vacío', 'El comprobante no se generó correctamente.');
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      abrirPdfPreview({
        blobUrl,
        title: 'Comprobante de egreso (tesorería)',
        fileName: filename,
      });
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : 'Error al obtener el comprobante de tesorería.';
      showToast('error', 'No se pudo abrir', msg);
    } finally {
      setTesoreriaEgresoPdfLoadingId(null);
    }
  };

  const verComprobanteEgresoCajaReporte = async (movimientoId: string) => {
    setCajaEgresoPdfLoadingId(movimientoId);
    try {
      const { blob, filename } = await cajasApi.obtenerComprobanteEgresoCajaPdf(movimientoId, reporteSedeOpts);
      if (!blob || blob.size === 0) {
        showToast('error', 'PDF vacío', 'El comprobante no se generó correctamente.');
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      abrirPdfPreview({
        blobUrl,
        title: 'Comprobante de egreso (caja)',
        fileName: filename,
      });
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : 'Error al obtener el comprobante de caja.';
      showToast('error', 'No se pudo abrir', msg);
    } finally {
      setCajaEgresoPdfLoadingId(null);
    }
  };

  const verDocumentoSoportePdf = async (m: Movimiento) => {
    const mod = moduloDocumentoSoporteApi(m);
    let pub = (m.documento_soporte_public_url || '').trim();
    if (pub && urlPareceAssetMarcaOImagen(pub)) {
      pub = '';
    }
    if (!pub) {
      try {
        const { data } = await apiClient.get<{ public_url: string }>(
          `/factus/documentos-soporte/enlace-publico/${mod}/${m.id}`,
        );
        pub = (data?.public_url || '').trim();
        if (pub) {
          void queryClient.invalidateQueries({ queryKey: ['movimientos-detallados'] });
        }
      } catch {
        /* sigue: proxy PDF o mensaje */
      }
    }
    if (pub && urlPareceAssetMarcaOImagen(pub)) {
      pub = '';
    }

    const abrirPdfDesdeProxy = async (): Promise<boolean> => {
      setDsPdfLoadingId(m.id);
      try {
        const response = await apiClient.get(`/factus/documentos-soporte/pdf/${mod}/${m.id}`, {
          responseType: 'blob',
        });
        const blob = response.data as Blob;
        if (!blob || blob.size === 0) {
          showToast('error', 'PDF vacío', 'Factus no devolvió el documento soporte.');
          return false;
        }
        const blobUrl = URL.createObjectURL(blob);
        abrirPdfPreview({
          blobUrl,
          title: `Documento soporte ${(m.documento_soporte_numero || '').trim() || m.id.slice(0, 8)}`,
          fileName: `documento_soporte_${m.id.slice(0, 8)}.pdf`,
        });
        return true;
      } catch (e: unknown) {
        let msg = 'Error al descargar el documento soporte.';
        if (e instanceof Error) {
          msg = e.message;
        }
        const ax = e as { response?: { data?: unknown; status?: number } };
        const data = ax.response?.data;
        if (data instanceof Blob) {
          try {
            const text = await data.text();
            const trimmed = text.trim();
            if (trimmed.startsWith('{')) {
              const parsed = JSON.parse(trimmed) as { detail?: unknown };
              const d = parsed.detail;
              msg =
                typeof d === 'string'
                  ? d
                  : Array.isArray(d)
                    ? d.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: string }).msg) : String(x))).join(' ')
                    : 'No fue posible obtener el PDF (revise el mensaje del servidor o Factus).';
            } else if (trimmed) {
              msg = trimmed.slice(0, 500);
            } else {
              msg = 'No fue posible obtener el PDF (revise sesión o configuración Factus).';
            }
          } catch {
            msg = 'No fue posible obtener el PDF (revise sesión o configuración Factus).';
          }
        }
        showToast('error', 'Documento soporte', msg);
        return false;
      } finally {
        setDsPdfLoadingId(null);
      }
    };

    // Enlaces típicos DIAN (searchqr / documentkey): abren formulario «Buscar»; el PDF es la vista directa.
    if (pub && urlDianPareceConsultaConPasoExtra(pub)) {
      const ok = await abrirPdfDesdeProxy();
      if (!ok && pub) {
        abrirEnlaceNuevoTab(
          pub,
          'No hay enlace público del documento soporte. Revise Factus o vuelva a emitir.',
        );
      }
      return;
    }

    if (pub) {
      abrirEnlaceNuevoTab(
        pub,
        'No hay enlace público del documento soporte. Revise Factus o vuelva a emitir.',
      );
      return;
    }

    await abrirPdfDesdeProxy();
  };

  const emitirDocumentoSoporte = async (m: Movimiento) => {
    const mod = moduloDocumentoSoporteApi(m);
    setDsEmitLoadingId(m.id);
    try {
      await emitirDocumentoSoporteMutation.mutateAsync({
        modulo: mod,
        movimiento_id: m.id,
      });
    } catch {
      /* el toast va en onError del mutation */
    } finally {
      setDsEmitLoadingId(null);
    }
  };

  if (dashboardEnabled && isLoading) {
    return (
      <Layout title="Reportes">
        <LoadingSpinner message="Cargando panel de reportes..." />
      </Layout>
    );
  }

  if (dashboardEnabled && (isError || !data)) {
    return (
      <Layout title="Reportes">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800 font-bold">No fue posible cargar los datos del dashboard.</p>
        </div>
      </Layout>
    );
  }

  const resumen = data?.resumen ?? {
    total_ingresos_dia: 0,
    total_egresos_dia: 0,
    utilidad_dia: 0,
    saldo_total: 0,
    tramites_atendidos: 0,
  };
  const desglose_modulos = data?.desglose_modulos ?? {
    caja: { ingresos: 0, egresos: 0, saldo: 0 },
    tesoreria: { ingresos: 0, egresos: 0, saldo: 0 },
  };
  const grafica_ingresos_7_dias = data?.grafica_ingresos_7_dias ?? [];

  return (
    <Layout title="Reportes - Dashboard General">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-primary-600" />
              Dashboard General del CDA
            </h2>
            <p className="text-slate-600">
              Resumen consolidado de todos los módulos
            </p>
            <p className="mt-1 text-sm text-primary-700 font-medium">
              Periodo aplicado: {periodoActual}
            </p>
          </div>

          {/* Controles de Fecha y Exportación */}
          <div className="flex items-end gap-4">
            {/* Selector de Modo */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Modo:
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setModoVista('dia')}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                    modoVista === 'dia' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Día
                </button>
                <button
                  onClick={() => setModoVista('rango')}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                    modoVista === 'rango' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Rango
                </button>
              </div>
            </div>

            {/* Selector de Fecha(s) */}
            {modoVista === 'dia' ? (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Fecha:
                </label>
                <input
                  type="date"
                  value={fechaSeleccionada}
                  onChange={(e) => setFechaSeleccionada(e.target.value)}
                  max={maxFechaReportes}
                  className="px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Desde:
                  </label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    max={maxFechaReportes}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Hasta:
                  </label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    max={maxFechaReportes}
                    min={fechaInicio}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            {/* Atajos rápidos en modo rango */}
            {modoVista === 'rango' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Atajos:
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const hoy = new Date();
                      const hace7dias = new Date(hoy);
                      hace7dias.setDate(hace7dias.getDate() - 7);
                      setFechaInicio(formatLocalDate(hace7dias));
                      setFechaFin(formatLocalDate(hoy));
                    }}
                    className="px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-800 text-sm font-semibold rounded transition"
                  >
                    Últimos 7 días
                  </button>
                  <button
                    onClick={() => {
                      const hoy = new Date();
                      const hace15dias = new Date(hoy);
                      hace15dias.setDate(hace15dias.getDate() - 15);
                      setFechaInicio(formatLocalDate(hace15dias));
                      setFechaFin(formatLocalDate(hoy));
                    }}
                    className="px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-800 text-sm font-semibold rounded transition"
                  >
                    Últimos 15 días
                  </button>
                  <button
                    onClick={() => {
                      const hoy = new Date();
                      const hace30dias = new Date(hoy);
                      hace30dias.setDate(hace30dias.getDate() - 30);
                      setFechaInicio(formatLocalDate(hace30dias));
                      setFechaFin(formatLocalDate(hoy));
                    }}
                    className="px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-800 text-sm font-semibold rounded transition"
                  >
                    Últimos 30 días
                  </button>
                  <button
                    onClick={() => {
                      const hoy = new Date();
                      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                      setFechaInicio(formatLocalDate(primerDiaMes));
                      setFechaFin(formatLocalDate(hoy));
                    }}
                    className="px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-800 text-sm font-semibold rounded transition"
                  >
                    Este mes
                  </button>
                </div>
              </div>
            )}

            {puedeElegirSedeReporte && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Alcance reporte:
                </label>
                <select
                  className="px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[220px]"
                  value={
                    reporteSedeScope === 'sucursal' && reporteSedeId
                      ? `s:${reporteSedeId}`
                      : reporteSedeScope
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'activa' || v === 'todas') {
                      setReporteSedeScope(v);
                      setReporteSedeId('');
                    } else if (v.startsWith('s:')) {
                      setReporteSedeScope('sucursal');
                      setReporteSedeId(v.slice(2));
                    }
                  }}
                >
                  <option value="activa">Sede activa (selector)</option>
                  <option value="todas">Todas las sedes</option>
                  {(tenantUser?.sucursales || []).map((s) => (
                    <option key={s.id} value={`s:${s.id}`}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={() => {
                // Exportar resumen consolidado
                const resumenCompleto = [
                  { 
                    fecha: modoVista === 'rango' ? `${fechaInicio} a ${fechaFin}` : fechaSeleccionada,
                    ingresos_dia: resumen.total_ingresos_dia,
                    egresos_dia: resumen.total_egresos_dia,
                    utilidad_dia: resumen.utilidad_dia,
                    saldo_total: resumen.saldo_total,
                    tramites_atendidos: resumen.tramites_atendidos,
                    ingresos_caja: desglose_modulos.caja.ingresos,
                    egresos_caja: desglose_modulos.caja.egresos,
                    saldo_caja: desglose_modulos.caja.saldo,
                    ingresos_tesoreria: desglose_modulos.tesoreria.ingresos,
                    egresos_tesoreria: desglose_modulos.tesoreria.egresos,
                    saldo_tesoreria: desglose_modulos.tesoreria.saldo
                  }
                ];
                exportarCSV(
                  resumenCompleto,
                  modoVista === 'rango' ? 'reporte_completo_rango' : 'reporte_completo_dia',
                );
              }}
              disabled={rangoInvalido}
              className="flex items-center gap-2 btn-primary-solid disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              Exportar Reporte Completo
            </button>
          </div>
        </div>

        {rangoInvalido && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            La fecha inicial no puede ser mayor que la fecha final.
          </div>
        )}

        <div className="sticky top-0 z-10 rounded-xl border border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-sm supports-[backdrop-filter]:bg-white/90">
          <div
            className="flex overflow-x-auto gap-0 border-b border-slate-100 px-1 pt-1 sm:px-2"
            role="tablist"
            aria-label="Secciones del panel de reportes"
          >
            {REPORTES_SECCIONES.map((s) => {
              const active = reportesSeccion === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => seleccionarSeccion(s.id)}
                  className={`min-w-[5.5rem] shrink-0 rounded-t-lg px-3 py-2.5 text-sm font-semibold transition-colors sm:min-w-0 sm:px-4 ${
                    active
                      ? 'border-b-2 border-primary-600 bg-primary-50/70 text-primary-900'
                      : 'border-b-2 border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="border-t border-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 sm:px-4">
            {REPORTES_SECCIONES.find((x) => x.id === reportesSeccion)?.hint}
          </p>
        </div>

        {reportesSeccion === 'resumen' && (
        <>
        {/* Tarjetas de Resumen Principal - Solo en modo día */}
        {modoVista === 'dia' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Ingresos del Día */}
          <div className="card-pos bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-300">
            <p className="text-sm text-green-700 mb-1 flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4" />
              Ingresos del Día
            </p>
            <p className="text-3xl font-bold text-green-900">
              {formatCOP(resumen.total_ingresos_dia)}
            </p>
          </div>

          {/* Egresos del Día */}
          <div className="card-pos bg-gradient-to-br from-red-50 to-red-100 border-2 border-red-300">
            <p className="text-sm text-red-700 mb-1 flex items-center gap-2">
              <ArrowDownCircle className="w-4 h-4" />
              Egresos del Día
            </p>
            <p className="text-3xl font-bold text-red-900">
              {formatCOP(resumen.total_egresos_dia)}
            </p>
          </div>

          {/* Utilidad del Día */}
          <div className={`card-pos border-2 ${
            resumen.utilidad_dia >= 0 
              ? 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-300' 
              : 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-300'
          }`}>
            <p className={`text-sm mb-1 flex items-center gap-2 ${resumen.utilidad_dia >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
              {resumen.utilidad_dia >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              Utilidad del Día
            </p>
            <p className={`text-3xl font-bold ${resumen.utilidad_dia >= 0 ? 'text-blue-900' : 'text-orange-900'}`}>
              {formatCOP(resumen.utilidad_dia)}
            </p>
          </div>

          {/* Saldo Total */}
          <div className="card-pos bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-300">
            <p className="text-sm text-purple-700 mb-1 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Saldo Total
            </p>
            <p className="text-3xl font-bold text-purple-900">
              {formatCOP(resumen.saldo_total)}
            </p>
            <p className="text-xs text-purple-600 mt-1">Caja + Tesorería</p>
          </div>

          {/* Trámites Atendidos */}
          <div className="card-pos bg-gradient-to-br from-yellow-50 to-yellow-100 border-2 border-yellow-300">
            <p className="text-sm text-yellow-700 mb-1 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Trámites
            </p>
            <p className="text-3xl font-bold text-yellow-900">
              {resumen.tramites_atendidos}
            </p>
            <p className="text-xs text-yellow-600 mt-1">Atendidos hoy</p>
          </div>
        </div>
        )}

        {modoVista === 'dia' && puedeElegirSedeReporte && (comparativoData?.sedes?.length ?? 0) > 0 && (
          <div className="card-pos">
            <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary-600" />
              Comparativo por sede ({comparativoData?.fecha})
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2">Sede</th>
                    <th className="px-3 py-2 text-right">Trámites</th>
                    <th className="px-3 py-2 text-right">Ingresos caja</th>
                    <th className="px-3 py-2 text-right">Ingresos tesorería</th>
                    <th className="px-3 py-2 text-right">Total ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparativoData?.sedes || []).map((row) => (
                    <tr key={row.sucursal_id} className="border-t">
                      <td className="px-3 py-2 font-medium">{row.nombre}</td>
                      <td className="px-3 py-2 text-right">{row.tramites_registrados}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(row.ingresos_caja)}</td>
                      <td className="px-3 py-2 text-right">{formatCOP(row.ingresos_tesoreria)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatCOP(row.ingresos_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Gráfica de Ingresos - Últimos 7 Días - Solo en modo día */}
        {modoVista === 'dia' && (
        <div className="card-pos">
          <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary-600" />
            Tendencia de Ingresos - Últimos 7 Días
          </h3>
          <Suspense fallback={<div className="h-[300px] rounded-lg bg-slate-100 animate-pulse" />}>
            <ReportesIngresosChart data={grafica_ingresos_7_dias} />
          </Suspense>
        </div>
        )}

        {modoVista === 'rango' && !rangoInvalido && (
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-5 py-4 shadow-sm">
            <p className="text-sm text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900">Vista Resumen en modo Rango.</span> Las tarjetas de KPI, el
              comparativo por sede y la tendencia de 7 días están disponibles en{' '}
              <span className="font-semibold">modo Día</span>. Para el periodo{' '}
              <span className="font-mono text-slate-800">{periodoActual}</span> abre{' '}
              <button
                type="button"
                className="font-semibold text-primary-700 underline decoration-primary-300 underline-offset-2 hover:no-underline"
                onClick={() => setReportesSeccion('finanzas')}
              >
                Finanzas
              </button>
              ,{' '}
              <button
                type="button"
                className="font-semibold text-primary-700 underline decoration-primary-300 underline-offset-2 hover:no-underline"
                onClick={() => setReportesSeccion('operacion')}
              >
                Operación
              </button>
              ,{' '}
              <button
                type="button"
                className="font-semibold text-primary-700 underline decoration-primary-300 underline-offset-2 hover:no-underline"
                onClick={() => setReportesSeccion('citas')}
              >
                Citas
              </button>{' '}
              o{' '}
              <button
                type="button"
                className="font-semibold text-primary-700 underline decoration-primary-300 underline-offset-2 hover:no-underline"
                onClick={() => setReportesSeccion('detalle')}
              >
                Detalle
              </button>
              .
            </p>
          </div>
        )}
        </>
        )}

        {reportesSeccion === 'finanzas' && (
        <>
        {modoVista === 'rango' && !rangoInvalido && (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
            En <strong>modo Rango</strong>, los bloques de Caja y Tesorería siguen mostrando saldos del{' '}
            <strong>dashboard diario</strong> (no se recalculan por el rango). Para el periodo{' '}
            <span className="font-mono">{periodoActual}</span> usa los desgloses por concepto y por medio de pago, o
            cambia a <strong>modo Día</strong> para alinear todo a una sola fecha.
          </div>
        )}

        {/* Desglose por Módulo - Solo en modo día */}
        {modoVista === 'dia' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Módulo Caja */}
          <div className="card-pos">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary-600" />
              Módulo de Caja
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <span className="font-semibold text-gray-700">Ingresos</span>
                <span className="text-xl font-bold text-green-600">
                  {formatCOP(desglose_modulos.caja.ingresos)}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                <span className="font-semibold text-gray-700">Egresos</span>
                <span className="text-xl font-bold text-red-600">
                  {formatCOP(desglose_modulos.caja.egresos)}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg border-2 border-blue-300">
                <span className="font-bold text-gray-900">Saldo Actual</span>
                <span className="text-2xl font-bold text-blue-700">
                  {formatCOP(desglose_modulos.caja.saldo)}
                </span>
              </div>
            </div>
          </div>

          {/* Módulo Tesorería */}
          <div className="card-pos">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary-600" />
              Módulo de Tesorería
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <span className="font-semibold text-gray-700">Ingresos</span>
                <span className="text-xl font-bold text-green-600">
                  {formatCOP(desglose_modulos.tesoreria.ingresos)}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                <span className="font-semibold text-gray-700">Egresos</span>
                <span className="text-xl font-bold text-red-600">
                  {formatCOP(desglose_modulos.tesoreria.egresos)}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg border-2 border-purple-300">
                <span className="font-bold text-gray-900">Saldo Actual</span>
                <span className="text-2xl font-bold text-purple-700">
                  {formatCOP(desglose_modulos.tesoreria.saldo)}
                </span>
              </div>
            </div>
          </div>
        </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-pos">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-6 h-6 text-primary-600" />
                Desglose por Conceptos
              </h3>
            </div>
            <div className="space-y-2">
              {Object.keys(conceptosData?.ingresos_por_concepto || {}).length === 0 &&
                Object.keys(conceptosData?.egresos_por_concepto || {}).length === 0 && (
                  <p className="text-sm text-slate-500">No hay movimientos por concepto en este periodo.</p>
                )}
              {Object.entries(conceptosData?.ingresos_por_concepto || {}).map(([k, v]: any) => (
                <div key={k} className="flex justify-between text-green-700"><span>{k}</span><span className="font-semibold">{formatCOP(Number(v))}</span></div>
              ))}
              {Object.entries(conceptosData?.egresos_por_concepto || {}).map(([k, v]: any) => (
                <div key={k} className="flex justify-between text-red-700"><span>{k}</span><span className="font-semibold">{formatCOP(Number(v))}</span></div>
              ))}
            </div>
          </div>
          <div className="card-pos">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <CalendarDays className="w-6 h-6 text-primary-600" />
                Métodos de Pago
              </h3>
              <p className="text-sm text-slate-600">Total recaudado por método</p>
            </div>
            <div className="space-y-2">
              {Object.keys(mediosPagoData?.medios_pago || {}).length === 0 && (
                <p className="text-sm text-slate-500">No hay recaudo por método de pago en este periodo.</p>
              )}
              {Object.entries(mediosPagoData?.medios_pago || {}).map(([metodo, vals]: any) => (
                <div key={metodo} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition">
                  <span className="font-semibold text-slate-700 capitalize">{metodo.replace('_', ' ')}:</span>
                  <span className="text-xl font-bold text-green-600">{formatCOP(Number((vals as any).total))}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        </>
        )}

        {reportesSeccion === 'operacion' && (
        <div className="card-pos">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <GaugeCircle className="w-6 h-6 text-primary-600" />
              Dashboard Operativo (SLA y Colas)
            </h3>
            <p className="text-sm text-slate-600">Periodo: {operativoData?.periodo || periodoActual}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 mb-5 md:grid-cols-3 lg:grid-cols-7">
            <div className="rounded-lg border border-slate-200 p-3 bg-white">
              <p className="text-xs text-slate-500">Pendientes caja</p>
              <p className="text-2xl font-bold text-amber-700">{operativoData?.resumen_operativo.pendientes_caja ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 bg-white">
              <p className="text-xs text-slate-500">Pendientes pista</p>
              <p className="text-2xl font-bold text-blue-700">{operativoData?.resumen_operativo.pendientes_pista ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 bg-white">
              <p className="text-xs text-slate-500">En pista</p>
              <p className="text-2xl font-bold text-indigo-700">{operativoData?.resumen_operativo.en_pista ?? 0}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">Reintentos validados</p>
              <p className="text-2xl font-bold text-emerald-800">
                {operativoData?.resumen_operativo.reintentos_validados_periodo ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 bg-white">
              <p className="text-xs text-slate-500">SLA promedio</p>
              <p className="text-2xl font-bold text-emerald-700">{operativoData?.sla.promedio_minutos ?? 0} min</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 bg-white">
              <p className="text-xs text-slate-500">SLA p90</p>
              <p className="text-2xl font-bold text-violet-700">{operativoData?.sla.p90_minutos ?? 0} min</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 bg-white">
              <p className="text-xs text-slate-500">Cumplimiento SLA</p>
              <p className="text-2xl font-bold text-slate-900">{operativoData?.sla.cumplimiento_objetivo_pct ?? 0}%</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Casos en riesgo por espera en caja
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2">Placa</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2 text-right">Espera (min)</th>
                  </tr>
                </thead>
                <tbody>
                  {(operativoData?.casos_en_riesgo || []).length === 0 && (
                    <tr className="border-t">
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        Sin casos críticos en cola para este momento.
                      </td>
                    </tr>
                  )}
                  {(operativoData?.casos_en_riesgo || []).map((caso) => (
                    <tr key={caso.id} className="border-t">
                      <td className="px-3 py-2 font-mono">{caso.placa}</td>
                      <td className="px-3 py-2">{caso.cliente}</td>
                      <td className="px-3 py-2 capitalize">{caso.estado.replace('_', ' ')}</td>
                      <td className="px-3 py-2 text-right font-semibold">{caso.minutos_espera}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
              <TimerReset className="w-3.5 h-3.5" />
              Objetivo SLA: {operativoData?.sla.objetivo_minutos ?? 30} min registro → pago (muestra: {operativoData?.sla.muestra ?? 0}).
            </p>
          </div>
        </div>
        )}

        {reportesSeccion === 'citas' && (
        <div className="card-pos border-2 border-sky-100 bg-gradient-to-br from-sky-50/40 to-white">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <CalendarDays className="w-6 h-6 text-sky-600" />
                Métricas de agendamiento
              </h3>
              <p className="text-sm text-slate-600 mt-1 max-w-3xl">
                KPIs según la <span className="font-semibold">fecha y hora programada de la cita</span> dentro del
                periodo <span className="font-semibold text-sky-800">«{agendamientoMetricas?.periodo ?? periodoActual}»</span>{' '}
                (mismo filtro que arriba: Día o Rango). Alcance: <span className="font-semibold">todo el tenant</span>{' '}
                (sin sede por cita en el modelo actual).
              </p>
              <p className="text-xs text-slate-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <TimerReset className="w-3.5 h-3.5" />
                  Auto-actualización cada 60 s
                </span>
                <span>
                  Último cálculo:{' '}
                  {agendamientoMetricas?.fecha_generacion
                    ? new Date(agendamientoMetricas.fecha_generacion).toLocaleString('es-CO')
                    : '—'}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const m = agendamientoMetricas;
                if (!m) return;
                exportarCSV(
                  [
                    {
                      periodo: m.periodo,
                      total_citas: m.total_citas,
                      tasa_check_in_pct: m.tasa_check_in_pct,
                      scheduled: m.por_estado.scheduled,
                      confirmed: m.por_estado.confirmed,
                      checked_in: m.por_estado.checked_in,
                      cancelled: m.por_estado.cancelled,
                      no_show: m.por_estado.no_show,
                      origen_link_publico: m.por_origen.public_link,
                      origen_manual: m.por_origen.manual,
                      citas_con_email: m.citas_con_email,
                      citas_sin_email: m.citas_sin_email,
                      recordatorios_enviados: m.recordatorios_enviados,
                      recordatorios_pendientes: m.recordatorios_pendientes,
                      recordatorios_fallidos: m.recordatorios_fallidos,
                    },
                  ],
                  `agendamiento_kpi_${m.periodo.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')}`,
                );
                if (m.serie_diaria.length > 0) {
                  exportarCSV(m.serie_diaria, `agendamiento_serie_${m.periodo.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')}`);
                }
              }}
              disabled={rangoInvalido || !agendamientoMetricas}
              className="flex items-center gap-2 btn-corporate-muted disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Download className="w-4 h-4" />
              Exportar KPI + serie
            </button>
          </div>

          {isFetchingAgendamiento && !agendamientoMetricas && (
            <p className="text-sm text-slate-500 mb-3">Cargando métricas de citas…</p>
          )}

          {isErrorAgendamiento && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
              No se pudieron cargar las métricas de agendamiento. Intenta recargar la página.
            </p>
          )}

          {agendamientoMetricas && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">Total citas</p>
                  <p className="text-2xl font-bold text-slate-900">{agendamientoMetricas.total_citas}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">Tasa check-in</p>
                  <p className="text-2xl font-bold text-emerald-700">{agendamientoMetricas.tasa_check_in_pct}%</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Sobre citas no canceladas</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">Pipeline (agend. + conf.)</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {agendamientoMetricas.por_estado.scheduled + agendamientoMetricas.por_estado.confirmed}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">En recepción</p>
                  <p className="text-2xl font-bold text-teal-700">{agendamientoMetricas.por_estado.checked_in}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">Canceladas</p>
                  <p className="text-2xl font-bold text-amber-700">{agendamientoMetricas.por_estado.cancelled}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">No asistió</p>
                  <p className="text-2xl font-bold text-slate-600">{agendamientoMetricas.por_estado.no_show}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Origen de la cita</p>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      <span className="text-slate-500">Link público:</span>{' '}
                      <b className="text-slate-900">{agendamientoMetricas.por_origen.public_link}</b>
                    </span>
                    <span>
                      <span className="text-slate-500">Manual (equipo):</span>{' '}
                      <b className="text-slate-900">{agendamientoMetricas.por_origen.manual}</b>
                    </span>
                    {agendamientoMetricas.por_origen.otros > 0 && (
                      <span>
                        <span className="text-slate-500">Otros:</span>{' '}
                        <b className="text-slate-900">{agendamientoMetricas.por_origen.otros}</b>
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Correo y recordatorios</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-slate-500">Con correo</span>
                      <p className="font-bold text-slate-900">{agendamientoMetricas.citas_con_email}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Sin correo</span>
                      <p className="font-bold text-slate-900">{agendamientoMetricas.citas_sin_email}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Record. enviados</span>
                      <p className="font-bold text-emerald-700">{agendamientoMetricas.recordatorios_enviados}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Pendientes</span>
                      <p className="font-bold text-amber-700">{agendamientoMetricas.recordatorios_pendientes}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Fallidos</span>
                      <p className="font-bold text-red-600">{agendamientoMetricas.recordatorios_fallidos}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Omitidos</span>
                      <p className="font-bold text-slate-600">{agendamientoMetricas.recordatorios_omitidos}</p>
                    </div>
                  </div>
                </div>
              </div>

              {agendamientoMetricas.serie_diaria.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-3">Serie por día (en el periodo)</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-600 border-b">
                          <th className="px-3 py-2">Fecha</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Check-in</th>
                          <th className="px-3 py-2 text-right">Canceladas</th>
                          <th className="px-3 py-2 text-right">No asistió</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agendamientoMetricas.serie_diaria.map((row) => (
                          <tr key={row.fecha} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-mono text-xs">{row.fecha}</td>
                            <td className="px-3 py-2 text-right font-semibold">{row.total}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{row.checked_in}</td>
                            <td className="px-3 py-2 text-right text-amber-700">{row.canceladas}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{row.no_show}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}

        {reportesSeccion === 'cierres' && (
        <div className="card-pos border border-slate-200/90">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                <Lock className="h-6 w-6 text-primary-600" />
                Cierres de caja por cajero
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Listado según <strong>día de cierre</strong> en Colombia, alineado al periodo de arriba (
                {modoVista === 'dia' ? `día ${fechaSeleccionada}` : `rango ${fechaInicio} → ${fechaFin}`}).
                Respeta el alcance de sede del encabezado (activa, una sede o todas).
              </p>
            </div>
            <button
              type="button"
              disabled={rangoInvalido || cierresCajaRows.length === 0}
              onClick={() => {
                const filas = cierresCajaRows.map((r) => ({
                  cajero: r.cajero_nombre,
                  sede: r.sucursal_nombre ?? '',
                  turno: r.turno,
                  fecha_apertura: r.fecha_apertura,
                  fecha_cierre: r.fecha_cierre ?? '',
                  monto_inicial: r.monto_inicial,
                  saldo_sistema: r.monto_final_sistema ?? '',
                  efectivo_contado: r.monto_final_fisico ?? '',
                  diferencia: r.diferencia ?? '',
                  observaciones: (r.observaciones_cierre ?? '').replace(/\n/g, ' '),
                }));
                exportarCSV(filas, 'cierres_caja');
              }}
              className="btn-primary-solid inline-flex shrink-0 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-5 w-5" />
              Exportar CSV
            </button>
          </div>

          {isErrorCierresCaja && (
            <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
              No se pudo cargar el historial de cierres. Intenta de nuevo o revisa tu sesión.
            </p>
          )}
          {isFetchingCierresCaja && (
            <p className="mb-3 text-sm text-slate-500">Cargando cierres de caja…</p>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-3">Cajero</th>
                  <th className="px-3 py-3">Sede</th>
                  <th className="px-3 py-3">Turno</th>
                  <th className="px-3 py-3">Cierre</th>
                  <th className="px-3 py-3 text-right">Inicial</th>
                  <th className="px-3 py-3 text-right">Sistema</th>
                  <th className="px-3 py-3 text-right">Físico</th>
                  <th className="px-3 py-3 text-right">Dif.</th>
                  <th className="px-3 py-3">Obs.</th>
                  <th className="px-3 py-3 text-center">PDF</th>
                </tr>
              </thead>
              <tbody>
                {cierresCajaRows.length === 0 && !isFetchingCierresCaja && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                      No hay cierres registrados en este periodo y alcance de sede.
                    </td>
                  </tr>
                )}
                {cierresCajaRows.map((r) => {
                  const dif = r.diferencia ?? 0;
                  const difClass =
                    Math.abs(dif) < 0.01 ? 'text-slate-700' : dif < 0 ? 'text-red-700' : 'text-amber-800';
                  return (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{r.cajero_nombre}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.sucursal_nombre ?? '—'}</td>
                      <td className="px-3 py-2.5 capitalize text-slate-700">{r.turno}</td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {r.fecha_cierre
                          ? new Date(r.fecha_cierre).toLocaleString('es-CO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCOP(r.monto_inicial)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                        {r.monto_final_sistema != null ? formatCOP(r.monto_final_sistema) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                        {r.monto_final_fisico != null ? formatCOP(r.monto_final_fisico) : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${difClass}`}>
                        {r.diferencia != null ? formatCOP(r.diferencia) : '—'}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2.5 text-xs text-slate-600" title={r.observaciones_cierre ?? ''}>
                        {r.observaciones_cierre?.trim() ? r.observaciones_cierre.trim() : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          title="Ver comprobante de cierre (vista previa)"
                          disabled={cierrePdfLoadingId === r.id}
                          onClick={() => verComprobanteCierreReporte(r.id)}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Hasta 200 cierres más recientes en el rango. Mismo criterio de fechas que el resto del panel.</p>
        </div>
        )}

        {reportesSeccion === 'provisiones' && (
        <div className="card-pos border border-slate-200/90">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                <FileCheck className="h-6 w-6 text-primary-600" />
                Provisión de IVA causado
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Calcula el IVA causado en ventas del periodo seleccionado. Puede marcar el rango como provisionado
                para control histórico en consultas posteriores.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={rangoInvalido || (provisionIvaData?.ventas.length || 0) === 0 || marcarProvisionIvaMutation.isLoading}
                onClick={() => marcarProvisionIvaMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileCheck className="h-4 w-4" />
                Marcar provisionado
              </button>
              <button
                type="button"
                disabled={rangoInvalido || (provisionIvaData?.ventas.length || 0) === 0}
                onClick={() => exportarCSV(provisionIvaData?.ventas || [], 'provisiones_iva')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Exportar CSV
              </button>
            </div>
          </div>

          {isErrorProvisionIva && (
            <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
              No se pudo cargar el reporte de provisiones de IVA para este periodo.
            </p>
          )}
          {isFetchingProvisionIva && (
            <p className="mb-3 text-sm text-slate-500">Calculando provisiones de IVA…</p>
          )}

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">IVA causado</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{formatCOP(provisionIvaData?.resumen.iva_causado_total || 0)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">IVA provisionado</p>
              <p className="mt-1 text-xl font-bold text-emerald-800">{formatCOP(provisionIvaData?.resumen.iva_provisionado_total || 0)}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">IVA pendiente</p>
              <p className="mt-1 text-xl font-bold text-amber-800">{formatCOP(provisionIvaData?.resumen.iva_pendiente_total || 0)}</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Ventas en periodo</p>
              <p className="mt-1 text-xl font-bold text-sky-800">{provisionIvaData?.resumen.ventas_total || 0}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-3">Fecha pago</th>
                  <th className="px-3 py-3">Placa</th>
                  <th className="px-3 py-3">Cliente</th>
                  <th className="px-3 py-3">Factura</th>
                  <th className="px-3 py-3 text-right">Base</th>
                  <th className="px-3 py-3 text-right">IVA</th>
                  <th className="px-3 py-3 text-right">Excluido</th>
                  <th className="px-3 py-3">Método</th>
                  <th className="px-3 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(provisionIvaData?.ventas || []).length === 0 && !isFetchingProvisionIva && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      No hay ventas para provisión de IVA en el periodo seleccionado.
                    </td>
                  </tr>
                )}
                {(provisionIvaData?.ventas || []).map((v) => (
                  <tr key={v.vehiculo_id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2.5 text-slate-700">
                      {v.fecha_pago
                        ? new Date(v.fecha_pago).toLocaleString('es-CO', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{v.placa}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className="block">{v.cliente_nombre}</span>
                      <span className="text-xs text-slate-500">{v.cliente_documento}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{v.numero_factura_dian || '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCOP(v.base_gravable)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatCOP(v.iva_causado)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatCOP(v.valor_excluido)}</td>
                    <td className="px-3 py-2.5 text-slate-700">{formatearMetodoPagoEtiqueta(v.metodo_pago)}</td>
                    <td className="px-3 py-2.5">
                      {v.provisionado ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          Provisionado
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Pendiente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Fuente: IVA calculado por venta. Use “Marcar rango como provisionado” para registrar oficialmente el periodo provisionado.
          </p>
        </div>
        )}

        {reportesSeccion === 'contingencia' && (
        <div className="card-pos border border-slate-200/90">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                <Receipt className="h-6 w-6 text-primary-600" />
                Facturación en contingencia
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Cobros pagados sin factura electrónica registrada en CDASOFT. Use{' '}
                <strong>Generar factura</strong> si aún no existe en Factus, o{' '}
                <strong>Ya en Factus</strong> si la emitió/validó en el panel Factus (como IQV62G) y no debe
                reemitirse.
              </p>
            </div>
            <button
              type="button"
              disabled={rangoInvalido || (facturacionContingenciaData?.items.length || 0) === 0}
              onClick={() => exportarCSV(facturacionContingenciaData?.items || [], 'facturacion_contingencia')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </button>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pendientes</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{facturacionContingenciaData?.total || 0}</p>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Ventana</p>
              <p className="mt-1 text-xl font-bold text-indigo-800">
                {facturacionContingenciaData?.dias_consulta || 45} días
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Modo Factus</p>
              <p className="mt-1 text-sm font-bold text-emerald-800">
                {facturacionContingenciaData?.modo_factus_activo ? 'Activo' : 'No activo'}
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Credenciales</p>
              <p className="mt-1 text-sm font-bold text-amber-800">
                {facturacionContingenciaData?.credenciales_factus_ok ? 'Completas' : 'Incompletas'}
              </p>
            </div>
          </div>

          {isErrorFacturacionContingencia && (
            <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
              No se pudo cargar la bandeja de facturación en contingencia.
            </p>
          )}
          {isFetchingFacturacionContingencia && (
            <p className="mb-3 text-sm text-slate-500">Actualizando pendientes de contingencia...</p>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-3">Fecha pago</th>
                  <th className="px-3 py-3">Placa</th>
                  <th className="px-3 py-3">Cliente</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Método</th>
                  <th className="px-3 py-3">Factura actual</th>
                  <th className="px-3 py-3">Motivo</th>
                  <th className="px-3 py-3 text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {(facturacionContingenciaData?.items || []).length === 0 && !isFetchingFacturacionContingencia && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      Sin cobros pendientes por contingencia en el rango actual.
                    </td>
                  </tr>
                )}
                {(facturacionContingenciaData?.items || []).map((item) => (
                  <tr key={item.vehiculo_id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2.5 text-slate-700">
                      {item.fecha_pago
                        ? new Date(item.fecha_pago).toLocaleString('es-CO', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{item.placa}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className="block">{item.cliente_nombre}</span>
                      <span className="text-xs text-slate-500">{item.cliente_documento}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {formatCOP(item.total_cobrado)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{formatearMetodoPagoEtiqueta(item.metodo_pago)}</td>
                    <td className="px-3 py-2.5 text-slate-700">{item.numero_factura_dian || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {item.motivo_pendiente === 'cobro_manual_sin_factura_electronica'
                          ? 'Manual sin FE'
                          : 'Sin número de factura'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="inline-flex flex-col gap-1.5 items-stretch min-w-[9.5rem]">
                        <button
                          type="button"
                          disabled={
                            !item.puede_emitir ||
                            emitirFacturaContingenciaMutation.isLoading ||
                            contingenciaEmitLoadingId === item.vehiculo_id
                          }
                          onClick={() =>
                            emitirFacturaContingenciaMutation.mutate({
                              vehiculoId: item.vehiculo_id,
                              sucursalId: item.sucursal_id ?? null,
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            !item.puede_emitir
                              ? 'Debe activar modo Factus y completar credenciales para emitir.'
                              : 'Emitir FE nueva desde CDASOFT vía Factus'
                          }
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          {contingenciaEmitLoadingId === item.vehiculo_id ? 'Generando...' : 'Generar factura'}
                        </button>
                        <button
                          type="button"
                          disabled={contingenciaRegularizarLoading}
                          onClick={() =>
                            setContingenciaRegularizar({
                              vehiculoId: item.vehiculo_id,
                              sucursalId: item.sucursal_id ?? null,
                              placa: item.placa,
                              numero: (item.numero_factura_dian || '').trim(),
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Si ya validó/emitió esta FE en el panel Factus, márquela aquí sin volver a generar."
                        >
                          Ya en Factus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {contingenciaRegularizar && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget && !contingenciaRegularizarLoading) {
                  setContingenciaRegularizar(null);
                }
              }}
            >
              <div
                className="modal-panel max-w-md w-full shadow-xl p-5 space-y-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="contingencia-regularizar-titulo"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 id="contingencia-regularizar-titulo" className="text-base font-bold text-slate-900">
                  Ya emitida en Factus — {contingenciaRegularizar.placa}
                </h4>
                <p className="text-sm text-slate-600">
                  Use esto solo si la factura ya quedó validada en el panel Factus (como al destrabar la cola). No
                  vuelve a emitir; solo la saca de contingencia en CDASOFT.
                </p>
                <label className="block text-sm font-medium text-slate-700">
                  Número de factura DIAN / Factus
                  <input
                    className="input-corporate mt-1 w-full"
                    value={contingenciaRegularizar.numero}
                    onChange={(e) =>
                      setContingenciaRegularizar((prev) =>
                        prev ? { ...prev, numero: e.target.value } : prev,
                      )
                    }
                    placeholder="Ej. SETT123 o el número que aparece en Factus"
                    autoFocus
                  />
                </label>
                <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
                  <button
                    type="button"
                    className="flex-1 btn-corporate-muted px-3 py-2 text-sm"
                    disabled={contingenciaRegularizarLoading}
                    onClick={() => setContingenciaRegularizar(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="flex-1 btn-primary-solid px-3 py-2 text-sm"
                    disabled={contingenciaRegularizarLoading || !contingenciaRegularizar.numero.trim()}
                    onClick={() => void marcarContingenciaRegularizada()}
                  >
                    {contingenciaRegularizarLoading ? 'Guardando…' : 'Marcar regularizada'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {reportesSeccion === 'detalle' && (
        <>
        <details className="card-pos mb-4 open:bg-slate-50/80">
          <summary className="cursor-pointer list-none flex items-start gap-3 p-4 text-left">
            <Info className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-900">Alcance de facturación y documento soporte (DIAN / Factus)</span>
              <p className="text-sm text-slate-600 mt-1">
                Pulse para ver reglas de uso, trazabilidad y archivo de PDF en CDASOFT.
              </p>
            </div>
          </summary>
          <div className="px-4 pb-4 pt-0 text-sm text-slate-700 space-y-3 border-t border-slate-100">
            <p>
              La <strong>factura electrónica de venta</strong> (RTM) y el <strong>documento soporte</strong> (egresos a
              proveedores) se emiten vía <strong>Factus</strong> con los datos registrados en el movimiento. Cada emisión
              queda asociada al <strong>usuario</strong> que la generó y a la fecha/hora del sistema.
            </p>
            <p>
              Tras una emisión exitosa, el sistema intenta <strong>guardar una copia PDF</strong> en almacenamiento
              privado del CDA (con huella SHA-256) para conservación y consulta. La descarga desde la columna Docs usa esa
              copia cuando existe; si no, se obtiene el PDF desde Factus.
            </p>
            <p className="text-slate-600">
              Las <strong>retenciones</strong> y otros tributos no incluidos en el flujo actual deben validarse con su
              contador. El XML firmado permanece en Factus/DIAN según su contrato con el proveedor tecnológico.
            </p>
          </div>
        </details>
        <div className="card-pos">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-primary-600" />
              {modoVista === 'dia' ? 'Movimientos del Día' : `Movimientos (${movimientosData?.fecha || ''})`}
              <span className="text-sm text-slate-500 font-normal">
                ({movimientosMostrados.length} filas visibles · {movimientosFiltrados.length} movimientos filtrados de {movimientosData?.total_movimientos || 0})
              </span>
            </h3>
            <button 
              onClick={() =>
                exportarCSV(
                  anotarMovimientosMixtosParaCsv(movimientosFiltrados),
                  modoVista === 'rango' ? 'movimientos_rango' : 'movimientos_dia',
                )
              }
              disabled={rangoInvalido || movimientosFiltrados.length === 0}
              className="flex items-center gap-2 btn-success-solid disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              Exportar CSV (detalle)
            </button>
          </div>
          {isFetchingMovimientos && (
            <p className="mb-3 text-sm text-slate-500">Actualizando movimientos...</p>
          )}

          {/* Barra de Filtros */}
          <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Filtrar por Tipo:
                </label>
                <select
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value)}
                  className="input-corporate w-full px-3 py-2"
                >
                  <option value="todos">Todos</option>
                  {tiposUnicos.map((tipo) => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Filtrar por Método de Pago:
                </label>
                <select
                  value={filtroMetodo}
                  onChange={(e) => setFiltroMetodo(e.target.value)}
                  className="input-corporate w-full px-3 py-2"
                >
                  <option value="todos">Todos</option>
                  {metodosUnicos.map((metodo) => (
                    <option key={metodo} value={metodo}>{metodo}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Buscar (concepto, beneficiario, documento…):
                </label>
                <input
                  type="text"
                  value={filtroConcepto}
                  onChange={(e) => setFiltroConcepto(e.target.value)}
                  placeholder="Concepto, beneficiario, no. identificación, comprobante…"
                  className="input-corporate w-full px-3 py-2"
                />
              </div>

              <button
                onClick={limpiarFiltros}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-800 font-semibold rounded-lg transition-all"
              >
                Limpiar Filtros
              </button>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">
                <input
                  type="checkbox"
                  checked={verDetalleContable}
                  onChange={(e) => setVerDetalleContable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Ver detalle contable (sin compactar mixtos)
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Módulo</th>
                  <th className="px-3 py-2">Sede</th>
                  <th className="px-3 py-2">Turno</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2">Método</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2 text-center w-[120px]">Docs</th>
                </tr>
              </thead>
              <tbody>
                {movimientosMostrados.length === 0 && (
                  <tr className="border-t">
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                      No hay movimientos para los filtros seleccionados.
                    </td>
                  </tr>
                )}
                {movimientosMostrados.map((m: Movimiento) => {
                  const mostrarDocsCaja = m.modulo === 'Caja' && m.vehiculo_id && m.categoria === 'rtm';
                  const mostrarComprobanteTesoreriaEgreso =
                    m.modulo === 'Tesorería' && !m.es_ingreso && !m.anulado;
                  const mostrarComprobanteCajaEgresoManual =
                    m.modulo === 'Caja' &&
                    !m.es_ingreso &&
                    !m.anulado &&
                    ['gasto', 'devolucion', 'ajuste'].includes(m.categoria);
                  return (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2">{m.hora}</td>
                    <td className="px-3 py-2">{m.modulo}</td>
                    <td className="px-3 py-2 text-slate-600">{m.sede ?? '—'}</td>
                    <td className="px-3 py-2">{m.turno}</td>
                    <td className={`px-3 py-2 ${m.es_ingreso ? 'text-green-700' : 'text-red-700'}`}>{m.tipo_movimiento}</td>
                    <td className="px-3 py-2 break-words min-w-0">
                      {m.beneficiario ? (
                        <>
                          <span className="font-medium block">{m.beneficiario}</span>
                          {m.beneficiario_tipo_identificacion ? (
                            <span className="text-xs text-slate-500 block">
                              {m.beneficiario_tipo_identificacion}
                              {m.beneficiario_numero_identificacion
                                ? ` · ${m.beneficiario_numero_identificacion}`
                                : ''}
                            </span>
                          ) : m.beneficiario_numero_identificacion ? (
                            <span className="text-xs text-slate-500 block">
                              {m.beneficiario_numero_identificacion}
                            </span>
                          ) : null}
                          <span className="text-slate-700 block mt-0.5">{m.concepto}</span>
                        </>
                      ) : (
                        m.concepto
                      )}
                      {m.ui_pago_mixto_compacto && m.ui_desglose_metodos && (
                        <details className="mt-2 rounded-md border border-sky-100 bg-sky-50 px-2 py-1.5">
                          <summary className="cursor-pointer list-none text-[11px] font-semibold text-sky-900">
                            Ver desglose pago mixto ({m.ui_desglose_metodos.length} métodos)
                          </summary>
                          <div className="mt-1 space-y-0.5">
                            {m.ui_desglose_metodos.map((d) => (
                              <p key={`${m.id}-${d.metodo}`} className="text-[11px] text-sky-800">
                                {formatearMetodoPagoEtiqueta(d.metodo)}: {formatCOP(d.monto)}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                      {(m.factura_emitida_por ||
                        m.factura_corregida ||
                        m.factura_correccion_estado ||
                        m.documento_soporte_emitido_por ||
                        m.documento_soporte_concepto_retencion ||
                        m.documento_soporte_retencion_calculada != null) && (
                        <div className="mt-2 text-xs text-slate-500 space-y-1 border-t border-slate-100 pt-1.5">
                          {m.factura_emitida_por ? (
                            <p>
                              <span className="font-medium text-slate-600">Factura electrónica:</span>{' '}
                              {m.factura_emitida_por}
                              {m.factura_emitida_en
                                ? ` · ${new Date(m.factura_emitida_en).toLocaleString('es-CO', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}`
                                : ''}
                              {m.factura_pdf_archivado ? (
                                <span className="text-emerald-700 font-medium"> · PDF archivado</span>
                              ) : null}
                            </p>
                          ) : null}
                          {(m.factura_corregida || m.factura_correccion_estado) ? (
                            <p>
                              <span className="font-medium text-slate-600">Corrección factura:</span>{' '}
                              {m.factura_correccion_estado === 'failed'
                                ? 'Fallida'
                                : m.factura_corregida
                                  ? 'Completada'
                                  : 'Registrada'}
                              {m.factura_correccion_motivo
                                ? ` · motivo ${m.factura_correccion_motivo}`
                                : ''}
                              {m.factura_correccion_at
                                ? ` · ${new Date(m.factura_correccion_at).toLocaleString('es-CO', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}`
                                : ''}
                              {m.factura_correccion_factura_original
                                ? ` · Orig: ${m.factura_correccion_factura_original}`
                                : ''}
                              {m.factura_correccion_nota_credito
                                ? ` · NC: ${m.factura_correccion_nota_credito}`
                                : ''}
                              {m.factura_correccion_factura_nueva
                                ? ` · Nueva: ${m.factura_correccion_factura_nueva}`
                                : ''}
                            </p>
                          ) : null}
                          {m.documento_soporte_emitido_por ? (
                            <p>
                              <span className="font-medium text-slate-600">Documento soporte:</span>{' '}
                              {m.documento_soporte_emitido_por}
                              {m.documento_soporte_emitido_en
                                ? ` · ${new Date(m.documento_soporte_emitido_en).toLocaleString('es-CO', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}`
                                : ''}
                              {m.documento_soporte_pdf_archivado ? (
                                <span className="text-emerald-700 font-medium"> · PDF archivado</span>
                              ) : null}
                            </p>
                          ) : null}
                          {m.documento_soporte_concepto_retencion ? (
                            <p className="text-slate-600">
                              <span className="font-medium text-slate-600">Retención (catálogo):</span>{' '}
                              <span className="capitalize">
                                {m.documento_soporte_concepto_retencion.replace(/_/g, ' ')}
                              </span>
                            </p>
                          ) : null}
                          {m.documento_soporte_retencion_calculada != null &&
                          m.documento_soporte_retencion_calculada !== undefined ? (
                            <p className="text-slate-600">
                              <span className="font-medium text-slate-600">Retención calculada (motor):</span>{' '}
                              {formatCOP(m.documento_soporte_retencion_calculada)}
                              {m.documento_soporte_retencion_anio != null &&
                              m.documento_soporte_retencion_anio !== undefined ? (
                                <span className="text-slate-500">
                                  {' '}
                                  · parámetros año {m.documento_soporte_retencion_anio}
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      )}
                      {m.anulado && (
                        <details className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                          <summary className="cursor-pointer list-none font-semibold">
                            Movimiento anulado
                          </summary>
                          <div className="mt-1">
                            <p>
                              {m.anulado_por ? `Por: ${m.anulado_por}` : 'Por: N/A'}
                              {m.fecha_anulacion
                                ? ` · ${new Date(m.fecha_anulacion).toLocaleString('es-CO', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}`
                                : ''}
                            </p>
                            {m.motivo_anulacion ? <p className="mt-0.5">Motivo: {m.motivo_anulacion}</p> : null}
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-2">{m.categoria}</td>
                    <td className="px-3 py-2">
                      {m.ui_pago_mixto_compacto ? (
                        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
                          mixto
                        </span>
                      ) : (
                        m.metodo_pago
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${m.es_ingreso ? 'text-green-700' : 'text-red-700'}`}>{formatCOP(m.monto)}</td>
                    <td className="px-3 py-2">{m.usuario}</td>
                    <td className="px-3 py-2 text-center">
                      {mostrarDocsCaja ||
                      mostrarComprobanteTesoreriaEgreso ||
                      mostrarComprobanteCajaEgresoManual ? (
                        <div className="flex flex-wrap justify-center gap-1">
                          {mostrarDocsCaja ? (
                            <>
                              <button
                                type="button"
                                title="Ver recibo de pago (vista previa)"
                                onClick={() => m.vehiculo_id && abrirReciboCliente(m.vehiculo_id)}
                                className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-primary-50 text-primary-700"
                              >
                                <Receipt className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                title="Factura electrónica DIAN — abre en nueva pestaña"
                                onClick={() => abrirFacturaOficial(m.factura_public_url)}
                                className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-amber-50 text-amber-800 disabled:opacity-40"
                                disabled={!m.factura_public_url}
                              >
                                <Landmark className="w-4 h-4" />
                              </button>
                            </>
                          ) : null}
                          {mostrarComprobanteCajaEgresoManual ? (
                            <button
                              type="button"
                              title="Ver comprobante de egreso de caja (vista previa)"
                              disabled={cajaEgresoPdfLoadingId === m.id}
                              onClick={() => verComprobanteEgresoCajaReporte(m.id)}
                              className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-orange-50 text-orange-800 disabled:opacity-40"
                            >
                              <Wallet className="w-4 h-4" />
                            </button>
                          ) : null}
                          {mostrarComprobanteTesoreriaEgreso ? (
                            <button
                              type="button"
                              title="Ver comprobante de egreso de tesorería (vista previa)"
                              disabled={tesoreriaEgresoPdfLoadingId === m.id}
                              onClick={() => verComprobanteEgresoTesoreriaReporte(m.id)}
                              className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-red-50 text-red-700 disabled:opacity-40"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          ) : null}
                          {movimientoElegibleDocumentoSoporte(m) ? (
                            <>
                              {!m.documento_soporte_numero ? (
                                <button
                                  type="button"
                                  title="Generar documento soporte electrónico (Factus / DIAN, una sola vez)"
                                  disabled={
                                    dsEmitLoadingId === m.id || emitirDocumentoSoporteMutation.isLoading
                                  }
                                  onClick={() => emitirDocumentoSoporte(m)}
                                  className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 text-emerald-800 disabled:opacity-40"
                                >
                                  <FileCheck className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  title={
                                    m.documento_soporte_public_url
                                      ? 'Ver documento soporte DIAN (Factus — nueva pestaña)'
                                      : 'Ver documento (descarga por API si Factus no devolvió enlace público aún)'
                                  }
                                  disabled={dsPdfLoadingId === m.id}
                                  onClick={() => verDocumentoSoportePdf(m)}
                                  className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 text-emerald-900 disabled:opacity-40"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tabla: Trámites */}
        <div className="card-pos">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-primary-600" />
              {modoVista === 'dia' ? 'Trámites del Día' : `Trámites (${tramitesData?.fecha || ''})`}
            </h3>
            <button 
              onClick={() =>
                exportarCSV(
                  tramitesData?.tramites || [],
                  modoVista === 'rango' ? 'tramites_rango' : 'tramites_dia',
                )
              }
              disabled={rangoInvalido || (tramitesData?.tramites || []).length === 0}
              className="flex items-center gap-2 btn-primary-solid disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              Exportar CSV
            </button>
          </div>
          {isFetchingTramites && (
            <p className="mb-3 text-sm text-slate-500">Actualizando trámites...</p>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Sede</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2 text-right">RTM</th>
                  <th className="px-3 py-2 text-right">SOAT</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Método</th>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {(tramitesData?.tramites || []).length === 0 && (
                  <tr className="border-t">
                    <td colSpan={13} className="px-3 py-6 text-center text-slate-500">
                      No hay trámites para el periodo seleccionado.
                    </td>
                  </tr>
                )}
                {(tramitesData?.tramites || []).map((t: Tramite) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-3 py-2">{t.hora_registro}</td>
                    <td className="px-3 py-2 text-slate-600">{t.sede ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{t.placa}</td>
                    <td className="px-3 py-2">{t.tipo_vehiculo}</td>
                    <td className="px-3 py-2">{t.cliente}</td>
                    <td className="px-3 py-2">{t.documento}</td>
                    <td className="px-3 py-2 text-right">{formatCOP(t.valor_rtm)}</td>
                    <td className="px-3 py-2 text-right">{formatCOP(t.comision_soat)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCOP(t.total_cobrado)}</td>
                    <td className="px-3 py-2">{t.metodo_pago}</td>
                    <td className="px-3 py-2">
                      {t.factura_corregida ? (
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                              t.factura_correccion_estado === 'failed'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                            }`}
                          >
                            {t.factura_correccion_estado === 'failed' ? 'Corrección fallida' : 'Corregida (NC + reemisión)'}
                          </span>
                          <div className="text-[11px] text-slate-600 leading-tight">
                            {t.factura_original_numero ? <div>Orig: {t.factura_original_numero}</div> : null}
                            {t.nota_credito_numero ? <div>NC: {t.nota_credito_numero}</div> : null}
                            {t.factura_nueva_numero ? <div>Nueva: {t.factura_nueva_numero}</div> : null}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Sin corrección</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{t.estado}</td>
                    <td className="px-3 py-2">{t.registrado_por}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>

      {pdfPreview && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-preview-titulo"
          onClick={(e) => {
            if (e.target === e.currentTarget) cerrarPdfPreview();
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h4
                id="pdf-preview-titulo"
                className="font-bold text-slate-900 flex items-center gap-2 text-sm sm:text-base min-w-0 pr-2"
              >
                <FileText className="w-5 h-5 text-primary-600 shrink-0" />
                <span className="truncate">{pdfPreview.title}</span>
              </h4>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={pdfPreview.blobUrl}
                  download={pdfPreview.fileName}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <Download className="w-4 h-4" />
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={cerrarPdfPreview}
                  className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
                  aria-label="Cerrar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100 flex flex-col">
              <iframe
                title={pdfPreview.title}
                src={pdfPreview.blobUrl}
                className="w-full flex-1 min-h-[70vh] border-0"
              />
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
