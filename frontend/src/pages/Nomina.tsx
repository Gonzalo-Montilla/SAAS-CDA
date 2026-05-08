import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileClock, RefreshCw, ReceiptText, X } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario } from '../types';
import {
  type NominaContrato,
  type NominaCentroCosto,
  nominaApi,
  type NominaDesprendibleVersion,
  type NominaEmpleado,
  type NominaLiquidacion,
  type NominaParametroLegal,
  type NominaPeriodo,
} from '../api/nomina';

function money(v: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
}

function dateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO');
}

function periodoLabel(p: NominaPeriodo): string {
  return `${p.anio}-${p.mes} · ${p.estado}`;
}

function descargarBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function Nomina() {
  const now = new Date();
  const currentYear = `${now.getFullYear()}`;
  const currentMonth = `${now.getMonth() + 1}`.padStart(2, '0');

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const sucursales = tenantUser?.sucursales ?? [];
  const [periodoId, setPeriodoId] = useState<string>('');
  const [historialPara, setHistorialPara] = useState<NominaLiquidacion | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [nuevoEmpleado, setNuevoEmpleado] = useState({
    sucursal_id: '',
    centro_costo_id: '',
    codigo_interno: '',
    documento_tipo: 'CC',
    documento_numero: '',
    nombres: '',
    apellidos: '',
    email: '',
    celular: '',
    fecha_ingreso: '',
  });
  const [nuevoContrato, setNuevoContrato] = useState({
    empleado_id: '',
    centro_costo_id: '',
    es_salario_integral: false,
    tipo_contrato: 'indefinido' as 'fijo' | 'indefinido' | 'obra_labor' | 'aprendizaje' | 'temporal',
    periodicidad: 'mensual' as 'quincenal' | 'mensual',
    salario_base: '',
    fecha_inicio: '',
    fecha_fin: '',
    observaciones: '',
  });
  const [nuevoPeriodo, setNuevoPeriodo] = useState({
    anio: currentYear,
    mes: currentMonth,
    fecha_inicio: '',
    fecha_fin: '',
    fecha_pago: '',
    observaciones: '',
  });
  const [nuevoCentroCosto, setNuevoCentroCosto] = useState({
    sucursal_id: '',
    codigo: '',
    nombre: '',
    descripcion: '',
  });
  const [nuevaNovedad, setNuevaNovedad] = useState({
    empleado_id: '',
    tipo: 'devengo' as 'devengo' | 'deduccion',
    concepto: '',
    unidades: '1',
    valor_unitario: '0',
    valor_total: '0',
    observaciones: '',
  });
  const [filtroLiquidaciones, setFiltroLiquidaciones] = useState({
    empleado_id: '',
    sucursal_id: '',
    centro_costo_id: '',
  });
  const [filtroNovedades, setFiltroNovedades] = useState({
    empleado_id: '',
    sucursal_id: '',
    centro_costo_id: '',
  });
  const [parametrosLegalesForm, setParametrosLegalesForm] = useState({
    salario_minimo_mensual: '',
    auxilio_transporte_mensual: '',
    uvt: '',
    tope_ibc_smmlv: '',
    umbral_exoneracion_smmlv: '',
    exoneracion_aportes_activa: true,
    aplica_auxilio_transporte: true,
    umbral_auxilio_transporte_smmlv: '',
    aplica_fsp: true,
    umbral_fsp_smmlv: '',
    pct_fsp_base: '',
    aplica_subsistencia: true,
    aplica_retencion_fuente: false,
    umbral_retencion_uvt: '',
    pct_retencion_base: '',
    pct_ibc_salario_integral: '',
    pct_salud_empleado: '',
    pct_pension_empleado: '',
    pct_salud_empresa: '',
    pct_pension_empresa: '',
    pct_arl_empresa: '',
    pct_caja_empresa: '',
    pct_sena_empresa: '',
    pct_icbf_empresa: '',
  });

  const periodosQuery = useQuery({
    queryKey: ['nomina-periodos'],
    queryFn: () => nominaApi.listarPeriodos(),
  });

  const periodos = useMemo(
    () =>
      [...(periodosQuery.data ?? [])].sort((a, b) => {
        if (a.anio !== b.anio) return b.anio.localeCompare(a.anio);
        return b.mes.localeCompare(a.mes);
      }),
    [periodosQuery.data]
  );

  useEffect(() => {
    if (!periodoId && periodos.length > 0) {
      setPeriodoId(periodos[0].id);
    }
  }, [periodoId, periodos]);

  const liquidacionesQuery = useQuery({
    queryKey: ['nomina-liquidaciones', periodoId, filtroLiquidaciones],
    queryFn: () =>
      nominaApi.listarLiquidacionesPeriodo(periodoId, {
        empleado_id: filtroLiquidaciones.empleado_id || undefined,
        sucursal_id: filtroLiquidaciones.sucursal_id || undefined,
        centro_costo_id: filtroLiquidaciones.centro_costo_id || undefined,
      }),
    enabled: Boolean(periodoId),
  });
  const empleadosQuery = useQuery({
    queryKey: ['nomina-empleados'],
    queryFn: () => nominaApi.listarEmpleados(),
  });
  const contratosQuery = useQuery({
    queryKey: ['nomina-contratos'],
    queryFn: () => nominaApi.listarContratos(),
  });
  const centrosCostoQuery = useQuery({
    queryKey: ['nomina-centros-costo'],
    queryFn: () => nominaApi.listarCentrosCosto(),
  });
  const parametrosLegalesQuery = useQuery({
    queryKey: ['nomina-parametros-legales'],
    queryFn: () => nominaApi.obtenerParametrosLegales(),
  });
  const novedadesQuery = useQuery({
    queryKey: ['nomina-novedades', periodoId, filtroNovedades],
    queryFn: () =>
      nominaApi.listarNovedadesPeriodo(periodoId, {
        empleado_id: filtroNovedades.empleado_id || undefined,
        sucursal_id: filtroNovedades.sucursal_id || undefined,
        centro_costo_id: filtroNovedades.centro_costo_id || undefined,
      }),
    enabled: Boolean(periodoId),
  });

  const versionesQuery = useQuery({
    queryKey: ['nomina-desprendibles-versiones', historialPara?.id],
    queryFn: () => nominaApi.listarVersionesDesprendible(historialPara!.id),
    enabled: Boolean(historialPara?.id),
  });

  const reemitirMutation = useMutation({
    mutationFn: (liquidacionId: string) => nominaApi.reemitirDesprendible(liquidacionId),
    onSuccess: (res) => {
      setFeedback({
        type: 'success',
        message: `Desprendible reemitido. Nueva version: v${res.version} (${res.folio}).`,
      });
      void queryClient.invalidateQueries({ queryKey: ['nomina-liquidaciones', periodoId] });
      if (historialPara?.id === res.liquidacion_id) {
        void queryClient.invalidateQueries({ queryKey: ['nomina-desprendibles-versiones', historialPara.id] });
      }
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo reemitir el desprendible.' });
    },
  });
  const crearPeriodoMutation = useMutation({
    mutationFn: () =>
      nominaApi.crearPeriodo({
        anio: nuevoPeriodo.anio,
        mes: nuevoPeriodo.mes,
        fecha_inicio: nuevoPeriodo.fecha_inicio,
        fecha_fin: nuevoPeriodo.fecha_fin,
        fecha_pago: nuevoPeriodo.fecha_pago || null,
        observaciones: nuevoPeriodo.observaciones || null,
      }),
    onSuccess: (nuevo) => {
      setFeedback({ type: 'success', message: 'Periodo creado correctamente.' });
      setPeriodoId(nuevo.id);
      void queryClient.invalidateQueries({ queryKey: ['nomina-periodos'] });
      setNuevoPeriodo((prev) => ({
        ...prev,
        fecha_inicio: '',
        fecha_fin: '',
        fecha_pago: '',
        observaciones: '',
      }));
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo crear el periodo. Verifica datos y duplicados.' });
    },
  });
  const crearCentroCostoMutation = useMutation({
    mutationFn: () =>
      nominaApi.crearCentroCosto({
        sucursal_id: nuevoCentroCosto.sucursal_id || null,
        codigo: nuevoCentroCosto.codigo.trim(),
        nombre: nuevoCentroCosto.nombre.trim(),
        descripcion: nuevoCentroCosto.descripcion.trim() || null,
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Centro de costo creado.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-centros-costo'] });
      setNuevoCentroCosto({ sucursal_id: '', codigo: '', nombre: '', descripcion: '' });
    },
    onError: () => setFeedback({ type: 'error', message: 'No se pudo crear el centro de costo.' }),
  });
  const actualizarParametrosLegalesMutation = useMutation({
    mutationFn: () =>
      nominaApi.actualizarParametrosLegales({
        salario_minimo_mensual: Number(parametrosLegalesForm.salario_minimo_mensual),
        auxilio_transporte_mensual: Number(parametrosLegalesForm.auxilio_transporte_mensual),
        uvt: Number(parametrosLegalesForm.uvt),
        tope_ibc_smmlv: Number(parametrosLegalesForm.tope_ibc_smmlv),
        umbral_exoneracion_smmlv: Number(parametrosLegalesForm.umbral_exoneracion_smmlv),
        exoneracion_aportes_activa: parametrosLegalesForm.exoneracion_aportes_activa,
        aplica_auxilio_transporte: parametrosLegalesForm.aplica_auxilio_transporte,
        umbral_auxilio_transporte_smmlv: Number(parametrosLegalesForm.umbral_auxilio_transporte_smmlv),
        aplica_fsp: parametrosLegalesForm.aplica_fsp,
        umbral_fsp_smmlv: Number(parametrosLegalesForm.umbral_fsp_smmlv),
        pct_fsp_base: Number(parametrosLegalesForm.pct_fsp_base),
        aplica_subsistencia: parametrosLegalesForm.aplica_subsistencia,
        aplica_retencion_fuente: parametrosLegalesForm.aplica_retencion_fuente,
        umbral_retencion_uvt: Number(parametrosLegalesForm.umbral_retencion_uvt),
        pct_retencion_base: Number(parametrosLegalesForm.pct_retencion_base),
        pct_ibc_salario_integral: Number(parametrosLegalesForm.pct_ibc_salario_integral),
        pct_salud_empleado: Number(parametrosLegalesForm.pct_salud_empleado),
        pct_pension_empleado: Number(parametrosLegalesForm.pct_pension_empleado),
        pct_salud_empresa: Number(parametrosLegalesForm.pct_salud_empresa),
        pct_pension_empresa: Number(parametrosLegalesForm.pct_pension_empresa),
        pct_arl_empresa: Number(parametrosLegalesForm.pct_arl_empresa),
        pct_caja_empresa: Number(parametrosLegalesForm.pct_caja_empresa),
        pct_sena_empresa: Number(parametrosLegalesForm.pct_sena_empresa),
        pct_icbf_empresa: Number(parametrosLegalesForm.pct_icbf_empresa),
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Parametros legales actualizados.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-parametros-legales'] });
    },
    onError: () => setFeedback({ type: 'error', message: 'No se pudieron actualizar los parametros legales.' }),
  });
  const crearEmpleadoMutation = useMutation({
    mutationFn: () =>
      nominaApi.crearEmpleado({
        sucursal_id: nuevoEmpleado.sucursal_id || null,
        centro_costo_id: nuevoEmpleado.centro_costo_id || null,
        codigo_interno: nuevoEmpleado.codigo_interno || null,
        documento_tipo: nuevoEmpleado.documento_tipo,
        documento_numero: nuevoEmpleado.documento_numero,
        nombres: nuevoEmpleado.nombres,
        apellidos: nuevoEmpleado.apellidos,
        email: nuevoEmpleado.email || null,
        celular: nuevoEmpleado.celular || null,
        fecha_ingreso: nuevoEmpleado.fecha_ingreso,
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Empleado creado correctamente.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-empleados'] });
      setNuevoEmpleado({
        sucursal_id: '',
        centro_costo_id: '',
        codigo_interno: '',
        documento_tipo: 'CC',
        documento_numero: '',
        nombres: '',
        apellidos: '',
        email: '',
        celular: '',
        fecha_ingreso: '',
      });
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo crear el empleado. Revisa documento y datos obligatorios.' });
    },
  });
  const crearContratoMutation = useMutation({
    mutationFn: () =>
      nominaApi.crearContrato({
        empleado_id: nuevoContrato.empleado_id,
        centro_costo_id: nuevoContrato.centro_costo_id || null,
        es_salario_integral: nuevoContrato.es_salario_integral,
        tipo_contrato: nuevoContrato.tipo_contrato,
        periodicidad: nuevoContrato.periodicidad,
        salario_base: Number(nuevoContrato.salario_base),
        fecha_inicio: nuevoContrato.fecha_inicio,
        fecha_fin: nuevoContrato.fecha_fin || null,
        observaciones: nuevoContrato.observaciones || null,
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Contrato creado correctamente.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-contratos'] });
      setNuevoContrato({
        empleado_id: '',
        centro_costo_id: '',
        es_salario_integral: false,
        tipo_contrato: 'indefinido',
        periodicidad: 'mensual',
        salario_base: '',
        fecha_inicio: '',
        fecha_fin: '',
        observaciones: '',
      });
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo crear el contrato. Verifica empleado y fechas.' });
    },
  });
  const crearNovedadMutation = useMutation({
    mutationFn: () =>
      nominaApi.crearNovedad({
        periodo_id: periodoId,
        empleado_id: nuevaNovedad.empleado_id,
        tipo: nuevaNovedad.tipo,
        concepto: nuevaNovedad.concepto,
        unidades: Number(nuevaNovedad.unidades),
        valor_unitario: Number(nuevaNovedad.valor_unitario),
        valor_total: Number(nuevaNovedad.valor_total),
        observaciones: nuevaNovedad.observaciones || null,
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Novedad registrada.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-novedades', periodoId] });
      setNuevaNovedad({
        empleado_id: '',
        tipo: 'devengo',
        concepto: '',
        unidades: '1',
        valor_unitario: '0',
        valor_total: '0',
        observaciones: '',
      });
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo registrar la novedad.' });
    },
  });
  const preliquidarMutation = useMutation({
    mutationFn: () => nominaApi.preliquidarPeriodo(periodoId),
    onSuccess: (res) => {
      setFeedback({
        type: 'success',
        message: `Preliquidacion OK: ${res.empleados_liquidados} empleados, total neto ${money(res.total_neto_pagar)}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['nomina-periodos'] });
      void queryClient.invalidateQueries({ queryKey: ['nomina-liquidaciones', periodoId] });
    },
    onError: () => {
      setFeedback({ type: 'error', message: 'No se pudo preliquidar el periodo.' });
    },
  });
  const aprobarMutation = useMutation({
    mutationFn: () => nominaApi.aprobarPeriodo(periodoId),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Periodo aprobado.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-periodos'] });
    },
    onError: () => setFeedback({ type: 'error', message: 'No se pudo aprobar el periodo.' }),
  });
  const cerrarMutation = useMutation({
    mutationFn: () => nominaApi.cerrarPeriodo(periodoId),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Periodo cerrado.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-periodos'] });
    },
    onError: () => setFeedback({ type: 'error', message: 'No se pudo cerrar el periodo.' }),
  });
  const pagarMutation = useMutation({
    mutationFn: () => nominaApi.marcarPagadaPeriodo(periodoId),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Periodo marcado como pagado.' });
      void queryClient.invalidateQueries({ queryKey: ['nomina-periodos'] });
    },
    onError: () => setFeedback({ type: 'error', message: 'No se pudo marcar pagado el periodo.' }),
  });

  const empleadosById = useMemo(() => {
    const map = new Map<string, NominaEmpleado>();
    for (const emp of empleadosQuery.data ?? []) map.set(emp.id, emp);
    return map;
  }, [empleadosQuery.data]);
  const contratosByEmpleado = useMemo(() => {
    const map = new Map<string, NominaContrato[]>();
    for (const c of contratosQuery.data ?? []) {
      const arr = map.get(c.empleado_id) ?? [];
      arr.push(c);
      map.set(c.empleado_id, arr);
    }
    return map;
  }, [contratosQuery.data]);
  const centrosCostoById = useMemo(() => {
    const map = new Map<string, NominaCentroCosto>();
    for (const cc of centrosCostoQuery.data ?? []) map.set(cc.id, cc);
    return map;
  }, [centrosCostoQuery.data]);
  const parametrosLegales = useMemo<NominaParametroLegal | null>(
    () => parametrosLegalesQuery.data ?? null,
    [parametrosLegalesQuery.data]
  );
  const selectedPeriodo = useMemo(
    () => periodos.find((p) => p.id === periodoId) ?? null,
    [periodos, periodoId]
  );

  useEffect(() => {
    const u = Number(nuevaNovedad.unidades || '0');
    const vu = Number(nuevaNovedad.valor_unitario || '0');
    if (!Number.isFinite(u) || !Number.isFinite(vu)) return;
    setNuevaNovedad((prev) => ({ ...prev, valor_total: String(Math.max(0, u * vu)) }));
  }, [nuevaNovedad.unidades, nuevaNovedad.valor_unitario]);
  useEffect(() => {
    if (!parametrosLegales) return;
    setParametrosLegalesForm({
      salario_minimo_mensual: String(parametrosLegales.salario_minimo_mensual ?? ''),
      auxilio_transporte_mensual: String(parametrosLegales.auxilio_transporte_mensual ?? ''),
      uvt: String(parametrosLegales.uvt ?? ''),
      tope_ibc_smmlv: String(parametrosLegales.tope_ibc_smmlv ?? ''),
      umbral_exoneracion_smmlv: String(parametrosLegales.umbral_exoneracion_smmlv ?? ''),
      exoneracion_aportes_activa: Boolean(parametrosLegales.exoneracion_aportes_activa),
      aplica_auxilio_transporte: Boolean(parametrosLegales.aplica_auxilio_transporte),
      umbral_auxilio_transporte_smmlv: String(parametrosLegales.umbral_auxilio_transporte_smmlv ?? ''),
      aplica_fsp: Boolean(parametrosLegales.aplica_fsp),
      umbral_fsp_smmlv: String(parametrosLegales.umbral_fsp_smmlv ?? ''),
      pct_fsp_base: String(parametrosLegales.pct_fsp_base ?? ''),
      aplica_subsistencia: Boolean(parametrosLegales.aplica_subsistencia),
      aplica_retencion_fuente: Boolean(parametrosLegales.aplica_retencion_fuente),
      umbral_retencion_uvt: String(parametrosLegales.umbral_retencion_uvt ?? ''),
      pct_retencion_base: String(parametrosLegales.pct_retencion_base ?? ''),
      pct_ibc_salario_integral: String(parametrosLegales.pct_ibc_salario_integral ?? ''),
      pct_salud_empleado: String(parametrosLegales.pct_salud_empleado ?? ''),
      pct_pension_empleado: String(parametrosLegales.pct_pension_empleado ?? ''),
      pct_salud_empresa: String(parametrosLegales.pct_salud_empresa ?? ''),
      pct_pension_empresa: String(parametrosLegales.pct_pension_empresa ?? ''),
      pct_arl_empresa: String(parametrosLegales.pct_arl_empresa ?? ''),
      pct_caja_empresa: String(parametrosLegales.pct_caja_empresa ?? ''),
      pct_sena_empresa: String(parametrosLegales.pct_sena_empresa ?? ''),
      pct_icbf_empresa: String(parametrosLegales.pct_icbf_empresa ?? ''),
    });
  }, [parametrosLegales]);

  const descargarActual = async (liq: NominaLiquidacion) => {
    setDownloadingId(liq.id);
    try {
      const { blob, filename } = await nominaApi.descargarDesprendibleActual(liq.id);
      descargarBlob(blob, filename);
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo descargar el desprendible actual.' });
    } finally {
      setDownloadingId(null);
    }
  };

  const descargarVersion = async (version: NominaDesprendibleVersion) => {
    setDownloadingId(version.id);
    try {
      const { blob, filename } = await nominaApi.descargarDesprendibleVersion(version.liquidacion_id, version.version);
      descargarBlob(blob, filename);
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo descargar la version solicitada.' });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Layout title="Nómina">
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-fuchsia-100 text-fuchsia-700 flex items-center justify-center">
            <ReceiptText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Desprendibles de nomina</h1>
            <p className="text-sm text-slate-600">Control de versiones, reemision y descarga historica por liquidacion.</p>
          </div>
        </div>

        {feedback && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {feedback.message}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="min-w-[280px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">Periodo</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={periodoId}
                onChange={(e) => setPeriodoId(e.target.value)}
                disabled={periodosQuery.isLoading || periodos.length === 0}
              >
                {periodos.length === 0 && <option value="">Sin periodos</option>}
                {periodos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {periodoLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['nomina-periodos'] });
                if (periodoId) void queryClient.invalidateQueries({ queryKey: ['nomina-liquidaciones', periodoId] });
              }}
            >
              <RefreshCw className="w-4 h-4" />
              Actualizar
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              onClick={() => preliquidarMutation.mutate()}
              disabled={!periodoId || selectedPeriodo?.estado !== 'borrador' || preliquidarMutation.isLoading}
            >
              Preliquidar
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
              onClick={() => aprobarMutation.mutate()}
              disabled={!periodoId || selectedPeriodo?.estado !== 'preliquidada' || aprobarMutation.isLoading}
            >
              Aprobar
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              onClick={() => cerrarMutation.mutate()}
              disabled={!periodoId || selectedPeriodo?.estado !== 'aprobada' || cerrarMutation.isLoading}
            >
              Cerrar
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              onClick={() => pagarMutation.mutate()}
              disabled={!periodoId || selectedPeriodo?.estado !== 'cerrada' || pagarMutation.isLoading}
            >
              Marcar pagada
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Año</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={nuevoPeriodo.anio}
                onChange={(e) => setNuevoPeriodo((prev) => ({ ...prev, anio: e.target.value }))}
                placeholder="2026"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Mes</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={nuevoPeriodo.mes}
                onChange={(e) => setNuevoPeriodo((prev) => ({ ...prev, mes: e.target.value }))}
                placeholder="04"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Inicio</label>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={nuevoPeriodo.fecha_inicio}
                onChange={(e) => setNuevoPeriodo((prev) => ({ ...prev, fecha_inicio: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fin</label>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={nuevoPeriodo.fecha_fin}
                onChange={(e) => setNuevoPeriodo((prev) => ({ ...prev, fecha_fin: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Pago (opcional)</label>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={nuevoPeriodo.fecha_pago}
                onChange={(e) => setNuevoPeriodo((prev) => ({ ...prev, fecha_pago: e.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                disabled={
                  crearPeriodoMutation.isLoading ||
                  !nuevoPeriodo.anio.trim() ||
                  !nuevoPeriodo.mes.trim() ||
                  !nuevoPeriodo.fecha_inicio ||
                  !nuevoPeriodo.fecha_fin
                }
                onClick={() => crearPeriodoMutation.mutate()}
              >
                {crearPeriodoMutation.isLoading ? 'Creando...' : 'Crear periodo'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Parametros legales Colombia (tenant)</h2>
            <span className="text-xs text-slate-500">
              {parametrosLegales?.updated_at ? `Actualizado: ${dateTime(parametrosLegales.updated_at)}` : 'Base legal'}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" placeholder="SMMLV" value={parametrosLegalesForm.salario_minimo_mensual} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, salario_minimo_mensual: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" placeholder="Aux transporte" value={parametrosLegalesForm.auxilio_transporte_mensual} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, auxilio_transporte_mensual: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" placeholder="UVT" value={parametrosLegalesForm.uvt} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, uvt: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="1" step="0.01" placeholder="Tope IBC SMMLV" value={parametrosLegalesForm.tope_ibc_smmlv} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, tope_ibc_smmlv: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="1" step="0.01" placeholder="Umbral exoneracion SMMLV" value={parametrosLegalesForm.umbral_exoneracion_smmlv} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, umbral_exoneracion_smmlv: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="1" step="0.01" placeholder="Umbral auxilio SMMLV" value={parametrosLegalesForm.umbral_auxilio_transporte_smmlv} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, umbral_auxilio_transporte_smmlv: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="1" step="0.01" placeholder="Umbral FSP SMMLV" value={parametrosLegalesForm.umbral_fsp_smmlv} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, umbral_fsp_smmlv: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% FSP base" value={parametrosLegalesForm.pct_fsp_base} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_fsp_base: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" placeholder="Umbral retención UVT" value={parametrosLegalesForm.umbral_retencion_uvt} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, umbral_retencion_uvt: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% retención base" value={parametrosLegalesForm.pct_retencion_base} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_retencion_base: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% IBC salario integral" value={parametrosLegalesForm.pct_ibc_salario_integral} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_ibc_salario_integral: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% salud empleado" value={parametrosLegalesForm.pct_salud_empleado} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_salud_empleado: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% pension empleado" value={parametrosLegalesForm.pct_pension_empleado} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_pension_empleado: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% salud empresa" value={parametrosLegalesForm.pct_salud_empresa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_salud_empresa: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% pension empresa" value={parametrosLegalesForm.pct_pension_empresa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_pension_empresa: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% ARL empresa" value={parametrosLegalesForm.pct_arl_empresa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_arl_empresa: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% caja empresa" value={parametrosLegalesForm.pct_caja_empresa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_caja_empresa: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% SENA empresa" value={parametrosLegalesForm.pct_sena_empresa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_sena_empresa: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" max="1" step="0.00001" placeholder="% ICBF empresa" value={parametrosLegalesForm.pct_icbf_empresa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, pct_icbf_empresa: e.target.value }))} />
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={parametrosLegalesForm.exoneracion_aportes_activa} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, exoneracion_aportes_activa: e.target.checked }))} />
              Exoneracion salud empresa + SENA + ICBF
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={parametrosLegalesForm.aplica_auxilio_transporte} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, aplica_auxilio_transporte: e.target.checked }))} />
              Aplicar auxilio transporte
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={parametrosLegalesForm.aplica_fsp} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, aplica_fsp: e.target.checked }))} />
              Aplicar FSP
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={parametrosLegalesForm.aplica_subsistencia} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, aplica_subsistencia: e.target.checked }))} />
              Aplicar subsistencia
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={parametrosLegalesForm.aplica_retencion_fuente} onChange={(e) => setParametrosLegalesForm((p) => ({ ...p, aplica_retencion_fuente: e.target.checked }))} />
              Aplicar retención en la fuente
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              disabled={actualizarParametrosLegalesMutation.isLoading}
              onClick={() => actualizarParametrosLegalesMutation.mutate()}
            >
              {actualizarParametrosLegalesMutation.isLoading ? 'Guardando...' : 'Guardar parametros legales'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Novedades del periodo</h2>
            <span className="text-xs text-slate-500">{periodoId ? `Periodo: ${selectedPeriodo?.anio}-${selectedPeriodo?.mes}` : 'Seleccione periodo'}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={filtroNovedades.sucursal_id}
              onChange={(e) => setFiltroNovedades((p) => ({ ...p, sucursal_id: e.target.value }))}
            >
              <option value="">Filtrar por sede (todas)</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={filtroNovedades.centro_costo_id}
              onChange={(e) => setFiltroNovedades((p) => ({ ...p, centro_costo_id: e.target.value }))}
            >
              <option value="">Filtrar por centro costo (todos)</option>
              {(centrosCostoQuery.data ?? []).map((cc) => (
                <option key={cc.id} value={cc.id}>{`${cc.codigo} - ${cc.nombre}`}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={filtroNovedades.empleado_id}
              onChange={(e) => setFiltroNovedades((p) => ({ ...p, empleado_id: e.target.value }))}
            >
              <option value="">Filtrar por empleado (todos)</option>
              {(empleadosQuery.data ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>{`${emp.nombres} ${emp.apellidos}`}</option>
              ))}
            </select>
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setFiltroNovedades({ empleado_id: '', sucursal_id: '', centro_costo_id: '' })}
            >
              Limpiar filtros novedades
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              value={nuevaNovedad.empleado_id}
              onChange={(e) => setNuevaNovedad((p) => ({ ...p, empleado_id: e.target.value }))}
            >
              <option value="">Seleccione empleado</option>
              {(empleadosQuery.data ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>{`${emp.nombres} ${emp.apellidos}`}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nuevaNovedad.tipo}
              onChange={(e) => setNuevaNovedad((p) => ({ ...p, tipo: e.target.value as 'devengo' | 'deduccion' }))}
            >
              <option value="devengo">Devengo</option>
              <option value="deduccion">Deduccion</option>
            </select>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Concepto" value={nuevaNovedad.concepto} onChange={(e) => setNuevaNovedad((p) => ({ ...p, concepto: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" step="0.01" placeholder="Unidades" value={nuevaNovedad.unidades} onChange={(e) => setNuevaNovedad((p) => ({ ...p, unidades: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" step="0.01" placeholder="Valor unitario" value={nuevaNovedad.valor_unitario} onChange={(e) => setNuevaNovedad((p) => ({ ...p, valor_unitario: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="0" step="0.01" placeholder="Valor total" value={nuevaNovedad.valor_total} onChange={(e) => setNuevaNovedad((p) => ({ ...p, valor_total: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3" placeholder="Observaciones (opcional)" value={nuevaNovedad.observaciones} onChange={(e) => setNuevaNovedad((p) => ({ ...p, observaciones: e.target.value }))} />
            <div className="md:col-span-2 flex justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                disabled={
                  !periodoId ||
                  crearNovedadMutation.isLoading ||
                  !nuevaNovedad.empleado_id ||
                  !nuevaNovedad.concepto.trim() ||
                  Number(nuevaNovedad.valor_total) <= 0
                }
                onClick={() => crearNovedadMutation.mutate()}
              >
                {crearNovedadMutation.isLoading ? 'Guardando...' : 'Agregar novedad'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Empleado</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Concepto</th>
                  <th className="px-3 py-2 font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(novedadesQuery.data ?? []).map((n) => {
                  const emp = empleadosById.get(n.empleado_id);
                  return (
                    <tr key={n.id}>
                      <td className="px-3 py-2 text-slate-900">{emp ? `${emp.nombres} ${emp.apellidos}` : n.empleado_id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-slate-700">{n.tipo}</td>
                      <td className="px-3 py-2 text-slate-700">{n.concepto}</td>
                      <td className="px-3 py-2 text-slate-800 font-medium">{money(n.valor_total)}</td>
                      <td className="px-3 py-2 text-slate-600">{dateTime(n.created_at)}</td>
                    </tr>
                  );
                })}
                {periodoId && (novedadesQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-slate-500">Sin novedades en este periodo.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Centros de costo</h2>
            <span className="text-xs text-slate-500">{(centrosCostoQuery.data ?? []).length} registrados</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nuevoCentroCosto.sucursal_id}
              onChange={(e) => setNuevoCentroCosto((p) => ({ ...p, sucursal_id: e.target.value }))}
            >
              <option value="">Sede (opcional)</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Codigo" value={nuevoCentroCosto.codigo} onChange={(e) => setNuevoCentroCosto((p) => ({ ...p, codigo: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Nombre" value={nuevoCentroCosto.nombre} onChange={(e) => setNuevoCentroCosto((p) => ({ ...p, nombre: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Descripcion (opcional)" value={nuevoCentroCosto.descripcion} onChange={(e) => setNuevoCentroCosto((p) => ({ ...p, descripcion: e.target.value }))} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              disabled={crearCentroCostoMutation.isLoading || !nuevoCentroCosto.codigo.trim() || !nuevoCentroCosto.nombre.trim()}
              onClick={() => crearCentroCostoMutation.mutate()}
            >
              {crearCentroCostoMutation.isLoading ? 'Guardando...' : 'Crear centro de costo'}
            </button>
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Codigo</th>
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Sede</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(centrosCostoQuery.data ?? []).map((cc) => (
                  <tr key={cc.id}>
                    <td className="px-3 py-2 text-slate-900 font-medium">{cc.codigo}</td>
                    <td className="px-3 py-2 text-slate-700">{cc.nombre}</td>
                    <td className="px-3 py-2 text-slate-600">{sucursales.find((s) => s.id === cc.sucursal_id)?.nombre || 'General'}</td>
                  </tr>
                ))}
                {(centrosCostoQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-slate-500">Sin centros de costo registrados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Empleados (hoja de vida basica)</h2>
            <span className="text-xs text-slate-500">{(empleadosQuery.data ?? []).length} registrados</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nuevoEmpleado.sucursal_id}
              onChange={(e) => setNuevoEmpleado((p) => ({ ...p, sucursal_id: e.target.value }))}
            >
              <option value="">Sede (opcional)</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Codigo interno" value={nuevoEmpleado.codigo_interno} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, codigo_interno: e.target.value }))} />
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={nuevoEmpleado.documento_tipo} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, documento_tipo: e.target.value }))}>
              <option value="CC">CC</option>
              <option value="CE">CE</option>
              <option value="NIT">NIT</option>
              <option value="TI">TI</option>
              <option value="PAS">PAS</option>
            </select>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Documento" value={nuevoEmpleado.documento_numero} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, documento_numero: e.target.value }))} />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nuevoEmpleado.centro_costo_id}
              onChange={(e) => setNuevoEmpleado((p) => ({ ...p, centro_costo_id: e.target.value }))}
            >
              <option value="">Centro de costo (opcional)</option>
              {(centrosCostoQuery.data ?? []).map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {`${cc.codigo} - ${cc.nombre}`}
                </option>
              ))}
            </select>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha ingreso</label>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={nuevoEmpleado.fecha_ingreso} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, fecha_ingreso: e.target.value }))} />
            </div>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Nombres" value={nuevoEmpleado.nombres} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, nombres: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Apellidos" value={nuevoEmpleado.apellidos} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, apellidos: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Email" value={nuevoEmpleado.email} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, email: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Celular" value={nuevoEmpleado.celular} onChange={(e) => setNuevoEmpleado((p) => ({ ...p, celular: e.target.value }))} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              disabled={
                crearEmpleadoMutation.isLoading ||
                !nuevoEmpleado.documento_numero.trim() ||
                !nuevoEmpleado.nombres.trim() ||
                !nuevoEmpleado.apellidos.trim() ||
                !nuevoEmpleado.fecha_ingreso
              }
              onClick={() => crearEmpleadoMutation.mutate()}
            >
              {crearEmpleadoMutation.isLoading ? 'Guardando...' : 'Crear empleado'}
            </button>
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Empleado</th>
                  <th className="px-3 py-2 font-medium">Documento</th>
                  <th className="px-3 py-2 font-medium">Centro costo</th>
                  <th className="px-3 py-2 font-medium">Ingreso</th>
                  <th className="px-3 py-2 font-medium">Contacto</th>
                  <th className="px-3 py-2 font-medium">Contratos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(empleadosQuery.data ?? []).map((emp) => (
                  <tr key={emp.id}>
                    <td className="px-3 py-2 text-slate-900 font-medium">{`${emp.nombres} ${emp.apellidos}`}</td>
                    <td className="px-3 py-2 text-slate-700">{`${emp.documento_tipo} ${emp.documento_numero}`}</td>
                    <td className="px-3 py-2 text-slate-700">{centrosCostoById.get(emp.centro_costo_id || '')?.codigo || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{emp.fecha_ingreso || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{emp.email || emp.celular || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{contratosByEmpleado.get(emp.id)?.length ?? 0}</td>
                  </tr>
                ))}
                {(empleadosQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-slate-500">Sin empleados registrados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Contratos</h2>
            <span className="text-xs text-slate-500">{(contratosQuery.data ?? []).length} registrados</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" value={nuevoContrato.empleado_id} onChange={(e) => setNuevoContrato((p) => ({ ...p, empleado_id: e.target.value }))}>
              <option value="">Seleccione empleado</option>
              {(empleadosQuery.data ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>{`${emp.nombres} ${emp.apellidos} (${emp.documento_numero})`}</option>
              ))}
            </select>
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={nuevoContrato.tipo_contrato} onChange={(e) => setNuevoContrato((p) => ({ ...p, tipo_contrato: e.target.value as typeof p.tipo_contrato }))}>
              <option value="indefinido">Indefinido</option>
              <option value="fijo">Fijo</option>
              <option value="obra_labor">Obra/Labor</option>
              <option value="aprendizaje">Aprendizaje</option>
              <option value="temporal">Temporal</option>
            </select>
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={nuevoContrato.periodicidad} onChange={(e) => setNuevoContrato((p) => ({ ...p, periodicidad: e.target.value as typeof p.periodicidad }))}>
              <option value="mensual">Mensual</option>
              <option value="quincenal">Quincenal</option>
            </select>
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={nuevoContrato.centro_costo_id} onChange={(e) => setNuevoContrato((p) => ({ ...p, centro_costo_id: e.target.value }))}>
              <option value="">Centro costo (opcional)</option>
              {(centrosCostoQuery.data ?? []).map((cc) => (
                <option key={cc.id} value={cc.id}>{`${cc.codigo} - ${cc.nombre}`}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={nuevoContrato.es_salario_integral}
                onChange={(e) => setNuevoContrato((p) => ({ ...p, es_salario_integral: e.target.checked }))}
              />
              Salario integral
            </label>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min="1" placeholder="Salario base" value={nuevoContrato.salario_base} onChange={(e) => setNuevoContrato((p) => ({ ...p, salario_base: e.target.value }))} />
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha inicio contrato</label>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={nuevoContrato.fecha_inicio} onChange={(e) => setNuevoContrato((p) => ({ ...p, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha fin (opcional)</label>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={nuevoContrato.fecha_fin} onChange={(e) => setNuevoContrato((p) => ({ ...p, fecha_fin: e.target.value }))} />
            </div>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3" placeholder="Observaciones (opcional)" value={nuevoContrato.observaciones} onChange={(e) => setNuevoContrato((p) => ({ ...p, observaciones: e.target.value }))} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              disabled={
                crearContratoMutation.isLoading ||
                !nuevoContrato.empleado_id ||
                !nuevoContrato.fecha_inicio ||
                !nuevoContrato.salario_base ||
                Number(nuevoContrato.salario_base) <= 0
              }
              onClick={() => crearContratoMutation.mutate()}
            >
              {crearContratoMutation.isLoading ? 'Guardando...' : 'Crear contrato'}
            </button>
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Empleado</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Periodicidad</th>
                  <th className="px-3 py-2 font-medium">Centro costo</th>
                  <th className="px-3 py-2 font-medium">Integral</th>
                  <th className="px-3 py-2 font-medium">Salario base</th>
                  <th className="px-3 py-2 font-medium">Inicio</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(contratosQuery.data ?? []).map((c) => {
                  const emp = empleadosById.get(c.empleado_id);
                  return (
                    <tr key={c.id}>
                      <td className="px-3 py-2 text-slate-900">{emp ? `${emp.nombres} ${emp.apellidos}` : c.empleado_id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-slate-700">{c.tipo_contrato}</td>
                      <td className="px-3 py-2 text-slate-700">{c.periodicidad}</td>
                      <td className="px-3 py-2 text-slate-700">{centrosCostoById.get(c.centro_costo_id || '')?.codigo || '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{c.es_salario_integral ? 'Sí' : 'No'}</td>
                      <td className="px-3 py-2 text-slate-800 font-medium">{money(c.salario_base)}</td>
                      <td className="px-3 py-2 text-slate-600">{c.fecha_inicio}</td>
                      <td className="px-3 py-2 text-slate-700">{c.estado}</td>
                    </tr>
                  );
                })}
                {(contratosQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-slate-500">Sin contratos registrados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">Liquidaciones del periodo</h2>
          </div>
          <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50/50">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={filtroLiquidaciones.sucursal_id}
              onChange={(e) => setFiltroLiquidaciones((p) => ({ ...p, sucursal_id: e.target.value }))}
            >
              <option value="">Filtrar por sede (todas)</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={filtroLiquidaciones.centro_costo_id}
              onChange={(e) => setFiltroLiquidaciones((p) => ({ ...p, centro_costo_id: e.target.value }))}
            >
              <option value="">Filtrar por centro costo (todos)</option>
              {(centrosCostoQuery.data ?? []).map((cc) => (
                <option key={cc.id} value={cc.id}>{`${cc.codigo} - ${cc.nombre}`}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={filtroLiquidaciones.empleado_id}
              onChange={(e) => setFiltroLiquidaciones((p) => ({ ...p, empleado_id: e.target.value }))}
            >
              <option value="">Filtrar por empleado (todos)</option>
              {(empleadosQuery.data ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>{`${emp.nombres} ${emp.apellidos}`}</option>
              ))}
            </select>
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setFiltroLiquidaciones({ empleado_id: '', sucursal_id: '', centro_costo_id: '' })}
            >
              Limpiar filtros liquidaciones
            </button>
          </div>

          {!periodoId && !periodosQuery.isLoading && (
            <p className="p-5 text-sm text-amber-700">No hay periodos aun. Crea el primero en el bloque superior.</p>
          )}
          {periodoId && liquidacionesQuery.isLoading && (
            <p className="p-5 text-sm text-slate-600">Cargando liquidaciones...</p>
          )}
          {periodoId && liquidacionesQuery.isError && (
            <p className="p-5 text-sm text-red-600">No se pudo cargar el listado de liquidaciones.</p>
          )}
          {periodoId && liquidacionesQuery.data && liquidacionesQuery.data.length === 0 && (
            <p className="p-5 text-sm text-slate-600">No hay liquidaciones para este periodo.</p>
          )}
          {periodoId && liquidacionesQuery.data && liquidacionesQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Empleado</th>
                    <th className="px-4 py-3 font-medium">Neto a pagar</th>
                    <th className="px-4 py-3 font-medium">Folio</th>
                    <th className="px-4 py-3 font-medium">Version</th>
                    <th className="px-4 py-3 font-medium">Ultima emision</th>
                    <th className="px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {liquidacionesQuery.data.map((liq) => (
                    <tr key={liq.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-slate-700">
                        {(() => {
                          const emp = empleadosById.get(liq.empleado_id);
                          if (!emp) return <span className="font-mono text-xs">{`${liq.empleado_id.slice(0, 8)}...`}</span>;
                          return (
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">{`${emp.nombres} ${emp.apellidos}`}</div>
                              <div className="text-xs text-slate-500">{emp.documento_numero}</div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-800 font-medium">{money(liq.neto_pagar)}</td>
                      <td className="px-4 py-3 text-slate-700">{liq.desprendible_folio ?? 'Sin generar'}</td>
                      <td className="px-4 py-3 text-slate-700">v{liq.desprendible_version || 1}</td>
                      <td className="px-4 py-3 text-slate-600">{dateTime(liq.desprendible_generated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            className="p-2 rounded-lg text-primary-600 hover:bg-primary-50"
                            title="Descargar desprendible actual"
                            onClick={() => void descargarActual(liq)}
                            disabled={downloadingId === liq.id}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50"
                            title="Historial de versiones"
                            onClick={() => setHistorialPara(liq)}
                          >
                            <FileClock className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => reemitirMutation.mutate(liq.id)}
                            disabled={reemitirMutation.isLoading}
                          >
                            Reemitir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {historialPara && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setHistorialPara(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h2 className="text-lg font-semibold text-slate-900 truncate">
                Historial desprendible - {historialPara.desprendible_folio ?? historialPara.id.slice(0, 8)}
              </h2>
              <button
                type="button"
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/80"
                onClick={() => setHistorialPara(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {versionesQuery.isLoading && <p className="text-sm text-slate-600">Cargando versiones...</p>}
              {versionesQuery.isError && <p className="text-sm text-red-600">No se pudo cargar el historial.</p>}
              {versionesQuery.data && versionesQuery.data.length === 0 && (
                <p className="text-sm text-slate-600">No hay versiones registradas para esta liquidacion.</p>
              )}
              {versionesQuery.data && versionesQuery.data.length > 0 && (
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Version</th>
                        <th className="px-3 py-2 font-medium">Folio</th>
                        <th className="px-3 py-2 font-medium">SHA256</th>
                        <th className="px-3 py-2 font-medium">Motivo</th>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {versionesQuery.data.map((v) => (
                        <tr key={v.id}>
                          <td className="px-3 py-2 font-mono text-slate-800">v{v.version}</td>
                          <td className="px-3 py-2 text-slate-700">{v.folio ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600 font-mono text-xs">{`${v.pdf_sha256.slice(0, 12)}...`}</td>
                          <td className="px-3 py-2 text-slate-700">{v.motivo}</td>
                          <td className="px-3 py-2 text-slate-600">{dateTime(v.generated_at)}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-primary-600 text-xs font-medium hover:underline disabled:opacity-50"
                              onClick={() => void descargarVersion(v)}
                              disabled={downloadingId === v.id}
                            >
                              Descargar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
