import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Users, Plus, Pencil, Star, CheckCircle2, XCircle } from 'lucide-react';
import Layout from '../components/Layout';
import apiClient from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario } from '../types';
import UsuariosPage from './Usuarios';

type TabKey = 'sedes' | 'usuarios';

interface SucursalRow {
  id: string;
  tenant_id: string;
  nombre: string;
  codigo: string | null;
  activa: boolean;
  es_principal: boolean;
}

export default function OrganizacionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = searchParams.get('tab') === 'usuarios' ? 'usuarios' : 'sedes';
  const { user, refreshTenantUser } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const queryClient = useQueryClient();

  const setTab = (next: TabKey) => {
    if (next === 'sedes') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: 'usuarios' }, { replace: true });
    }
  };

  const limitePlan = tenantUser?.tenant_sedes_totales ?? null;
  const sedesActuales = tenantUser?.sucursales?.length ?? 0;

  const { data: sedesLista, isLoading } = useQuery<SucursalRow[]>({
    queryKey: ['sucursales-admin'],
    queryFn: async () => {
      const r = await apiClient.get<SucursalRow[]>('/sucursales');
      return r.data;
    },
    enabled: tab === 'sedes',
  });

  const countSedes = sedesLista?.length ?? sedesActuales;
  const puedeCrearMas = limitePlan == null || countSedes < limitePlan;

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modalCrear, setModalCrear] = useState(false);
  const [editando, setEditando] = useState<SucursalRow | null>(null);
  const [form, setForm] = useState({
    nombre: '',
    codigo: '',
    activa: true,
    es_principal: false,
  });

  const crearMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post('/sucursales', {
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim() || null,
        activa: form.activa,
        es_principal: form.es_principal,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sucursales-admin'] });
      await refreshTenantUser();
      setModalCrear(false);
      setForm({ nombre: '', codigo: '', activa: true, es_principal: false });
      setFeedback({ type: 'success', message: 'Sede creada correctamente.' });
    },
    onError: (e: any) => {
      setFeedback({
        type: 'error',
        message: e?.response?.data?.detail || 'No se pudo crear la sede.',
      });
    },
  });

  const actualizarMutation = useMutation({
    mutationFn: async () => {
      if (!editando) return;
      await apiClient.patch(`/sucursales/${editando.id}`, {
        nombre: form.nombre.trim(),
        codigo: form.codigo.trim() || null,
        activa: form.activa,
        es_principal: form.es_principal,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sucursales-admin'] });
      await refreshTenantUser();
      setEditando(null);
      setFeedback({ type: 'success', message: 'Sede actualizada.' });
    },
    onError: (e: any) => {
      setFeedback({
        type: 'error',
        message: e?.response?.data?.detail || 'No se pudo guardar.',
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

  return (
    <Layout title="Sedes y usuarios">
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
              Sedes y usuarios
            </h2>
            <p className="text-slate-600 mt-1">
              Administra las sedes de tu CDA y los usuarios que operan en ellas.
            </p>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-slate-600 text-sm">
                Cada sede es un contexto operativo: recepción, caja y reportes pueden filtrarse por sede.
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
                  });
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
                      <th className="text-left px-4 py-3">Estado</th>
                      <th className="text-left px-4 py-3">Principal</th>
                      <th className="text-right px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sedesLista || []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No hay sedes registradas.
                        </td>
                      </tr>
                    )}
                    {(sedesLista || []).map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{s.nombre}</td>
                        <td className="px-4 py-3 text-slate-600">{s.codigo || '—'}</td>
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
                              });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Nueva sede</h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre *</label>
              <input
                className="input w-full"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
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
            <div className="flex gap-2 justify-end pt-2">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Editar sede</h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre *</label>
              <input
                className="input w-full"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
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
            <div className="flex gap-2 justify-end pt-2">
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
