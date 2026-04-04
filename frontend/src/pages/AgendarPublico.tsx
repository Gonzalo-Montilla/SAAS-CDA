import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { appointmentsApi } from '../api/appointments';
import defaultLogo from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

type PublicBranding = {
  tenant_slug: string;
  nombre_comercial: string;
  logo_url?: string | null;
  color_primario?: string;
  color_secundario?: string;
};

const todayIso = new Date().toISOString().slice(0, 10);
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const BACKEND_BASE_URL = API_URL.replace(/\/api\/v1\/?$/, '');

function resolvePublicLogoUrl(rawLogoUrl?: string | null): string {
  const value = (rawLogoUrl || '').trim();
  if (!value) return defaultLogo;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('/')) return `${BACKEND_BASE_URL}${value}`;
  return `${BACKEND_BASE_URL}/${value.replace(/^\/+/, '')}`;
}

export default function AgendarPublico() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [logoError, setLogoError] = useState(false);
  const [fecha, setFecha] = useState(todayIso);
  const [hora, setHora] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState({
    cliente_nombre: '',
    cliente_email: '',
    cliente_celular: '',
    placa: '',
    tipo_vehiculo: 'liviano_particular',
    notes: '',
  });

  const brandingQuery = useQuery({
    queryKey: ['public-branding', tenantSlug],
    enabled: Boolean(tenantSlug),
    queryFn: async () => {
      const response = await fetch(`${API_URL}/config/public-tenant-branding/${tenantSlug}`);
      if (!response.ok) throw new Error('No fue posible cargar la marca del CDA');
      return (await response.json()) as PublicBranding;
    },
  });

  const availabilityQuery = useQuery({
    queryKey: ['appointment-availability', tenantSlug, fecha],
    enabled: Boolean(tenantSlug),
    queryFn: () => appointmentsApi.getPublicAvailability(tenantSlug as string, fecha),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      appointmentsApi.createPublic(tenantSlug as string, {
        ...form,
        fecha,
        hora,
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Tu cita fue agendada correctamente.' });
      setForm({
        cliente_nombre: '',
        cliente_email: '',
        cliente_celular: '',
        placa: '',
        tipo_vehiculo: 'liviano_particular',
        notes: '',
      });
      setHora('');
      availabilityQuery.refetch();
    },
    onError: (error: any) => {
      setFeedback({ type: 'error', message: error?.message || 'No fue posible agendar la cita' });
    },
  });

  const brand = brandingQuery.data;
  const primary = brand?.color_primario || '#2563eb';
  const secondary = brand?.color_secundario || '#0f172a';
  const logoSrc = useMemo(() => resolvePublicLogoUrl(brand?.logo_url), [brand?.logo_url]);

  const canSubmit = useMemo(() => {
    return Boolean(tenantSlug && hora && form.cliente_nombre.trim() && form.placa.trim());
  }, [tenantSlug, hora, form.cliente_nombre, form.placa]);

  return (
    <div className="corporate-shell px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="section-card overflow-hidden">
          <div className="p-6 text-white" style={{ background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)` }}>
            {!logoError && (
              <img
                src={logoSrc}
                alt={`Logo ${brand?.nombre_comercial || 'CDA'}`}
                className="h-14 w-auto max-w-[220px] object-contain rounded-md bg-white/90 p-1 mb-3"
                onError={() => setLogoError(true)}
              />
            )}
            <p className="text-xs uppercase tracking-wide opacity-90">Agendamiento en línea</p>
            <h1 className="text-2xl font-bold mt-1">{brand?.nombre_comercial || 'CDA'}</h1>
            <p className="text-sm opacity-90 mt-2">Selecciona fecha y hora para tu visita de revisión.</p>
          </div>

          <div className="p-6 space-y-5">
            {feedback && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {feedback.message}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha</label>
              <input type="date" className="input-corporate" value={fecha} min={todayIso} onChange={(e) => setFecha(e.target.value)} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Horarios disponibles</label>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {(availabilityQuery.data || []).map((slot) => (
                  <button
                    key={slot.hora}
                    type="button"
                    disabled={!slot.disponible}
                    onClick={() => setHora(slot.hora)}
                    className={`px-2 py-2 rounded-lg border text-sm transition-colors ${
                      hora === slot.hora
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : slot.disponible
                        ? 'border-slate-200 hover:border-blue-300'
                        : 'border-slate-100 bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <p className="font-semibold">{slot.hora}</p>
                    <p className="text-[10px]">{slot.disponible ? `${slot.cupos_disponibles} cupos` : 'Lleno'}</p>
                  </button>
                ))}
              </div>
            </div>

            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setFeedback(null);
                createMutation.mutate();
              }}
            >
              <input className="input-corporate uppercase" placeholder="Nombre completo" value={form.cliente_nombre} onChange={(e) => setForm((p) => ({ ...p, cliente_nombre: e.target.value.toUpperCase() }))} required />
              <input className="input-corporate" placeholder="Placa" value={form.placa} onChange={(e) => setForm((p) => ({ ...p, placa: e.target.value.toUpperCase() }))} required />
              <input className="input-corporate" placeholder="Celular (opcional)" value={form.cliente_celular} onChange={(e) => setForm((p) => ({ ...p, cliente_celular: e.target.value }))} />
              <input type="email" className="input-corporate lowercase" placeholder="Correo (opcional)" value={form.cliente_email} onChange={(e) => setForm((p) => ({ ...p, cliente_email: e.target.value.toLowerCase() }))} />
              <select className="input-corporate" value={form.tipo_vehiculo} onChange={(e) => setForm((p) => ({ ...p, tipo_vehiculo: e.target.value }))}>
                <option value="liviano_particular">Liviano particular</option>
                <option value="moto">Moto</option>
                <option value="liviano_publico">Liviano público</option>
                <option value="pesado">Pesado</option>
              </select>
              <input className="input-corporate" value={hora} readOnly placeholder="Selecciona horario" />
              <textarea className="input-corporate md:col-span-2 min-h-[80px]" placeholder="Comentario (opcional)" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              <div className="md:col-span-2">
                <button type="submit" disabled={!canSubmit || createMutation.isLoading} className="btn-corporate-primary w-full disabled:opacity-60">
                  {createMutation.isLoading ? 'Agendando...' : 'Confirmar cita'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

