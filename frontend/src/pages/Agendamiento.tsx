import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Copy, ExternalLink, MessageCircle, Plus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { appointmentsApi, type AppointmentCreatePayload } from '../api/appointments';
import apiClient from '../api/client';
import type { AppointmentItem } from '../types';
import { useAuth } from '../contexts/AuthContext';

const statusMap: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Agendada', className: 'badge badge-info' },
  confirmed: { label: 'Confirmada', className: 'badge badge-info' },
  checked_in: { label: 'En recepción', className: 'badge badge-success' },
  cancelled: { label: 'Cancelada', className: 'badge badge-danger' },
  no_show: { label: 'No asistió', className: 'badge bg-slate-100 text-slate-700' },
};

const todayIso = new Date().toISOString().slice(0, 10);

export default function Agendamiento() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState(todayIso);
  const [statusFilter, setStatusFilter] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState<AppointmentCreatePayload>({
    cliente_nombre: '',
    cliente_email: '',
    cliente_celular: '',
    placa: '',
    tipo_vehiculo: 'liviano_particular',
    fecha: todayIso,
    hora: '08:00',
    notes: '',
  });

  const query = useQuery({
    queryKey: ['appointments', fecha, statusFilter],
    queryFn: () => appointmentsApi.listByDate(fecha, statusFilter || undefined),
  });

  const tenantBrandingQuery = useQuery({
    queryKey: ['tenant-branding-current'],
    queryFn: async () => {
      const response = await apiClient.get<{ tenant_slug?: string }>('/config/tenant-branding');
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => appointmentsApi.createInternal(form),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Cita creada correctamente.' });
      setForm((prev) => ({ ...prev, cliente_nombre: '', cliente_email: '', cliente_celular: '', placa: '', notes: '' }));
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (error: any) => {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || error?.message || 'No fue posible crear la cita' });
    },
  });

  const checkInMutation = useMutation({
    mutationFn: (id: string) => appointmentsApi.markCheckIn(id),
    onSuccess: (data) => {
      setFeedback({ type: 'success', message: 'Cita marcada como recibida. Redirigiendo a Recepción...' });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      navigate('/recepcion', {
        state: {
          agendamiento_prefill: data?.prefill || null,
        },
      });
    },
    onError: (error: any) => {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'No fue posible marcar check-in' });
    },
  });

  useEffect(() => {
    const state = location.state as
      | {
          agendamiento_comercial_prefill?: Partial<AppointmentCreatePayload>;
        }
      | undefined;
    const prefill = state?.agendamiento_comercial_prefill;
    if (!prefill) return;

    setForm((prev) => ({
      ...prev,
      cliente_nombre: (prefill.cliente_nombre || prev.cliente_nombre || '').toUpperCase(),
      cliente_email: (prefill.cliente_email || prev.cliente_email || '').toLowerCase(),
      cliente_celular: prefill.cliente_celular || prev.cliente_celular || '',
      placa: (prefill.placa || prev.placa || '').toUpperCase(),
      tipo_vehiculo: prefill.tipo_vehiculo || prev.tipo_vehiculo,
      notes: prefill.notes || prev.notes || '',
    }));
    setFeedback({
      type: 'success',
      message: 'Datos del cliente precargados desde vencimientos RTM. Solo define fecha y hora.',
    });

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const stats = useMemo(() => {
    const rows = query.data || [];
    return {
      total: rows.length,
      pendientes: rows.filter((r) => r.status === 'scheduled' || r.status === 'confirmed').length,
      recepcionados: rows.filter((r) => r.status === 'checked_in').length,
    };
  }, [query.data]);

  const tenantSlug =
    tenantBrandingQuery.data?.tenant_slug ||
    ((user && 'tenant_slug' in user ? user.tenant_slug : '') || '');
  const publicLink = tenantSlug ? `${window.location.origin}/agendar/${tenantSlug}` : '';
  const whatsappMessage = `Hola, te compartimos el link oficial para agendar tu cita en nuestro CDA: ${publicLink}`;
  const whatsappShareUrl = publicLink
    ? `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`
    : '';

  const fallbackCopyToClipboard = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  };

  const handleCopyPublicLink = async () => {
    if (!publicLink) {
      setFeedback({ type: 'error', message: 'No fue posible construir el link público del tenant.' });
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(publicLink);
      } else {
        const copied = fallbackCopyToClipboard(publicLink);
        if (!copied) {
          throw new Error('copy-failed');
        }
      }
      setFeedback({ type: 'success', message: 'Link público copiado. Ya puedes compartirlo con el cliente.' });
    } catch {
      setFeedback({ type: 'error', message: 'No se pudo copiar automáticamente. Copia manualmente el enlace del campo.' });
    }
  };

  return (
    <Layout title="Agendamiento">
      <div className="space-y-6">
        <section className="module-hero">
          <p className="module-hero-title flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-blue-600" />
            Agenda de citas del CDA
          </p>
          <p className="module-hero-subtitle">
            Gestiona citas creadas por link público y por el equipo comercial/recepción.
          </p>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white/90 p-3">
            <p className="text-xs font-semibold text-slate-700 mb-2">Link público del tenant</p>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                className="input-corporate flex-1 text-sm"
                value={publicLink}
                readOnly
                placeholder="Cargando link público..."
              />
              <button
                type="button"
                onClick={handleCopyPublicLink}
                className="btn-chip inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                disabled={!publicLink}
                title={publicLink || 'Tenant sin slug disponible'}
              >
                <Copy className="w-4 h-4" />
                Copiar link
              </button>
              <button
                type="button"
                onClick={() => window.open(publicLink, '_blank', 'noopener,noreferrer')}
                className="btn-chip inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                disabled={!publicLink}
              >
                <ExternalLink className="w-4 h-4" />
                Abrir
              </button>
              <button
                type="button"
                onClick={() => window.open(whatsappShareUrl, '_blank', 'noopener,noreferrer')}
                className="btn-success-solid inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                disabled={!publicLink}
              >
                <MessageCircle className="w-4 h-4" />
                Compartir WhatsApp
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Compártelo por WhatsApp o correo con tus clientes para que agenden directamente.
            </p>
          </div>
        </section>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {feedback.message}
          </div>
        )}

        <section className="section-card p-6">
          <p className="text-sm font-semibold text-slate-800 mb-3">Nueva cita</p>
          <form
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFeedback(null);
              createMutation.mutate();
            }}
          >
            <input className="input-corporate uppercase" placeholder="Nombre cliente" value={form.cliente_nombre} onChange={(e) => setForm((p) => ({ ...p, cliente_nombre: e.target.value.toUpperCase() }))} required />
            <input className="input-corporate" placeholder="Celular (opcional)" value={form.cliente_celular || ''} onChange={(e) => setForm((p) => ({ ...p, cliente_celular: e.target.value }))} />
            <input className="input-corporate lowercase" type="email" placeholder="Correo (opcional)" value={form.cliente_email || ''} onChange={(e) => setForm((p) => ({ ...p, cliente_email: e.target.value.toLowerCase() }))} />
            <input className="input-corporate" placeholder="Placa" value={form.placa} onChange={(e) => setForm((p) => ({ ...p, placa: e.target.value.toUpperCase() }))} required />
            <select className="input-corporate" value={form.tipo_vehiculo} onChange={(e) => setForm((p) => ({ ...p, tipo_vehiculo: e.target.value }))}>
              <option value="liviano_particular">Liviano particular</option>
              <option value="moto">Moto</option>
              <option value="liviano_publico">Liviano público</option>
              <option value="pesado">Pesado</option>
            </select>
            <input className="input-corporate" type="date" value={form.fecha} onChange={(e) => setForm((p) => ({ ...p, fecha: e.target.value }))} required />
            <input className="input-corporate" type="time" value={form.hora} onChange={(e) => setForm((p) => ({ ...p, hora: e.target.value }))} required />
            <input className="input-corporate md:col-span-2" placeholder="Observaciones (opcional)" value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
            <div>
              <button type="submit" disabled={createMutation.isLoading} className="btn-corporate-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-60">
                <Plus className="w-4 h-4" />
                {createMutation.isLoading ? 'Guardando...' : 'Crear cita'}
              </button>
            </div>
          </form>
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha</label>
              <input type="date" className="input-corporate" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Estado</label>
              <select className="input-corporate" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                <option value="scheduled">Agendada</option>
                <option value="checked_in">En recepción</option>
                <option value="cancelled">Cancelada</option>
                <option value="no_show">No asistió</option>
              </select>
            </div>
            <div className="ml-auto text-sm text-slate-600">
              <span className="mr-3">Total: <b>{stats.total}</b></span>
              <span className="mr-3">Pendientes: <b>{stats.pendientes}</b></span>
              <span>Recepcionadas: <b>{stats.recepcionados}</b></span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table-corporate w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Cliente</th>
                  <th>Contacto</th>
                  <th>Placa</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(query.data || []).map((row: AppointmentItem) => (
                  <tr key={row.id}>
                    <td>{new Date(row.scheduled_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{row.cliente_nombre}</td>
                    <td>
                      <p>{row.cliente_celular || 'Sin celular'}</p>
                      <p className="text-xs text-slate-500">{row.cliente_email || 'Sin correo'}</p>
                    </td>
                    <td>{row.placa}</td>
                    <td className="capitalize">{row.tipo_vehiculo.replace('_', ' ')}</td>
                    <td>
                      <span className={statusMap[row.status]?.className || 'badge bg-slate-100 text-slate-700'}>
                        {statusMap[row.status]?.label || row.status}
                      </span>
                    </td>
                    <td>
                      {(row.status === 'scheduled' || row.status === 'confirmed') ? (
                        <button
                          onClick={() => checkInMutation.mutate(row.id)}
                          className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 text-sm font-medium"
                          disabled={checkInMutation.isLoading}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Check-in
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">Sin acciones</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!query.isLoading && (query.data || []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-sm text-slate-500 py-8">
                      No hay citas para esta fecha.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}

