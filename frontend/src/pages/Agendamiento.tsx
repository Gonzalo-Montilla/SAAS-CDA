import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  Ban,
  CarFront,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  MessageCircle,
  Plus,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { appointmentsApi, type AppointmentCreatePayload } from '../api/appointments';
import { qualityApi } from '../api/quality';
import apiClient from '../api/client';
import type { AppointmentItem } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/formatNumber';

const statusMap: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Agendada', className: 'badge badge-info' },
  confirmed: { label: 'Confirmada', className: 'badge badge-info' },
  checked_in: { label: 'En recepción', className: 'badge badge-success' },
  cancelled: { label: 'Cancelada', className: 'badge badge-danger' },
  no_show: { label: 'No asistió', className: 'badge bg-slate-100 text-slate-700' },
};

const todayIso = new Date().toISOString().slice(0, 10);
const currentYear = new Date().getFullYear();
const AGENDAMIENTO_PANEL_PREF_KEY = 'agendamiento:show-top-panel';

const sourceLabel = (source: string): string => {
  const s = (source || '').toLowerCase();
  if (s === 'public_link') return 'Link público';
  if (s === 'manual') return 'Equipo (manual)';
  return source || '—';
};

const reminderLabel = (row: AppointmentItem): string => {
  if (!row.cliente_email?.trim()) return 'Sin correo (no hay recordatorio)';
  const st = (row.reminder_status || 'pending').toLowerCase();
  if (st === 'sent') return 'Recordatorio enviado';
  if (st === 'failed') return 'Recordatorio falló';
  if (st === 'skipped') return 'No aplica';
  return 'Recordatorio pendiente';
};

