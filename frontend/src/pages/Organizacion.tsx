import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Users, Plus, Pencil, Star, CheckCircle2, XCircle, ListOrdered, Loader2 } from 'lucide-react';
import Layout from '../components/Layout';
import FactusMunicipalitySearchField from '../components/FactusMunicipalitySearchField';
import FactusMultiSedeGuide from '../components/FactusMultiSedeGuide';
import apiClient from '../api/client';
import { configApi } from '../api/config';
import { factusApi, type FactusNumberingRangeItem } from '../api/factus';
import { useAuth } from '../contexts/AuthContext';
import type { SucursalAdminRow, Usuario } from '../types';
import UsuariosPage from './Usuarios';

type TabKey = 'sedes' | 'usuarios';

function tabFromSearch(tabParam: string | null): TabKey {
  if (tabParam === 'usuarios') return 'usuarios';
  return 'sedes';
}

export default function OrganizacionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = tabFromSearch(searchParams.get('tab'));
  const { user, refreshTenantUser } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const queryClient = useQueryClient();

  const setTab = (next: TabKey) => {
    if (next === 'sedes') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  const limitePlan = tenantUser?.tenant_sedes_totales ?? null;
  const sedesActuales = tenantUser?.sucursales?.length ?? 0;

  const { data: sedesLista, isLoading } = useQuery<SucursalAdminRow[]>({
    queryKey: ['sucursales-admin'],
    queryFn: async () => {
      const r = await apiClient.get<SucursalAdminRow[]>('/sucursales');
      return r.data;
    },
    enabled: tab === 'sedes',
  });

  const { data: ubicacionMatriz } = useQuery({
    queryKey: ['config-facturacion-ubicacion'],
    queryFn: () => configApi.obtenerFacturacionUbicacion(),
    enabled: tab === 'sedes',
  });

  const [matrizDraft, setMatrizDraft] = useState({ direccion: '', municipio: '' });

  useEffect(() => {
    if (!ubicacionMatriz) return;
    setMatrizDraft({
      direccion: ubicacionMatriz.direccion_facturacion ?? '',
      municipio:
        ubicacionMatriz.factus_municipality_id != null
          ? String(ubicacionMatriz.factus_municipality_id)
          : '',
    });
  }, [ubicacionMatriz]);

  const saveMatrizMutation = useMutation({
    mutationFn: async () => {
      const m = matrizDraft.municipio.trim();
      let mid: number | null = null;
      if (m) {
        const n = parseInt(m, 10);
        if (Number.isNaN(n) || n < 1) {
          throw new Error('El código de municipio debe ser un número entero mayor a 0.');
        }
        mid = n;
      }
      await configApi.actualizarFacturacionUbicacion({
        direccion_facturacion: matrizDraft.direccion.trim() || null,
        factus_municipality_id: m ? mid : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['config-facturacion-ubicacion'] });
      setFeedback({
        type: 'success',
        message: 'Datos de facturación de la matriz guardados. Se usarán como respaldo si una sede no tiene municipio propio.',
      });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'No se pudo guardar.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  const { data: factusSettings, isLoading: loadingFactusModo } = useQuery({
    queryKey: ['factus-settings'],
    queryFn: () => factusApi.getSettings(),
    enabled: tab === 'sedes',
  });

  const patchFactusModoMutation = useMutation({
    mutationFn: (payload: { modo: 'manual' | 'factus' }) => factusApi.patchModo(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['factus-settings'] });
      setFeedback({
        type: 'success',
        message: 'Modo de facturación actualizado. En caja se aplicará al cargar o al abrir de nuevo la pantalla.',
      });
    },
    onError: (e: unknown) => {
      const detail =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setFeedback({
        type: 'error',
        message: typeof detail === 'string' ? detail : 'No se pudo cambiar el modo de facturación.',
      });
    },
  });

  const [rangesPreviewSede, setRangesPreviewSede] = useState<FactusNumberingRangeItem[] | null>(null);

  const rangesFactusMutation = useMutation({
    mutationFn: () => factusApi.listNumberingRanges(),
    onSuccess: (rows) => {
      setRangesPreviewSede(rows);
      setFeedback({
        type: 'success',
        message:
          rows.length === 0
            ? 'Factus no devolvió rangos. Revisa credenciales y ambiente en CDASOFT.'
            : `${rows.length} rango(s) disponibles. Usa el id de «Factura de Venta» (documento 01).`,
      });
    },
    onError: (e: unknown) => {
      const detail =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setFeedback({
        type: 'error',
        message: typeof detail === 'string' ? detail : 'No se pudieron consultar los rangos en Factus.',
      });
    },
  });

  const testFactusMutation = useMutation({
    mutationFn: () => factusApi.testConnection(),
    onSuccess: (data) => {
      setFeedback({
        type: 'success',
        message: data.message || 'Conexión con Factus correcta.',
      });
    },
    onError: (e: unknown) => {
      const detail =
        typeof e === 'object' && e !== null && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setFeedback({
        type: 'error',
        message: typeof detail === 'string' ? detail : 'No se pudo probar la conexión con Factus.',
      });
    },
  });

  const countSedes = sedesLista?.length ?? sedesActuales;
  const puedeCrearMas = limitePlan == null || countSedes < limitePlan;

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modalCrear, setModalCrear] = useState(false);
  const [editando, setEditando] = useState<SucursalAdminRow | null>(null);
  const [form, setForm] = useState({
    nombre: '',
    codigo: '',
    activa: true,
    es_principal: false,
    ciudad: '',
    direccion: '',
    factus_municipality_id: '',
    factus_numbering_range_id: '',
  });

  const crearMutation = useMutation({
    mutationFn: async () => {
      const midStr = form.factus_municipality_id.trim();
      if (midStr) {
        const n = parseInt(midStr, 10);
        if (Number.isNaN(n) || n < 1) {
          throw new Error('Código de municipio inválido.');
        }
      }
      const rangeStr = form.factus_numbering_range_id.trim();
      if (rangeStr) {
        const r = parseInt(rangeStr, 10);
        if (Number.isNaN(r) || r < 1) {
          throw new Error('Id de rango Factus inválido.');
        }
      }
      const payload: Record<string, unknown> = {
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim() || null,
        activa: form.activa,
        es_principal: form.es_principal,
      };
      if (midStr) payload.factus_municipality_id = parseInt(midStr, 10);
      if (rangeStr) payload.factus_numbering_range_id = parseInt(rangeStr, 10);
      const dir = form.direccion.trim();
      if (dir) payload.direccion = dir;
      const ciu = form.ciudad.trim();
      if (ciu) payload.ciudad = ciu;
      await apiClient.post('/sucursales', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sucursales-admin'] });
      await refreshTenantUser();
      setModalCrear(false);
      setForm({
        nombre: '',
        codigo: '',
        activa: true,
        es_principal: false,
        ciudad: '',
        direccion: '',
        factus_municipality_id: '',
        factus_numbering_range_id: '',
      });
      setRangesPreviewSede(null);
      setFeedback({ type: 'success', message: 'Sede creada correctamente.' });
    },
    onError: (e: unknown) => {
      const msg =
        e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : '';
      setFeedback({
        type: 'error',
        message:
          msg ||
          (typeof e === 'object' && e !== null && 'response' in e
            ? String((e as { response?: { data?: { detail?: string } } }).response?.data?.detail)
            : '') ||
          'No se pudo crear la sede.',
      });
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: async () => {
      if (!editando) return;
      const midStr = form.factus_municipality_id.trim();
      if (midStr) {
        const n = parseInt(midStr, 10);
        if (Number.isNaN(n) || n < 1) {
          throw new Error('Código de municipio inválido.');
        }
      }
      const rangeStr = form.factus_numbering_range_id.trim();
      if (rangeStr) {
        const r = parseInt(rangeStr, 10);
        if (Number.isNaN(r) || r < 1) {
          throw new Error('Id de rango Factus inválido.');
        }
      }
      await apiClient.patch(`/sucursales/${editando.id}`, {
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim() || null,
        activa: form.activa,
        es_principal: form.es_principal,
        factus_municipality_id: midStr ? parseInt(midStr, 10) : null,
        factus_numbering_range_id: rangeStr ? parseInt(rangeStr, 10) : null,
        direccion: form.direccion.trim() || null,
        ciudad: form.ciudad.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sucursales-admin'] });
      await refreshTenantUser();
      setEditando(null);
      setRangesPreviewSede(null);
      setFeedback({ type: 'success', message: 'Sede actualizada.' });
    },
    onError: (e: unknown) => {
      const msg =
        e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : '';
      setFeedback({
        type: 'error',
        message:
          msg ||
          (typeof e === 'object' && e !== null && 'response' in e
            ? String((e as { response?: { data?: { detail?: string } } }).response?.data?.detail)
            : '') ||
          'No se pudo guardar.',
      });
    },
  });

  const marcarPrincipalMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.patch(`/sucursales/${id}`, { es_principal: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sucursales-admin'] });
      await refreshTenantUser();
      setFeedback({ type: 'success', message: 'Sede principal actualizada.' });
    },
    onError: (e: any) => {
      setFeedback({
        type: 'error',
        message: e?.response?.data?.detail || 'No se pudo cambiar la sede principal.',
      });
    },
  });

  const hintPlan = useMemo(() => {
    if (limitePlan == null) return null;
    return `Plan: hasta ${limitePlan} sede${limitePlan === 1 ? '' : 's'} · Configuradas: ${countSedes}`;
  }, [limitePlan, countSedes]);

  const layoutTitle = tab === 'sedes' ? 'Sedes' : 'Usuarios';

  return (
    <Layout title={layoutTitle}>
      <div className="space-y-6">
        {feedback && (
          <div
            className={`rounded-xl border p-4 text-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-8 h-8 text-primary-600" />
              Organización
            </h2>
            <p className="text-slate-600 mt-1">Sedes y usuarios de tu CDA.</p>
            {hintPlan && <p className="text-sm text-primary-700 font-medium mt-2">{hintPlan}</p>}
          </div>
        </div>

        <section className="section-card p-2">
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setTab('sedes')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                tab === 'sedes' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Building2 className="w-4 h-4" />
              Sedes
            </button>
            <button
              type="button"
              onClick={() => setTab('usuarios')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                tab === 'usuarios' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4" />
              Usuarios
            </button>
          </div>
        </section>

        {tab === 'sedes' && (
          <div className="card-pos space-y-4">
            <FactusMultiSedeGuide variant="cda_app" />
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Factura electrónica — datos de la matriz</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Dirección y, si aplica, el <strong>id de municipio en Factus</strong> (no el código DIAN). Es el{' '}
                  <strong>respaldo del CDA</strong> y el valor por defecto de la <strong>sede principal</strong> en
                  factura: si la sede principal deja vacíos dirección y municipio propios, se usan estos datos. Las{' '}
                  <strong>sedes adicionales</strong> solo rellenan dirección y municipio cuando facturan en otro
                  establecimiento; si los dejan vacíos, también heredan la matriz.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Dirección del establecimiento</label>
                  <textarea
                    className="input w-full min-h-[72px] resize-y text-sm"
                    value={matrizDraft.direccion}
                    onChange={(e) => setMatrizDraft((d) => ({ ...d, direccion: e.target.value }))}
                    placeholder="Ej. Calle 10 # 20-30"
                    maxLength={500}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FactusMunicipalitySearchField
                    value={matrizDraft.municipio}
                    onChange={(idDigits) => setMatrizDraft((d) => ({ ...d, municipio: idDigits }))}
                    idInputClassName="input w-full max-w-xs text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-primary-solid px-4 text-sm disabled:opacity-50"
                  disabled={saveMatrizMutation.isLoading}
                  onClick={() => {
                    setFeedback(null);
                    saveMatrizMutation.mutate();
                  }}
                >
                  {saveMatrizMutation.isLoading ? 'Guardando…' : 'Guardar datos matriz'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Factus — facturación automática en caja</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  El cobro debe generar la factura electrónica solo: el sistema <strong>reintenta automáticamente</strong>{' '}
                  fallos temporales de red con Factus. Cada sede debe tener su <strong>id de rango Factus</strong> si
                  factura con resolución distinta (p. ej. otra ciudad); si no, se usa el rango predeterminado que configuró
                  CDASOFT. Si el mensaje habla de factura «pendiente» ante la DIAN, el bloqueo lo impone la{' '}
                  <strong>cuenta Factus</strong>. Reenvíe el mensaje completo a <strong>CDASOFT</strong> para revisar la
                  cuenta; el cajero no debe pasar a papel salvo indicación expresa.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-primary-solid px-4 py-2 text-sm disabled:opacity-50"
                  disabled={testFactusMutation.isLoading || factusSettings?.modo !== 'factus'}
                  onClick={() => {
                    setFeedback(null);
                    testFactusMutation.mutate();
                  }}
                  title={factusSettings?.modo !== 'factus' ? 'Solo aplica con modo Factus activo (backoffice)' : undefined}
                >
                  {testFactusMutation.isLoading ? 'Probando…' : 'Probar conexión con Factus'}
                </button>
                {!loadingFactusModo && (
                  <span className="text-xs text-slate-500">
                    Modo:{' '}
                    <strong>{factusSettings?.modo === 'factus' ? 'Factus' : 'Manual'}</strong>
                    {factusSettings?.modo !== 'factus' && ' — active Factus desde backoffice CDASOFT para emitir aquí.'}
                  </span>
                )}
              </div>
              <details className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700 select-none">
                  Opción avanzada (solo si CDASOFT lo indica)
                </summary>
                <p className="mt-2 mb-2">
                  Conmutar a facturación manual temporal hace que en caja se pida el número DIAN a mano. No es el flujo
                  normal.
                </p>
                {loadingFactusModo ? (
                  <p className="text-slate-500">Cargando…</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`px-2 py-1.5 rounded-md text-xs font-semibold border ${
                        factusSettings?.modo === 'manual'
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white border-slate-300'
                      }`}
                      disabled={patchFactusModoMutation.isLoading || factusSettings?.modo === 'manual'}
                      onClick={() => {
                        setFeedback(null);
                        patchFactusModoMutation.mutate({ modo: 'manual' });
                      }}
                    >
                      Manual
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1.5 rounded-md text-xs font-semibold border ${
                        factusSettings?.modo === 'factus'
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white border-slate-300'
                      }`}
                      disabled={patchFactusModoMutation.isLoading || factusSettings?.modo === 'factus'}
                      onClick={() => {
                        setFeedback(null);
                        patchFactusModoMutation.mutate({ modo: 'factus' });
                      }}
                    >
                      Factus
                    </button>
                  </div>
                )}
              </details>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-slate-600 text-sm">
                Cada sede es un contexto operativo: recepción, caja y reportes pueden filtrarse por sede. En la tabla,
                <span className="italic text-slate-500"> Hereda matriz</span> en dirección o municipio indica que al
                facturar se usan los datos de matriz de arriba.
              </p>
              <button
                type="button"
                disabled={!puedeCrearMas}
                onClick={() => {
                  setFeedback(null);
                  setForm({
                    nombre: '',
                    codigo: '',
                    activa: true,
                    es_principal: sedesLista?.length === 0,
                    ciudad: '',
                    direccion: '',
                    factus_municipality_id: '',
                    factus_numbering_range_id: '',
                  });
                  setRangesPreviewSede(null);
                  setModalCrear(true);
                }}
                className="btn-primary-solid flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-5 h-5" />
                Nueva sede
              </button>
            </div>

            {!puedeCrearMas && limitePlan != null && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                Llegaste al máximo de sedes de tu plan ({limitePlan}). Para agregar más, amplía tu plan o contacta
                soporte.
              </p>
            )}

            {isLoading ? (
              <p className="text-slate-500 py-8 text-center">Cargando sedes...</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-3">Nombre</th>
                      <th className="text-left px-4 py-3">Código</th>
                      <th className="text-left px-4 py-3 min-w-[6rem]">Ciudad</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">Id mpio. Factus</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">Rango Factus</th>
                      <th className="text-left px-4 py-3 min-w-[8rem]">Dirección</th>
                      <th className="text-left px-4 py-3">Estado</th>
                      <th className="text-left px-4 py-3">Principal</th>
                      <th className="text-right px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sedesLista || []).length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                          No hay sedes registradas.
                        </td>
                      </tr>
                    )}
                    {(sedesLista || []).map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{s.nombre}</td>
                        <td className="px-4 py-3 text-slate-600">{s.codigo || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[8rem] truncate" title={s.ciudad || undefined}>
                          {s.ciudad?.trim() ? s.ciudad : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums">
                          {s.factus_municipality_id != null ? (
                            s.factus_municipality_id
                          ) : (
                            <span
                              className="italic text-slate-500 text-xs font-sans"
                              title="Al facturar se usa el código de municipio de la matriz"
                            >
                              Hereda matriz
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums">
                          {s.factus_numbering_range_id != null ? (
                            s.factus_numbering_range_id
                          ) : (
                            <span
                              className="italic text-slate-500 text-xs font-sans"
                              title="Se usa el rango predeterminado del tenant (CDASOFT)"
                            >
                              Predeterm. tenant
                            </span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 text-slate-600 max-w-[10rem] truncate"
                          title={s.direccion?.trim() ? s.direccion : 'Al facturar se usa la dirección de la matriz'}
                        >
                          {s.direccion?.trim() ? (
                            s.direccion
                          ) : (
                            <span className="italic text-slate-500 text-xs">Hereda matriz</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {s.activa ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="w-4 h-4" /> Activa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <XCircle className="w-4 h-4" /> Inactiva
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {s.es_principal ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <Star className="w-4 h-4 fill-amber-400 text-amber-500" /> Sí
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-primary-600 hover:underline text-xs font-semibold"
                              onClick={() => marcarPrincipalMutation.mutate(s.id)}
                              disabled={marcarPrincipalMutation.isLoading}
                            >
                              Marcar principal
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary-600 font-semibold hover:underline"
                            onClick={() => {
                              setFeedback(null);
                              setEditando(s);
                              setForm({
                                nombre: s.nombre,
                                codigo: s.codigo || '',
                                activa: s.activa,
                                es_principal: s.es_principal,
                                ciudad: s.ciudad || '',
                                direccion: s.direccion || '',
                                factus_municipality_id:
                                  s.factus_municipality_id != null ? String(s.factus_municipality_id) : '',
                                factus_numbering_range_id:
                                  s.factus_numbering_range_id != null ? String(s.factus_numbering_range_id) : '',
                              });
                              setRangesPreviewSede(null);
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'usuarios' && <UsuariosPage embedded />}
      </div>

      {modalCrear && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/40 overflow-y-auto">
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[min(92vh,calc(100dvh-1.5rem))] my-2 sm:my-8 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-nueva-sede-title"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-2 space-y-4">
            <h3 id="modal-nueva-sede-title" className="text-lg font-bold text-slate-900">
              Nueva sede
            </h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre *</label>
              <input
                className="input w-full uppercase"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value.toUpperCase() }))}
                placeholder="Ej. Sede Norte"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Código (opcional)</label>
              <input
                className="input w-full"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                placeholder="Ej. NTE"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Ciudad (opcional)</label>
              <input
                className="input w-full uppercase"
                value={form.ciudad}
                onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value.toUpperCase() }))}
                placeholder="Ej. Bogotá"
                maxLength={200}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.activa}
                onChange={(e) => setForm((f) => ({ ...f, activa: e.target.checked }))}
              />
              <span className="text-sm text-slate-700">Activa</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.es_principal}
                onChange={(e) => setForm((f) => ({ ...f, es_principal: e.target.checked }))}
              />
              <span className="text-sm text-slate-700">Marcar como sede principal</span>
            </label>
            {form.es_principal ? (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                <strong>Sede principal:</strong> lo habitual es <strong>dejar vacíos</strong> dirección y código de
                municipio para que la factura use siempre los datos de matriz (arriba). Solo complétalos si este punto
                es otro establecimiento ante la DIAN.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Dirección y municipio DIAN: complétalos solo si esta sede factura distinto a la matriz; vacío = hereda
                matriz.
              </p>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Dirección en factura</label>
              <textarea
                className="input w-full min-h-[64px] text-sm uppercase"
                value={form.direccion}
                onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value.toUpperCase() }))}
                placeholder={
                  form.es_principal
                    ? 'Vacío recomendado: se usa la dirección de matriz'
                    : 'Vacío: se usa la dirección de la matriz'
                }
                maxLength={500}
              />
            </div>
            <div className="border-t border-slate-100 pt-3 mt-1">
              <FactusMunicipalitySearchField
                value={form.factus_municipality_id}
                onChange={(idDigits) => setForm((f) => ({ ...f, factus_municipality_id: idDigits }))}
                idInputClassName="input w-full text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                {form.es_principal
                  ? 'Vacío recomendado: se usa el municipio de matriz.'
                  : 'Vacío: se usa el municipio de la matriz.'}
              </p>
            </div>
            <div className="border-t border-slate-100 pt-3 mt-1">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Id rango Factus (por sede)</label>
              <div className="flex flex-wrap items-end gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  className="input w-full max-w-[10rem] text-sm font-mono"
                  value={form.factus_numbering_range_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, factus_numbering_range_id: e.target.value.replace(/\D/g, '') }))
                  }
                  placeholder="Vacío = predeterminado CDASOFT"
                />
                <button
                  type="button"
                  className="btn-corporate-muted inline-flex items-center gap-1.5 text-xs px-2 py-1.5 shrink-0"
                  disabled={rangesFactusMutation.isLoading || factusSettings?.modo !== 'factus'}
                  title={
                    factusSettings?.modo !== 'factus'
                      ? 'Activa modo Factus (backoffice) y credenciales para listar rangos'
                      : undefined
                  }
                  onClick={() => {
                    setFeedback(null);
                    rangesFactusMutation.mutate();
                  }}
                >
                  {rangesFactusMutation.isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ListOrdered className="w-3.5 h-3.5" />
                  )}
                  Consultar rangos
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Si la sede factura en otra ciudad o con otra resolución, usa el id del rango «Factura de Venta» (doc. 01)
                en el mismo ambiente que configuró CDASOFT.
              </p>
              {rangesPreviewSede && rangesPreviewSede.length > 0 && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 max-h-36 overflow-auto text-xs">
                  <table className="min-w-full text-left">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0">
                      <tr>
                        <th className="px-2 py-1">Id</th>
                        <th className="px-2 py-1">Doc.</th>
                        <th className="px-2 py-1">Prefijo</th>
                        <th className="px-2 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {rangesPreviewSede.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono font-semibold">{r.id}</td>
                          <td className="px-2 py-1">{r.document ?? '—'}</td>
                          <td className="px-2 py-1 font-mono">{r.prefix ?? '—'}</td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              className="text-primary-600 font-semibold hover:underline"
                              onClick={() => setForm((f) => ({ ...f, factus_numbering_range_id: String(r.id) }))}
                            >
                              Usar
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
            <div className="shrink-0 border-t border-slate-100 px-6 py-4 flex flex-wrap gap-2 justify-end bg-white rounded-b-2xl">
              <button type="button" className="btn-corporate-muted px-4" onClick={() => setModalCrear(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary-solid px-4 disabled:opacity-50"
                disabled={form.nombre.trim().length < 2 || crearMutation.isLoading}
                onClick={() => crearMutation.mutate()}
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/40 overflow-y-auto">
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[min(92vh,calc(100dvh-1.5rem))] my-2 sm:my-8 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-editar-sede-title"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-2 space-y-4">
            <h3 id="modal-editar-sede-title" className="text-lg font-bold text-slate-900">
              Editar sede
            </h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre *</label>
              <input
                className="input w-full uppercase"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Código (opcional)</label>
              <input
                className="input w-full"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Ciudad (opcional)</label>
              <input
                className="input w-full uppercase"
                value={form.ciudad}
                onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value.toUpperCase() }))}
                maxLength={200}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.activa}
                onChange={(e) => setForm((f) => ({ ...f, activa: e.target.checked }))}
              />
              <span className="text-sm text-slate-700">Activa</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.es_principal}
                onChange={(e) => setForm((f) => ({ ...f, es_principal: e.target.checked }))}
              />
              <span className="text-sm text-slate-700">Sede principal</span>
            </label>
            {form.es_principal ? (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                <strong>Sede principal:</strong> borra dirección y municipio si quieres alinear todo con «datos de la
                matriz» y evitar duplicados. Déjalos solo si facturas con otro establecimiento DIAN.
              </p>
            ) : (
              <p className="text-xs text-slate-500">Vacío en dirección o municipio = hereda la matriz al facturar.</p>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Dirección en factura</label>
              <textarea
                className="input w-full min-h-[64px] text-sm uppercase"
                value={form.direccion}
                onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value.toUpperCase() }))}
                placeholder={
                  form.es_principal
                    ? 'Vacío = dirección de matriz (recomendado si es el mismo establecimiento)'
                    : 'Vacío hereda dirección de la matriz'
                }
                maxLength={500}
              />
            </div>
            <div className="border-t border-slate-100 pt-3 mt-1">
              <FactusMunicipalitySearchField
                value={form.factus_municipality_id}
                onChange={(idDigits) => setForm((f) => ({ ...f, factus_municipality_id: idDigits }))}
                idInputClassName="input w-full text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                {form.es_principal
                  ? 'Vacío = municipio de matriz (recomendado si coincide).'
                  : 'Vacío: mismo municipio que la matriz.'}
              </p>
            </div>
            <div className="border-t border-slate-100 pt-3 mt-1">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Id rango Factus (por sede)</label>
              <div className="flex flex-wrap items-end gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  className="input w-full max-w-[10rem] text-sm font-mono"
                  value={form.factus_numbering_range_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, factus_numbering_range_id: e.target.value.replace(/\D/g, '') }))
                  }
                  placeholder="Vacío = predeterminado CDASOFT"
                />
                <button
                  type="button"
                  className="btn-corporate-muted inline-flex items-center gap-1.5 text-xs px-2 py-1.5 shrink-0"
                  disabled={rangesFactusMutation.isLoading || factusSettings?.modo !== 'factus'}
                  title={
                    factusSettings?.modo !== 'factus'
                      ? 'Activa modo Factus (backoffice) y credenciales para listar rangos'
                      : undefined
                  }
                  onClick={() => {
                    setFeedback(null);
                    rangesFactusMutation.mutate();
                  }}
                >
                  {rangesFactusMutation.isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ListOrdered className="w-3.5 h-3.5" />
                  )}
                  Consultar rangos
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Borra el id y guarda para volver al rango predeterminado del tenant. Mismo ambiente Factus que configuró
                CDASOFT.
              </p>
              {rangesPreviewSede && rangesPreviewSede.length > 0 && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 max-h-36 overflow-auto text-xs">
                  <table className="min-w-full text-left">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0">
                      <tr>
                        <th className="px-2 py-1">Id</th>
                        <th className="px-2 py-1">Doc.</th>
                        <th className="px-2 py-1">Prefijo</th>
                        <th className="px-2 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {rangesPreviewSede.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono font-semibold">{r.id}</td>
                          <td className="px-2 py-1">{r.document ?? '—'}</td>
                          <td className="px-2 py-1 font-mono">{r.prefix ?? '—'}</td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              className="text-primary-600 font-semibold hover:underline"
                              onClick={() => setForm((f) => ({ ...f, factus_numbering_range_id: String(r.id) }))}
                            >
                              Usar
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
            <div className="shrink-0 border-t border-slate-100 px-6 py-4 flex flex-wrap gap-2 justify-end bg-white rounded-b-2xl">
              <button type="button" className="btn-corporate-muted px-4" onClick={() => setEditando(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary-solid px-4 disabled:opacity-50"
                disabled={form.nombre.trim().length < 2 || actualizarMutation.isLoading}
                onClick={() => actualizarMutation.mutate()}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
