import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, TrendingDown, Wallet, Building2, FileText, Download, DollarSign, ArrowUpCircle, ArrowDownCircle, CalendarDays, TimerReset, AlertTriangle, GaugeCircle } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import apiClient from '../api/client';
import { reportesApi } from '../api/reportes';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario } from '../types';
import { formatCOP } from '../utils/formatNumber';

const ReportesIngresosChart = lazy(() => import('../components/ReportesIngresosChart'));

const formatLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  sede?: string | null;
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
}

type ReporteSedeScope = 'activa' | 'todas' | 'sucursal';

export default function ReportesPage() {
  const { user } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const puedeElegirSedeReporte =
    !!tenantUser && (tenantUser.rol === 'administrador' || tenantUser.rol === 'contador');

  const todayLocal = formatLocalDate(new Date());
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
    enabled: reportesEnabled,
    refetchInterval: 60000,
  });

  // Query: Desglose por conceptos
  const { data: conceptosData } = useQuery({
    queryKey: ['desglose-conceptos', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/desglose-conceptos?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled,
    refetchInterval: 60000,
  });

  // Query: Desglose por medios de pago
  const { data: mediosPagoData } = useQuery({
    queryKey: ['desglose-medios-pago', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/desglose-medios-pago?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled,
    refetchInterval: 60000,
  });

  // Query: Trámites detallados
  const { data: tramitesData, isFetching: isFetchingTramites } = useQuery({
    queryKey: ['tramites-detallados', modoVista, fechaSeleccionada, fechaInicio, fechaFin, sedeQuerySuffix],
    queryFn: async () => {
      const response = await apiClient.get(`/reportes/tramites-detallados?${queryParams}`);
      return response.data;
    },
    enabled: reportesEnabled,
    refetchInterval: 60000,
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
    enabled: reportesEnabled && modoVista === 'dia' && puedeElegirSedeReporte,
    refetchInterval: 60000,
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
    enabled: reportesEnabled,
    refetchInterval: 60000,
  });

  // Filtrar movimientos localmente
  const movimientosFiltrados = (movimientosData?.movimientos || []).filter((m: Movimiento) => {
    const cumpleTipo = filtroTipo === 'todos' || m.tipo_movimiento === filtroTipo;
    const cumpleMetodo = filtroMetodo === 'todos' || m.metodo_pago === filtroMetodo;
    const cumpleConcepto = filtroConcepto === '' || m.concepto.toLowerCase().includes(filtroConcepto.toLowerCase());
    return cumpleTipo && cumpleMetodo && cumpleConcepto;
  });

  // Obtener valores únicos para los filtros
  const tiposUnicos: string[] = Array.from(new Set((movimientosData?.movimientos || []).map((m: Movimiento) => m.tipo_movimiento)));
  const metodosUnicos: string[] = Array.from(new Set((movimientosData?.movimientos || []).map((m: Movimiento) => m.metodo_pago)));

  // Función para limpiar filtros
  const limpiarFiltros = () => {
    setFiltroTipo('todos');
    setFiltroMetodo('todos');
    setFiltroConcepto('');
  };

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
                  max={todayLocal}
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
                    max={todayLocal}
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
                    max={todayLocal}
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

        {/* Tabla: Movimientos */}
        <div className="card-pos">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <GaugeCircle className="w-6 h-6 text-primary-600" />
              Dashboard Operativo (SLA y Colas)
            </h3>
            <p className="text-sm text-slate-600">Periodo: {operativoData?.periodo || periodoActual}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
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

        <div className="card-pos">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-primary-600" />
              {modoVista === 'dia' ? 'Movimientos del Día' : `Movimientos (${movimientosData?.fecha || ''})`}
              <span className="text-sm text-slate-500 font-normal">
                ({movimientosFiltrados.length} de {movimientosData?.total_movimientos || 0})
              </span>
            </h3>
            <button 
              onClick={() =>
                exportarCSV(
                  movimientosFiltrados,
                  modoVista === 'rango' ? 'movimientos_rango' : 'movimientos_dia',
                )
              }
              disabled={rangoInvalido || movimientosFiltrados.length === 0}
              className="flex items-center gap-2 btn-success-solid disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              Exportar CSV
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
                  Buscar por Concepto:
                </label>
                <input
                  type="text"
                  value={filtroConcepto}
                  onChange={(e) => setFiltroConcepto(e.target.value)}
                  placeholder="Escribir para buscar..."
                  className="input-corporate w-full px-3 py-2"
                />
              </div>

              <button
                onClick={limpiarFiltros}
                className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-800 font-semibold rounded-lg transition-all"
              >
                Limpiar Filtros
              </button>
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
                </tr>
              </thead>
              <tbody>
                {movimientosFiltrados.length === 0 && (
                  <tr className="border-t">
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                      No hay movimientos para los filtros seleccionados.
                    </td>
                  </tr>
                )}
                {movimientosFiltrados.map((m: Movimiento) => (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2">{m.hora}</td>
                    <td className="px-3 py-2">{m.modulo}</td>
                    <td className="px-3 py-2 text-slate-600">{m.sede ?? '—'}</td>
                    <td className="px-3 py-2">{m.turno}</td>
                    <td className={`px-3 py-2 ${m.es_ingreso ? 'text-green-700' : 'text-red-700'}`}>{m.tipo_movimiento}</td>
                    <td className="px-3 py-2">{m.concepto}</td>
                    <td className="px-3 py-2">{m.categoria}</td>
                    <td className="px-3 py-2">{m.metodo_pago}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${m.es_ingreso ? 'text-green-700' : 'text-red-700'}`}>{formatCOP(m.monto)}</td>
                    <td className="px-3 py-2">{m.usuario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Desglose por Conceptos y Medios de Pago */}
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
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {(tramitesData?.tramites || []).length === 0 && (
                  <tr className="border-t">
                    <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
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
                    <td className="px-3 py-2">{t.estado}</td>
                    <td className="px-3 py-2">{t.registrado_por}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