export default function Agendamiento() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState(todayIso);
  const [statusFilter, setStatusFilter] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitIntent, setSubmitIntent] = useState(false);
  const [showAgendamientoPanel, setShowAgendamientoPanel] = useState(() => {
    try {
      const saved = localStorage.getItem(AGENDAMIENTO_PANEL_PREF_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch {
      // Ignorar errores de almacenamiento y usar valor por defecto.
    }
    return true;
  });
  const [anoModelo, setAnoModelo] = useState('');
  const rtmReminderIdRef = useRef<string | null>(null);
  const [form, setForm] = useState<AppointmentCreatePayload>({
    cliente_nombre: '',
    cliente_tipo_documento: 'CC',
    cliente_documento: '',
    cliente_email: '',
    cliente_celular: '',
    placa: '',
    tipo_vehiculo: 'liviano_particular',
    fecha: todayIso,
    hora: '08:00',
    notes: '',
  });

  const anoModeloNumber = Number(anoModelo || 0);
  const canEstimate = Boolean(
    form.tipo_vehiculo &&
      /^\d{4}$/.test(anoModelo) &&
      anoModeloNumber >= 1950 &&
      anoModeloNumber <= currentYear + 1
  );

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

  const estimatedRtmQuery = useQuery({
    queryKey: ['internal-appointment-estimated-rtm', form.tipo_vehiculo, anoModelo],
    enabled: canEstimate,
    queryFn: () => appointmentsApi.getInternalEstimatedRtm(anoModeloNumber, form.tipo_vehiculo),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      appointmentsApi.createInternal({
        ...form,
        ano_modelo: anoModelo || undefined,
      }),
    onSuccess: async () => {
      const reminderId = rtmReminderIdRef.current;
      if (reminderId) {
        try {
          await qualityApi.touchRTMManagement(reminderId, {
            channel: 'agendamiento',
            auto_status: 'agendado',
          });
          queryClient.invalidateQueries({ queryKey: ['quality-rtm-summary'] });
          queryClient.invalidateQueries({ queryKey: ['quality-rtm-reminders'] });
          setFeedback({
            type: 'success',
            message: 'Cita creada correctamente. Vencimiento RTM marcado como agendado.',
          });
        } catch {
          setFeedback({
            type: 'success',
            message: 'Cita creada correctamente. No se pudo actualizar el estado del vencimiento RTM.',
          });
        }
        rtmReminderIdRef.current = null;
      } else {
        setFeedback({ type: 'success', message: 'Cita creada correctamente.' });
      }
      setSubmitIntent(false);
      setForm((prev) => ({
        ...prev,
        cliente_nombre: '',
        cliente_tipo_documento: 'CC',
        cliente_documento: '',
        cliente_email: '',
        cliente_celular: '',
        placa: '',
        notes: '',
      }));
      setAnoModelo('');
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (error: any) => {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || error?.message || 'No fue posible crear la cita' });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'cancelled' | 'no_show' }) =>
      appointmentsApi.updateStatus(id, status),
    onSuccess: (_, vars) => {
      const msg =
        vars.status === 'confirmed'
          ? 'Cita confirmada.'
          : vars.status === 'cancelled'
            ? 'Cita cancelada (el cupo queda libre).'
            : 'Cita marcada como no asistió.';
      setFeedback({ type: 'success', message: msg });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error?.response?.data?.detail || error?.message || 'No fue posible actualizar la cita',
      });
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
          agendamiento_comercial_prefill?: Partial<AppointmentCreatePayload> & {
            rtm_reminder_id?: string;
          };
        }
      | undefined;
    const prefill = state?.agendamiento_comercial_prefill;
    if (!prefill) return;

    rtmReminderIdRef.current = (prefill.rtm_reminder_id || '').trim() || null;

    setForm((prev) => ({
      ...prev,
      cliente_nombre: (prefill.cliente_nombre || prev.cliente_nombre || '').toUpperCase(),
      cliente_tipo_documento: prefill.cliente_tipo_documento || prev.cliente_tipo_documento || 'CC',
      cliente_documento: prefill.cliente_documento || prev.cliente_documento || '',
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

  useEffect(() => {
    try {
      localStorage.setItem(AGENDAMIENTO_PANEL_PREF_KEY, showAgendamientoPanel ? '1' : '0');
    } catch {
      // No bloquear UX por fallas de almacenamiento local.
    }
  }, [showAgendamientoPanel]);

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
  const formErrors = {
    cliente_nombre: !form.cliente_nombre?.trim(),
    placa: !form.placa?.trim(),
    cliente_email: !form.cliente_email?.trim(),
    fecha: !form.fecha?.trim(),
    hora: !form.hora?.trim(),
  };
  const hasFormErrors = Object.values(formErrors).some(Boolean);

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
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <p className="module-hero-title flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-blue-600" />
                Agenda de citas del CDA
              </p>
              <p className="module-hero-subtitle">
                Gestiona citas creadas por link público y por el equipo comercial/recepción.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAgendamientoPanel((prev) => !prev)}
              className="btn-chip inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg self-start"
            >
              {showAgendamientoPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showAgendamientoPanel ? 'Ocultar panel' : 'Mostrar panel'}
            </button>
          </div>

          {showAgendamientoPanel && (
            <>
              <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-800 mb-1">Cómo funciona la agenda</p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                  <li>Franjas cada 30 minutos, de 08:00 a 17:00.</li>
                  <li>Hasta 4 citas activas por franja (agendada o confirmada); cancelar libera cupo.</li>
                  <li>Quién puede usar este módulo: recepción, comercial o administrador del CDA.</li>
                  <li>Correo obligatorio para confirmación de cita y recordatorios automáticos.</li>
                </ul>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 bg-white/90 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">Link público del tenant</p>
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
            </>
          )}
        </section>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {feedback.message}
          </div>
        )}

        <section className="section-card p-6">
          <p className="text-sm font-semibold text-slate-800 mb-1">Nueva cita</p>
          <p className="text-xs text-slate-500 mb-4">
            Registra datos del cliente y define franja de atención. El correo es obligatorio para confirmar y notificar la cita.
          </p>
          <form
            className="grid grid-cols-1 md:grid-cols-4 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFeedback(null);
              setSubmitIntent(true);
              if (hasFormErrors) {
                setFeedback({ type: 'error', message: 'Completa los campos obligatorios marcados con *.' });
                return;
              }
              createMutation.mutate();
            }}
          >
            <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 space-y-3 transition-shadow transition-colors md:hover:shadow-sm md:hover:border-slate-300">
              <p className="text-sm md:text-base font-bold text-slate-900 flex items-center justify-center gap-2 text-center">
                <UserCheck className="w-4.5 h-4.5 text-slate-500" />
                Datos del cliente
              </p>
              <p className="text-[11px] text-slate-400 -mt-1">Los campos con * son obligatorios.</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Nombre cliente <span className="text-red-500">*</span>
                  </label>
                  <input className="input-corporate uppercase" placeholder="Ej: MIGUEL SIERRA" value={form.cliente_nombre} onChange={(e) => setForm((p) => ({ ...p, cliente_nombre: e.target.value.toUpperCase() }))} />
                  {submitIntent && formErrors.cliente_nombre && <p className="text-[11px] text-red-600 mt-1">Nombre cliente es obligatorio.</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tipo documento</label>
                  <select className="input-corporate" value={form.cliente_tipo_documento || 'CC'} onChange={(e) => setForm((p) => ({ ...p, cliente_tipo_documento: e.target.value as 'CC' | 'CE' | 'PA' | 'NIT' }))}>
                    <option value="CC">CC</option>
                    <option value="CE">CE</option>
                    <option value="PA">PA</option>
                    <option value="NIT">NIT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Documento (opcional)</label>
                  <input className="input-corporate" placeholder="Ej: 1052071342" value={form.cliente_documento || ''} onChange={(e) => setForm((p) => ({ ...p, cliente_documento: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Celular (opcional)</label>
                  <input className="input-corporate" placeholder="Ej: 3001234567" value={form.cliente_celular || ''} onChange={(e) => setForm((p) => ({ ...p, cliente_celular: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Correo <span className="text-red-500">*</span>
                  </label>
                  <input className="input-corporate lowercase" required type="email" placeholder="cliente@correo.com" value={form.cliente_email || ''} onChange={(e) => setForm((p) => ({ ...p, cliente_email: e.target.value.toLowerCase() }))} />
                  {submitIntent && formErrors.cliente_email && <p className="text-[11px] text-red-600 mt-1">Correo es obligatorio.</p>}
                </div>
              </div>
            </div>

            <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-white p-4 space-y-3 transition-shadow transition-colors md:hover:shadow-sm md:hover:border-slate-300">
              <p className="text-sm md:text-base font-bold text-slate-900 flex items-center justify-center gap-2 text-center">
                <CarFront className="w-4.5 h-4.5 text-slate-500" />
                Datos del vehículo y valor estimado
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
                    value={anoModelo}
                    onChange={(e) => setAnoModelo(e.target.value)}
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
                    No fue posible estimar en este momento. Puedes crear la cita sin problema.
                  </p>
                )}
                {canEstimate &&
                  !estimatedRtmQuery.isLoading &&
                  !estimatedRtmQuery.isError &&
                  estimatedRtmQuery.data?.disponible &&
                  typeof estimatedRtmQuery.data.valor_total === 'number' && (
                    <p className="text-2xl font-extrabold text-center text-amber-950 tracking-tight mt-2">
                      Valor estimado del servicio: ${formatCurrency(estimatedRtmQuery.data.valor_total)}
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
                  <span>Solo referencia comercial. El valor final se define en recepción.</span>
                </p>
              </div>
            </div>

            <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 space-y-3 transition-shadow transition-colors md:hover:shadow-sm md:hover:border-slate-300">
              <p className="text-sm md:text-base font-bold text-slate-900 flex items-center justify-center gap-2 text-center">
                <CalendarClock className="w-4.5 h-4.5 text-slate-500" />
                Programación de cita
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Fecha <span className="text-red-500">*</span>
                  </label>
                  <input className="input-corporate" type="date" value={form.fecha} onChange={(e) => setForm((p) => ({ ...p, fecha: e.target.value }))} />
                  {submitIntent && formErrors.fecha && <p className="text-[11px] text-red-600 mt-1">Fecha es obligatoria.</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Hora <span className="text-red-500">*</span>
                  </label>
                  <input className="input-corporate" type="time" value={form.hora} onChange={(e) => setForm((p) => ({ ...p, hora: e.target.value }))} />
                  {submitIntent && formErrors.hora && <p className="text-[11px] text-red-600 mt-1">Hora es obligatoria.</p>}
                </div>
                <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <p className="text-xs font-semibold text-blue-800 flex items-center gap-2">
                    <CalendarClock className="w-3.5 h-3.5" />
                    Recomendación
                  </p>
                  <p className="text-[11px] text-blue-700 mt-1">
                    Agenda con 10 minutos de margen para mejorar el flujo en recepción.
                  </p>
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Observaciones (opcional)</label>
                  <input className="input-corporate" placeholder="Ej: llega con 10 min de anticipación" value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="md:col-span-4">
              <button type="submit" disabled={createMutation.isLoading} className="btn-corporate-primary w-full py-3 inline-flex items-center justify-center gap-2 disabled:opacity-60">
                <Plus className="w-4 h-4" />
                {createMutation.isLoading ? 'Guardando...' : 'Crear cita'}
              </button>
            </div>
          </form>
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha</label>
              <input type="date" className="input-corporate" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
              <select className="input-corporate" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                <option value="scheduled">Agendada</option>
                <option value="confirmed">Confirmada</option>
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
            <table className="table-corporate w-full min-w-[1040px]">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Cliente</th>
                  <th>Contacto</th>
                  <th>Placa</th>
                  <th>Tipo</th>
                  <th>Origen</th>
                  <th>Notas</th>
                  <th>Recordatorio</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading && (
                  <tr>
                    <td colSpan={10} className="text-center text-sm text-slate-500 py-8">
                      Cargando citas…
                    </td>
                  </tr>
                )}
                {query.isError && (
                  <tr>
                    <td colSpan={10} className="text-center text-sm text-red-700 bg-red-50/80 py-8 px-4">
                      <p className="font-semibold">No se pudieron cargar las citas.</p>
                      <p className="mt-1 text-red-600">
                        {axios.isAxiosError(query.error) && query.error.response?.status === 401
                          ? 'Sesión no válida o expirada. Cierra sesión y vuelve a ingresar al sistema.'
                          : 'Revisa la conexión o recarga la página.'}
                      </p>
                    </td>
                  </tr>
                )}
                {!query.isLoading &&
                  !query.isError &&
                  (query.data || []).map((row: AppointmentItem) => (
                    <tr key={row.id}>
                      <td>
                        {new Date(row.scheduled_at).toLocaleTimeString('es-CO', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td>{row.cliente_nombre}</td>
                      <td>
                        <p>{row.cliente_celular || 'Sin celular'}</p>
                        <p className="text-xs text-slate-500">{row.cliente_email || 'Sin correo'}</p>
                      </td>
                      <td>{row.placa}</td>
                      <td className="capitalize">{row.tipo_vehiculo.replaceAll('_', ' ')}</td>
                      <td className="text-xs text-slate-600 whitespace-nowrap">{sourceLabel(row.source)}</td>
                      <td className="max-w-[140px] text-xs text-slate-600 truncate" title={row.notes || ''}>
                        {row.notes?.trim() ? row.notes : '—'}
                      </td>
                      <td className="text-xs text-slate-600 max-w-[140px]">{reminderLabel(row)}</td>
                      <td>
                        <span className={statusMap[row.status]?.className || 'badge bg-slate-100 text-slate-700'}>
                          {statusMap[row.status]?.label || row.status}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-col gap-1 items-start">
                          {(row.status === 'scheduled' || row.status === 'confirmed') && (
                            <>
                              {row.status === 'scheduled' && (
                                <button
                                  type="button"
                                  onClick={() => statusMutation.mutate({ id: row.id, status: 'confirmed' })}
                                  className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 text-xs font-medium disabled:opacity-50"
                                  disabled={statusMutation.isLoading || checkInMutation.isLoading}
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  Confirmar
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => checkInMutation.mutate(row.id)}
                                className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 text-xs font-medium disabled:opacity-50"
                                disabled={checkInMutation.isLoading || statusMutation.isLoading}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Check-in
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      '¿Cancelar esta cita? El horario volverá a tener cupo disponible.'
                                    )
                                  ) {
                                    statusMutation.mutate({ id: row.id, status: 'cancelled' });
                                  }
                                }}
                                className="inline-flex items-center gap-1 text-amber-800 hover:text-amber-950 text-xs font-medium disabled:opacity-50"
                                disabled={statusMutation.isLoading || checkInMutation.isLoading}
                              >
                                <Ban className="w-3.5 h-3.5" />
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      '¿Marcar que el cliente no asistió? La cita quedará como «No asistió».'
                                    )
                                  ) {
                                    statusMutation.mutate({ id: row.id, status: 'no_show' });
                                  }
                                }}
                                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 text-xs font-medium disabled:opacity-50"
                                disabled={statusMutation.isLoading || checkInMutation.isLoading}
                              >
                                <UserX className="w-3.5 h-3.5" />
                                No asistió
                              </button>
                            </>
                          )}
                          {!(row.status === 'scheduled' || row.status === 'confirmed') && (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                {!query.isLoading && !query.isError && (query.data || []).length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center text-sm text-slate-500 py-8">
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

