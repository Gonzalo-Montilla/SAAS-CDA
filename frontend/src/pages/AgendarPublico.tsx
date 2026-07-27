import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, CarFront, Info, UserRound } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { appointmentsApi } from '../api/appointments';
import defaultLogo from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';
import { formatCurrency } from '../utils/formatNumber';

type PublicBranding = {
  tenant_slug: string;
  nombre_comercial: string;
  logo_url?: string | null;
  color_primario?: string;
  color_secundario?: string;
};

const todayIso = new Date().toISOString().slice(0, 10);
const currentYear = new Date().getFullYear();
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
  const [submitIntent, setSubmitIntent] = useState(false);
  const [form, setForm] = useState({
    cliente_nombre: '',
    cliente_tipo_documento: 'CC' as 'CC' | 'CE' | 'PA' | 'NIT',
    cliente_documento: '',
    cliente_email: '',
    cliente_celular: '',
    placa: '',
    tipo_vehiculo: 'liviano_particular',
    ano_modelo: '',
    notes: '',
  });

  const anoModeloNumber = Number(form.ano_modelo || 0);
  const canEstimate = Boolean(
    tenantSlug &&
      form.tipo_vehiculo &&
      /^\d{4}$/.test(form.ano_modelo) &&
      anoModeloNumber >= 1950 &&
      anoModeloNumber <= currentYear + 1
  );

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

  const estimatedRtmQuery = useQuery({
    queryKey: ['public-appointment-estimated-rtm', tenantSlug, form.tipo_vehiculo, form.ano_modelo],
    enabled: canEstimate,
    queryFn: () =>
      appointmentsApi.getPublicEstimatedRtm(
        tenantSlug as string,
        anoModeloNumber,
        form.tipo_vehiculo
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      appointmentsApi.createPublic(tenantSlug as string, {
        cliente_nombre: form.cliente_nombre,
        cliente_tipo_documento: form.cliente_tipo_documento,
        cliente_documento: form.cliente_documento,
        cliente_email: form.cliente_email,
        cliente_celular: form.cliente_celular,
        placa: form.placa,
        tipo_vehiculo: form.tipo_vehiculo,
        ano_modelo: form.ano_modelo || undefined,
        notes: form.notes,
        fecha,
        hora,
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Tu cita fue agendada correctamente.' });
      setSubmitIntent(false);
      setForm({
        cliente_nombre: '',
        cliente_tipo_documento: 'CC',
        cliente_documento: '',
        cliente_email: '',
        cliente_celular: '',
        placa: '',
        tipo_vehiculo: 'liviano_particular',
        ano_modelo: '',
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
    return Boolean(tenantSlug && hora && form.cliente_nombre.trim() && form.placa.trim() && form.cliente_email.trim());
  }, [tenantSlug, hora, form.cliente_nombre, form.placa, form.cliente_email]);
  const citaSeleccionadaResumen = useMemo(() => {
    if (!fecha || !hora) return null;
    const [yyyy, mm, dd] = fecha.split('-');
    if (!yyyy || !mm || !dd) return null;
    return `${dd}/${mm}/${yyyy} a las ${hora}`;
  }, [fecha, hora]);
  const formErrors = {
    cliente_nombre: !form.cliente_nombre.trim(),
    placa: !form.placa.trim(),
    cliente_email: !form.cliente_email.trim(),
    hora: !hora.trim(),
  };

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
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha</label>
              <input type="date" className="input-corporate" value={fecha} min={todayIso} onChange={(e) => setFecha(e.target.value)} />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-2">Horarios disponibles</label>
              {availabilityQuery.isLoading && (
                <p className="text-sm text-slate-500 py-2">Cargando horarios…</p>
              )}
              {availabilityQuery.isError && (
                <p className="text-sm text-red-600 py-2">
                  No se pudieron cargar los horarios. Revisa la conexión o intenta otra fecha.
                </p>
              )}
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {!availabilityQuery.isLoading &&
                  (availabilityQuery.data || []).map((slot) => (
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
              {!availabilityQuery.isLoading &&
                !availabilityQuery.isError &&
                (availabilityQuery.data || []).length === 0 && (
                  <p className="text-sm text-slate-500 mt-2">No hay franjas para mostrar.</p>
                )}
            </div>

            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setFeedback(null);
                setSubmitIntent(true);
                if (Object.values(formErrors).some(Boolean)) {
                  setFeedback({ type: 'error', message: 'Completa los campos obligatorios marcados con *.' });
                  return;
                }
                createMutation.mutate();
              }}
            >
              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 space-y-3 transition-shadow transition-colors md:hover:shadow-sm md:hover:border-slate-300">
                <p className="text-sm md:text-base font-bold text-slate-900 flex items-center justify-center gap-2 text-center">
                  <UserRound className="w-4.5 h-4.5 text-slate-500" />
                  Datos del cliente
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Nombre completo <span className="text-red-500">*</span>
                    </label>
                    <input className="input-corporate uppercase" placeholder="Ej: MIGUEL SIERRA" value={form.cliente_nombre} onChange={(e) => setForm((p) => ({ ...p, cliente_nombre: e.target.value.toUpperCase() }))} />
                    {submitIntent && formErrors.cliente_nombre && <p className="text-[11px] text-red-600 mt-1">Nombre completo es obligatorio.</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Tipo documento</label>
                    <select className="input-corporate" value={form.cliente_tipo_documento} onChange={(e) => setForm((p) => ({ ...p, cliente_tipo_documento: e.target.value as 'CC' | 'CE' | 'PA' | 'NIT' }))}>
                      <option value="CC">CC</option>
                      <option value="CE">CE</option>
                      <option value="PA">PA</option>
                      <option value="NIT">NIT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Documento (opcional)</label>
                    <input className="input-corporate" placeholder="Ej: 1052071342" value={form.cliente_documento} onChange={(e) => setForm((p) => ({ ...p, cliente_documento: e.target.value.toUpperCase() }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Celular (opcional)</label>
                    <input className="input-corporate" placeholder="Ej: 3001234567" value={form.cliente_celular} onChange={(e) => setForm((p) => ({ ...p, cliente_celular: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Correo <span className="text-red-500">*</span>
                    </label>
                    <input type="email" required className="input-corporate lowercase" placeholder="cliente@correo.com" value={form.cliente_email} onChange={(e) => setForm((p) => ({ ...p, cliente_email: e.target.value.toLowerCase() }))} />
                    {submitIntent && formErrors.cliente_email && <p className="text-[11px] text-red-600 mt-1">Correo es obligatorio.</p>}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 space-y-3 transition-shadow transition-colors md:hover:shadow-sm md:hover:border-slate-300">
                <p className="text-sm md:text-base font-bold text-slate-900 flex items-center justify-center gap-2 text-center">
                  <CarFront className="w-4.5 h-4.5 text-slate-500" />
                  Datos del vehículo y valor estimado
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Placa <span className="text-red-500">*</span>
                    </label>
                    <input className="input-corporate" placeholder="Ej: XHI56H" value={form.placa} onChange={(e) => setForm((p) => ({ ...p, placa: e.target.value.toUpperCase() }))} />
                    {submitIntent && formErrors.placa && <p className="text-[11px] text-red-600 mt-1">Placa es obligatoria.</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Servicio</label>
                    <select className="input-corporate" value={form.tipo_vehiculo} onChange={(e) => setForm((p) => ({ ...p, tipo_vehiculo: e.target.value }))}>
                      <option value="liviano_particular">Liviano particular</option>
                      <option value="moto">Moto</option>
                      <option value="liviano_publico">Liviano público</option>
                      <option value="pesado_particular">Pesado particular</option>
                      <option value="pesado_publico">Pesado público</option>
                      <option value="preventiva">Preventiva</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Modelo/Año (informativo)</label>
                    <input
                      className="input-corporate"
                      type="number"
                      min={1950}
                      max={currentYear + 1}
                      placeholder="Ej: 2018"
                      value={form.ano_modelo}
                      onChange={(e) => setForm((p) => ({ ...p, ano_modelo: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="w-full md:w-[78%] mx-auto rounded-xl border border-amber-200 bg-amber-100/80 p-2.5 text-center">
                  <p className="text-xs font-semibold text-amber-900">Valor estimado RTM (informativo)</p>
                  {estimatedRtmQuery.isLoading && <p className="text-xs text-amber-800 mt-1">Calculando valor estimado…</p>}
                  {!canEstimate && (
                    <p className="text-xs text-amber-800 mt-1">
                      Selecciona tipo de vehículo y digita un modelo/año válido para estimar.
                    </p>
                  )}
                  {canEstimate && estimatedRtmQuery.isError && (
                    <p className="text-xs text-amber-800 mt-1">
                      No fue posible estimar en este momento. Puedes continuar con el agendamiento sin problema.
                    </p>
                  )}
                  {canEstimate &&
                    !estimatedRtmQuery.isLoading &&
                    !estimatedRtmQuery.isError &&
                    estimatedRtmQuery.data?.disponible &&
                    typeof estimatedRtmQuery.data.valor_total === 'number' && (
                      <p className="text-2xl font-extrabold text-center text-amber-950 tracking-tight mt-2">
                        Tu servicio estimado es: ${formatCurrency(estimatedRtmQuery.data.valor_total)}
                      </p>
                    )}
                  {canEstimate &&
                    !estimatedRtmQuery.isLoading &&
                    !estimatedRtmQuery.isError &&
                    !estimatedRtmQuery.data?.disponible && (
                      <p className="text-xs text-amber-800 mt-1">{estimatedRtmQuery.data?.mensaje}</p>
                    )}
                  <p className="text-[11px] text-amber-700 mt-1 flex items-center justify-center gap-1">
                    <Info className="w-3 h-3 shrink-0" />
                    <span>Este valor es orientativo. El valor definitivo se valida en recepción.</span>
                  </p>
                </div>
              </div>

              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 space-y-3 transition-shadow transition-colors md:hover:shadow-sm md:hover:border-slate-300">
                <p className="text-sm md:text-base font-bold text-slate-900 flex items-center justify-center gap-2 text-center">
                  <CalendarClock className="w-4.5 h-4.5 text-slate-500" />
                  Programación de cita
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Resumen de cita seleccionada</p>
                    {citaSeleccionadaResumen ? (
                      <p className="text-sm font-semibold text-slate-900 mt-1">
                        Cita seleccionada para el día {citaSeleccionadaResumen}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 mt-1">
                        Selecciona un horario disponible para completar tu cita.
                      </p>
                    )}
                    {submitIntent && formErrors.hora && (
                      <p className="text-[11px] text-red-600 mt-2">Selecciona un horario disponible.</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                    <p className="text-xs font-semibold text-blue-800 flex items-center gap-2">
                      <CalendarClock className="w-3.5 h-3.5" />
                      Recomendación
                    </p>
                    <p className="text-[11px] text-blue-700 mt-1">
                      Llega 10 minutos antes con documento y placa para agilizar la recepción.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Comentario (opcional)</label>
                    <textarea className="input-corporate min-h-[80px]" placeholder="Información adicional para la cita" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 -mt-1">
                <p className="text-xs text-slate-500">
                  El correo es obligatorio para confirmar la cita y enviar notificaciones/recordatorios.
                </p>
                {!canSubmit && (
                  <p className="text-[11px] text-slate-400 mt-1">Completa nombre, correo, placa y horario para confirmar la cita.</p>
                )}
              </div>
              <div className="md:col-span-2">
                <button type="submit" disabled={createMutation.isLoading} className="btn-corporate-primary w-full py-3 disabled:opacity-60">
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

