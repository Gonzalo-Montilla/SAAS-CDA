import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Eye,
  Mail,
  MessageCircle,
  MessageSquareHeart,
  RefreshCw,
  Star,
  X,
} from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { qualityApi } from '../api/quality';
import type { QualityInviteItem, RTMReminderItem, Usuario } from '../types';
import { useAuth } from '../contexts/AuthContext';
import type { QualitySurveySubmitPayload } from '../api/quality';
import { useBrand } from '../contexts/BrandContext';
import { useToast } from '../contexts/ToastContext';
import {
  QUALITY_SURVEY_COMMENT_LABEL,
  QUALITY_SURVEY_COMMENT_PLACEHOLDER,
  QUALITY_SURVEY_QUESTIONS,
  emptyQualitySurveyRatings,
  type QualitySurveyRatingKey,
} from '../survey/qualitySurveyConfig';

const canRegisterInPerson = (row: QualityInviteItem) =>
  ['pending', 'no_email', 'sent', 'failed'].includes(row.status);

const statusLabel = (status: string): string => {
  const map: Record<string, string> = {
    pending: 'Pendiente envío',
    sent: 'Enviada',
    responded: 'Respondida',
    expired: 'Vencida',
    failed: 'Fallida',
    no_email: 'Sin correo',
  };
  return map[status] || status;
};

const statusClass = (status: string): string => {
  if (status === 'responded') return 'badge badge-success';
  if (status === 'sent' || status === 'pending') return 'badge badge-info';
  if (status === 'failed' || status === 'expired' || status === 'no_email') return 'badge badge-warning';
  return 'badge bg-slate-100 text-slate-700';
};

const stars = (value?: number | null) => {
  if (!value) return '-';
  return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`;
};

const scoreClass = (value?: number | null): string => {
  if (!value) return 'text-slate-500';
  if (value <= 2) return 'text-red-600';
  if (value === 3) return 'text-amber-600';
  return 'text-emerald-600';
};

const scoreBorderClass = (value?: number | null): string => {
  if (!value) return 'border-l-slate-300';
  if (value <= 2) return 'border-l-red-500';
  if (value === 3) return 'border-l-amber-500';
  return 'border-l-emerald-500';
};

export default function Calidad() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const brand = useBrand();
  const { user } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const puedeElegirSedeCalidad =
    !!tenantUser && (tenantUser.rol === 'administrador' || tenantUser.rol === 'contador');
  const [activeTab, setActiveTab] = useState<'encuestas' | 'vencimientos'>('encuestas');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [calidadSedeScope, setCalidadSedeScope] = useState<'todas' | 'sucursal'>('todas');
  const [calidadSedeId, setCalidadSedeId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [encuestasPagina, setEncuestasPagina] = useState(1);
  const [encuestasPorPagina, setEncuestasPorPagina] = useState(25);
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);
  const [manualInviteId, setManualInviteId] = useState<string | null>(null);
  const [inPersonRatings, setInPersonRatings] = useState<Record<QualitySurveyRatingKey, number>>(
    emptyQualitySurveyRatings
  );
  const [inPersonComentario, setInPersonComentario] = useState('');

  useEffect(() => {
    if (!manualInviteId) return;
    setInPersonRatings(emptyQualitySurveyRatings());
    setInPersonComentario('');
  }, [manualInviteId]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const [rtmWindow, setRtmWindow] = useState<8 | 15 | 30>(30);
  const [rtmStatusFilter, setRtmStatusFilter] = useState<string>('todos');
  const [rtmSearch, setRtmSearch] = useState('');
  const [rtmNotesDraft, setRtmNotesDraft] = useState<Record<string, string>>({});

  const calidadSedeApiParam = useMemo(() => {
    if (!puedeElegirSedeCalidad) return undefined;
    if (calidadSedeScope === 'todas') return undefined;
    return calidadSedeId.trim() || undefined;
  }, [puedeElegirSedeCalidad, calidadSedeScope, calidadSedeId]);

  useEffect(() => {
    setEncuestasPagina(1);
  }, [searchDebounced, statusFilter, calidadSedeApiParam]);

  const summaryQuery = useQuery({
    queryKey: ['quality-summary', calidadSedeApiParam],
    queryFn: () =>
      qualityApi.getSummary(calidadSedeApiParam ? { sucursal_id: calidadSedeApiParam } : undefined),
    refetchInterval: 30000,
  });

  const invitesQuery = useQuery({
    queryKey: [
      'quality-invites',
      statusFilter,
      calidadSedeApiParam,
      encuestasPagina,
      encuestasPorPagina,
      searchDebounced,
    ],
    queryFn: () =>
      qualityApi.listInvites({
        statusFilter: statusFilter === 'todos' ? undefined : statusFilter,
        sucursal_id: calidadSedeApiParam,
        search: searchDebounced || undefined,
        skip: (encuestasPagina - 1) * encuestasPorPagina,
        limit: encuestasPorPagina,
      }),
    refetchInterval: 30000,
  });

  const processMutation = useMutation({
    mutationFn: qualityApi.processPending,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-invites'] });
    },
  });

  const detailQuery = useQuery({
    queryKey: ['quality-invite-detail', selectedInviteId],
    queryFn: () => qualityApi.getInviteDetail(selectedInviteId || ''),
    enabled: !!selectedInviteId,
  });

  const manualDetailQuery = useQuery({
    queryKey: ['quality-invite-detail', manualInviteId],
    queryFn: () => qualityApi.getInviteDetail(manualInviteId || ''),
    enabled: !!manualInviteId,
  });

  const inPersonMutation = useMutation({
    mutationFn: ({ inviteId, payload }: { inviteId: string; payload: QualitySurveySubmitPayload }) =>
      qualityApi.submitInPersonSurvey(inviteId, payload),
    onSuccess: (data) => {
      showToast('success', 'Encuesta registrada', data.message);
      setManualInviteId(null);
      setInPersonRatings(emptyQualitySurveyRatings());
      setInPersonComentario('');
      queryClient.invalidateQueries({ queryKey: ['quality-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-invites'] });
    },
    onError: (error: unknown) => {
      let message = 'No fue posible guardar la encuesta.';
      if (axios.isAxiosError(error)) {
        const d = error.response?.data?.detail;
        if (typeof d === 'string') message = d;
      } else if (error instanceof Error) {
        message = error.message;
      }
      showToast('error', 'Error', message);
    },
  });

  const rtmSummaryQuery = useQuery({
    queryKey: ['quality-rtm-summary'],
    queryFn: qualityApi.getRTMSummary,
    refetchInterval: 30000,
  });

  const rtmRemindersQuery = useQuery({
    queryKey: ['quality-rtm-reminders', rtmWindow, rtmStatusFilter, rtmSearch],
    queryFn: () =>
      qualityApi.listRTMReminders({
        days_window: rtmWindow,
        commercial_status: rtmStatusFilter === 'todos' ? undefined : rtmStatusFilter,
        search: rtmSearch.trim() || undefined,
      }),
    refetchInterval: 30000,
  });

  const processRTMMutation = useMutation({
    mutationFn: qualityApi.processRTMReminders,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-reminders'] });
    },
  });

  const sendRTMNowMutation = useMutation({
    mutationFn: (reminderId: string) => qualityApi.sendRTMReminderNow(reminderId),
    onSuccess: (result) => {
      showToast(
        result.sent ? 'success' : 'error',
        result.sent ? 'Correo enviado' : 'No se pudo enviar el correo',
        result.message
      );
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-reminders'] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'No fue posible enviar el recordatorio.';
      showToast('error', 'Error enviando recordatorio', message);
    },
  });

  const updateRTMMutation = useMutation({
    mutationFn: ({ reminderId, payload }: { reminderId: string; payload: { commercial_status: string; commercial_notes?: string } }) =>
      qualityApi.updateRTMReminder(reminderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-reminders'] });
    },
  });

  const touchRTMManagementMutation = useMutation({
    mutationFn: ({ reminderId, payload }: { reminderId: string; payload: { channel: string; auto_status?: string } }) =>
      qualityApi.touchRTMManagement(reminderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-reminders'] });
    },
  });

  const rows = invitesQuery.data?.items ?? [];
  const totalEncuestas = invitesQuery.data?.total ?? 0;
  const totalPaginasEncuestas = Math.max(1, Math.ceil(totalEncuestas / encuestasPorPagina) || 1);
  const encuestaDesde =
    totalEncuestas === 0 ? 0 : (encuestasPagina - 1) * encuestasPorPagina + 1;
  const encuestaHasta = Math.min(encuestasPagina * encuestasPorPagina, totalEncuestas);

  useEffect(() => {
    if (encuestasPagina > totalPaginasEncuestas) {
      setEncuestasPagina(totalPaginasEncuestas);
    }
  }, [encuestasPagina, totalPaginasEncuestas]);

  const rtmRows = useMemo(() => rtmRemindersQuery.data || [], [rtmRemindersQuery.data]);

  const inPersonAllRated = useMemo(
    () => QUALITY_SURVEY_QUESTIONS.every((q) => inPersonRatings[q.key] >= 1 && inPersonRatings[q.key] <= 5),
    [inPersonRatings]
  );

  const urgencyClass = (days: number) => {
    if (days <= 8) return 'badge bg-red-100 text-red-700';
    if (days <= 15) return 'badge bg-amber-100 text-amber-800';
    return 'badge bg-emerald-100 text-emerald-700';
  };

  const statusCommercialClass = (value: string) => {
    const normalized = (value || '').toLowerCase();
    if (normalized === 'agendado') return 'badge badge-success';
    if (normalized === 'interesado' || normalized === 'contactado') return 'badge badge-info';
    if (normalized === 'no responde' || normalized === 'descartado') return 'badge bg-amber-100 text-amber-800';
    return 'badge bg-slate-100 text-slate-700';
  };

  const statusCommercialLabel = (value: string) => value || 'pendiente';

  const openWhatsApp = (row: RTMReminderItem) => {
    const phone = (row.cliente_celular || '').replace(/\D/g, '');
    const nombreCda = (row.nombre_cda || 'CDASOFT').trim();
    if (!phone) {
      showToast('warning', 'Sin celular', 'Este cliente no tiene celular válido para WhatsApp.');
      return;
    }
    const message = encodeURIComponent(
      `Hola ${row.cliente_nombre}, te escribimos de ${nombreCda} para recordarte la próxima RTM de tu vehículo ${row.placa}. ¿Te gustaría agendar tu cita? ${row.agendamiento_url || ''}`
    );
    window.open(`https://wa.me/57${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
    touchRTMManagementMutation.mutate({
      reminderId: row.id,
      payload: { channel: 'whatsapp', auto_status: row.commercial_status === 'pendiente' ? 'contactado' : undefined },
    });
  };

  return (
    <Layout title="Calidad">
      <div className="space-y-6">
        <section className="module-hero">
          <p className="module-hero-title flex items-center gap-2">
            <MessageSquareHeart className="w-5 h-5 text-violet-600" />
            Gestión de calidad
          </p>
          <p className="module-hero-subtitle">
            Monitorea la satisfacción de clientes con encuestas de experiencia post-servicio.
          </p>
        </section>

        <section className="section-card p-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('encuestas')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'encuestas' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Encuestas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vencimientos')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'vencimientos' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Próximos vencimientos RTM
            </button>
          </div>
        </section>

        {activeTab === 'encuestas' && (
          <>
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Invitaciones</p>
            <p className="text-2xl font-bold text-slate-900">{summaryQuery.data?.total_invitaciones || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Respondidas</p>
            <p className="text-2xl font-bold text-emerald-700">{summaryQuery.data?.total_respondidas || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Pendientes</p>
            <p className="text-2xl font-bold text-cyan-700">{summaryQuery.data?.total_pendientes || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Promedio general</p>
            <p className="text-2xl font-bold text-violet-700">{summaryQuery.data?.promedio_general?.toFixed(2) || '0.00'}</p>
          </div>
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm font-semibold text-slate-800">Bandeja de encuestas</p>
            <button
              type="button"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isLoading}
              className="btn-corporate-primary px-4 inline-flex items-center gap-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${processMutation.isLoading ? 'animate-spin' : ''}`} />
              {processMutation.isLoading ? 'Procesando...' : 'Procesar envíos pendientes'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3 mb-4">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="input-corporate"
              placeholder="Buscar por cliente, placa, correo o sede"
            />
            <select
              value={String(encuestasPorPagina)}
              onChange={(e) => {
                setEncuestasPorPagina(Number(e.target.value));
                setEncuestasPagina(1);
              }}
              className="input-corporate"
              aria-label="Registros por página"
            >
              <option value={25}>25 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-corporate"
            >
              <option value="todos">Todos los estados</option>
              <option value="pending">Pendiente envío</option>
              <option value="sent">Enviada</option>
              <option value="responded">Respondida</option>
              <option value="failed">Fallida</option>
              <option value="expired">Vencida</option>
              <option value="no_email">Sin correo</option>
            </select>
            {puedeElegirSedeCalidad && (
              <select
                className="input-corporate"
                aria-label="Filtrar por sede"
                value={calidadSedeScope === 'sucursal' && calidadSedeId ? `s:${calidadSedeId}` : 'todas'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'todas') {
                    setCalidadSedeScope('todas');
                    setCalidadSedeId('');
                  } else if (v.startsWith('s:')) {
                    setCalidadSedeScope('sucursal');
                    setCalidadSedeId(v.slice(2));
                  }
                }}
              >
                <option value="todas">Todas las sedes</option>
                {(tenantUser?.sucursales || []).map((s) => (
                  <option key={s.id} value={`s:${s.id}`}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            )}
            <div className="text-xs text-slate-500 flex items-center md:col-span-2 xl:col-span-1 2xl:col-span-1">
              Tasa de respuesta: <span className="font-semibold ml-1">{summaryQuery.data?.tasa_respuesta || 0}%</span>
            </div>
          </div>

          <div className="table-shell">
            <table className="table-enterprise">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Sede</th>
                  <th>Celular</th>
                  <th>Placa</th>
                  <th>Tipo</th>
                  <th>Exp. global</th>
                  <th>Comentario</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitesQuery.isLoading && (
                  <tr>
                    <td colSpan={10} className="text-sm text-slate-500">Cargando encuestas...</td>
                  </tr>
                )}
                {!invitesQuery.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-sm text-slate-500">No hay resultados para los filtros actuales.</td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.cliente_nombre}</td>
                    <td className="text-slate-700 max-w-[160px] truncate" title={row.sucursal_nombre || ''}>
                      {row.sucursal_nombre || '—'}
                    </td>
                    <td>{row.cliente_celular || '-'}</td>
                    <td className="font-semibold text-slate-900">{row.placa}</td>
                    <td className="capitalize">{row.tipo_vehiculo.replaceAll('_', ' ')}</td>
                    <td>
                      {row.experiencia_global ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                          <Star className="w-4 h-4 fill-current" />
                          {row.experiencia_global} ({stars(row.experiencia_global)})
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="max-w-[260px] truncate" title={row.comentario || ''}>{row.comentario || '-'}</td>
                    <td>
                      <span className={statusClass(row.status)}>{statusLabel(row.status)}</span>
                      {row.status === 'pending' && row.cliente_email && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Correo programado: {new Date(row.scheduled_send_at).toLocaleString()}
                        </p>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {canRegisterInPerson(row) && (
                          <button
                            type="button"
                            onClick={() => setManualInviteId(row.id)}
                            className="btn-chip px-3 py-1 text-xs inline-flex items-center gap-1"
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                            En mostrador
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedInviteId(row.id)}
                          className="btn-chip px-3 py-1 text-xs inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Ver detalle
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-600 order-2 sm:order-1">
              {totalEncuestas === 0 ? (
                'Sin resultados en esta vista.'
              ) : (
                <>
                  Mostrando <span className="font-semibold text-slate-800">{encuestaDesde}</span>–
                  <span className="font-semibold text-slate-800">{encuestaHasta}</span> de{' '}
                  <span className="font-semibold text-slate-800">{totalEncuestas}</span>
                  <span className="text-slate-500 ml-2">
                    · Página {encuestasPagina} de {totalPaginasEncuestas}
                  </span>
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center justify-center sm:justify-end gap-1 order-1 sm:order-2">
              <button
                type="button"
                className="btn-corporate-muted p-2 rounded-lg disabled:opacity-40"
                disabled={encuestasPagina <= 1 || invitesQuery.isLoading}
                onClick={() => setEncuestasPagina(1)}
                title="Primera página"
                aria-label="Primera página"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="btn-corporate-muted p-2 rounded-lg disabled:opacity-40"
                disabled={encuestasPagina <= 1 || invitesQuery.isLoading}
                onClick={() => setEncuestasPagina((p) => Math.max(1, p - 1))}
                title="Anterior"
                aria-label="Página anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="btn-corporate-muted p-2 rounded-lg disabled:opacity-40"
                disabled={encuestasPagina >= totalPaginasEncuestas || invitesQuery.isLoading}
                onClick={() => setEncuestasPagina((p) => Math.min(totalPaginasEncuestas, p + 1))}
                title="Siguiente"
                aria-label="Página siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="btn-corporate-muted p-2 rounded-lg disabled:opacity-40"
                disabled={encuestasPagina >= totalPaginasEncuestas || invitesQuery.isLoading}
                onClick={() => setEncuestasPagina(totalPaginasEncuestas)}
                title="Última página"
                aria-label="Última página"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
          </>
        )}

        {activeTab === 'vencimientos' && (
          <>
            <section className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">Total próximos</p>
                <p className="text-2xl font-bold text-slate-900">{rtmSummaryQuery.data?.total_upcoming || 0}</p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">30 días</p>
                <p className="text-2xl font-bold text-emerald-700">{rtmSummaryQuery.data?.due_30d || 0}</p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">15 días</p>
                <p className="text-2xl font-bold text-amber-700">{rtmSummaryQuery.data?.due_15d || 0}</p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">8 días</p>
                <p className="text-2xl font-bold text-red-700">{rtmSummaryQuery.data?.due_8d || 0}</p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">Agendados</p>
                <p className="text-2xl font-bold text-violet-700">{rtmSummaryQuery.data?.agendados || 0}</p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">Conversión agendado</p>
                <p className="text-2xl font-bold text-indigo-700">{rtmSummaryQuery.data?.conversion_agendado_pct || 0}%</p>
              </div>
            </section>

            <section className="section-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <CalendarCheck2 className="w-4 h-4 text-violet-600" />
                  Gestión comercial de vencimientos
                </p>
                <button
                  type="button"
                  onClick={() => processRTMMutation.mutate()}
                  disabled={processRTMMutation.isLoading}
                  className="btn-corporate-primary px-4 inline-flex items-center gap-2 disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${processRTMMutation.isLoading ? 'animate-spin' : ''}`} />
                  {processRTMMutation.isLoading ? 'Procesando...' : 'Procesar recordatorios RTM'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <select value={rtmWindow} onChange={(e) => setRtmWindow(Number(e.target.value) as 8 | 15 | 30)} className="input-corporate">
                  <option value={30}>Ventana 30 días</option>
                  <option value={15}>Ventana 15 días</option>
                  <option value={8}>Ventana 8 días</option>
                </select>
                <select value={rtmStatusFilter} onChange={(e) => setRtmStatusFilter(e.target.value)} className="input-corporate">
                  <option value="todos">Todos los estados comerciales</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="contactado">Contactado</option>
                  <option value="interesado">Interesado</option>
                  <option value="agendado">Agendado</option>
                  <option value="no responde">No responde</option>
                  <option value="descartado">Descartado</option>
                </select>
                <input
                  type="text"
                  value={rtmSearch}
                  onChange={(e) => setRtmSearch(e.target.value)}
                  className="input-corporate"
                  placeholder="Buscar por cliente, placa, celular o email"
                />
                <div className="text-xs text-slate-500 flex items-center">
                  Sin gestionar: <span className="font-semibold ml-1">{rtmSummaryQuery.data?.no_management || 0}</span>
                  <span className="mx-2">|</span>
                  Gestionados: <span className="font-semibold ml-1">{rtmSummaryQuery.data?.managed_count || 0}</span>
                </div>
              </div>

              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Placa</th>
                      <th>Celular</th>
                      <th>Email</th>
                      <th>Vencimiento</th>
                      <th>Días</th>
                      <th>Estado comercial</th>
                      <th>Gestiones</th>
                      <th>Nota</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rtmRemindersQuery.isLoading && (
                      <tr><td colSpan={10} className="text-sm text-slate-500">Cargando vencimientos...</td></tr>
                    )}
                    {!rtmRemindersQuery.isLoading && rtmRows.length === 0 && (
                      <tr><td colSpan={10} className="text-sm text-slate-500">No hay vencimientos en esta ventana.</td></tr>
                    )}
                    {rtmRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.cliente_nombre}</td>
                        <td className="font-semibold text-slate-900">{row.placa}</td>
                        <td>{row.cliente_celular || '-'}</td>
                        <td className="max-w-[220px] truncate" title={row.cliente_email || ''}>{row.cliente_email || '-'}</td>
                        <td>{new Date(row.next_due_at).toLocaleDateString()}</td>
                        <td><span className={urgencyClass(row.days_until_due)}>{row.days_until_due} días</span></td>
                        <td>
                          <select
                            className="input-corporate !py-1 !h-8 text-xs"
                            value={row.commercial_status || 'pendiente'}
                            onChange={(e) =>
                              updateRTMMutation.mutate({
                                reminderId: row.id,
                                payload: {
                                  commercial_status: e.target.value,
                                  commercial_notes: rtmNotesDraft[row.id] ?? row.commercial_notes ?? '',
                                },
                              })
                            }
                          >
                            <option value="pendiente">Pendiente</option>
                            <option value="contactado">Contactado</option>
                            <option value="interesado">Interesado</option>
                            <option value="agendado">Agendado</option>
                            <option value="no responde">No responde</option>
                            <option value="descartado">Descartado</option>
                          </select>
                          <div className="mt-1">
                            <span className={statusCommercialClass(row.commercial_status)}>{statusCommercialLabel(row.commercial_status)}</span>
                          </div>
                        </td>
                        <td className="text-xs text-slate-600">
                          <p className="font-semibold text-slate-800">{row.management_count || 0}</p>
                          <p>{row.last_management_channel || '-'}</p>
                        </td>
                        <td className="min-w-[220px]">
                          <input
                            type="text"
                            className="input-corporate !py-1 !h-8 text-xs"
                            value={rtmNotesDraft[row.id] ?? row.commercial_notes ?? ''}
                            onChange={(e) => setRtmNotesDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                            onBlur={() =>
                              updateRTMMutation.mutate({
                                reminderId: row.id,
                                payload: {
                                  commercial_status: row.commercial_status || 'pendiente',
                                  commercial_notes: rtmNotesDraft[row.id] ?? row.commercial_notes ?? '',
                                },
                              })
                            }
                            placeholder="Nota comercial breve"
                          />
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                navigate('/agendamiento', {
                                  state: {
                                    agendamiento_comercial_prefill: {
                                      cliente_nombre: row.cliente_nombre,
                                      cliente_email: row.cliente_email || '',
                                      cliente_celular: row.cliente_celular || '',
                                      placa: row.placa,
                                      tipo_vehiculo: row.tipo_vehiculo,
                                      notes: `Seguimiento comercial por vencimiento RTM (${row.days_until_due} días restantes).`,
                                    },
                                  },
                                });
                                touchRTMManagementMutation.mutate({
                                  reminderId: row.id,
                                  payload: { channel: 'agendamiento', auto_status: row.commercial_status === 'pendiente' ? 'interesado' : undefined },
                                });
                                showToast('success', 'Cliente precargado', 'Abriendo Agendamiento con datos del cliente.');
                              }}
                              className="btn-chip px-2 py-1 rounded-md text-xs font-semibold"
                            >
                              Agendar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                openWhatsApp(row);
                                showToast('success', 'WhatsApp abierto', 'Se registró la gestión comercial por WhatsApp.');
                              }}
                              className="btn-chip px-2 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              WhatsApp
                            </button>
                            <button
                              type="button"
                              onClick={() => sendRTMNowMutation.mutate(row.id)}
                              disabled={sendRTMNowMutation.isLoading}
                              className="btn-chip px-2 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-60"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              {sendRTMNowMutation.isLoading ? 'Enviando...' : 'Email'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {manualInviteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-3xl section-card p-6 md:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setManualInviteId(null)}
              className="modal-close-btn absolute top-4 right-4 z-10 inline-flex items-center justify-center"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>

            <div className="text-center mb-6 pr-10">
              {brand.logoSrc && (
                <img
                  src={brand.logoSrc}
                  alt={brand.nombreComercial}
                  className="h-20 mx-auto mb-3 object-contain"
                />
              )}
              <h1 className="text-2xl font-bold text-slate-900">Encuesta en mostrador</h1>
              {manualDetailQuery.data && (
                <p className="text-sm text-slate-600 mt-1">
                  {brand.nombreComercial} - Cliente: {manualDetailQuery.data.cliente_nombre} - Placa:{' '}
                  {manualDetailQuery.data.placa}
                </p>
              )}
              {!manualDetailQuery.data && !manualDetailQuery.isLoading && (
                <p className="text-sm text-slate-600 mt-1">{brand.nombreComercial}</p>
              )}
            </div>

            <div className="space-y-4">
              {manualDetailQuery.isLoading && <p className="text-sm text-slate-600 text-center">Cargando encuesta...</p>}
              {manualDetailQuery.isError && (
                <p className="text-sm text-red-600 text-center">No fue posible cargar esta encuesta.</p>
              )}
              {manualDetailQuery.data && !canRegisterInPerson(manualDetailQuery.data) && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Esta encuesta ya no admite registro presencial (estado actual: {statusLabel(manualDetailQuery.data.status)}).
                </p>
              )}
              {manualDetailQuery.data && canRegisterInPerson(manualDetailQuery.data) && (
                <>
                  {manualDetailQuery.data.status === 'pending' && manualDetailQuery.data.cliente_email && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 text-center">
                      Envío de correo programado:{' '}
                      {new Date(manualDetailQuery.data.scheduled_send_at).toLocaleString()}
                    </div>
                  )}
                  {!manualDetailQuery.data.cliente_email && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 text-center">
                      Cliente sin correo registrado.
                    </div>
                  )}

                  <div className="space-y-5">
                    {QUALITY_SURVEY_QUESTIONS.map((q) => (
                      <div key={q.key}>
                        <p className="text-sm font-medium text-slate-800 mb-2">{q.label}</p>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setInPersonRatings((prev) => ({ ...prev, [q.key]: value }))}
                              className="p-1 rounded-md hover:bg-amber-50"
                            >
                              <Star
                                className={`w-7 h-7 ${
                                  inPersonRatings[q.key] >= value ? 'text-amber-500 fill-current' : 'text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-800 mb-2">{QUALITY_SURVEY_COMMENT_LABEL}</p>
                    <textarea
                      value={inPersonComentario}
                      onChange={(e) => setInPersonComentario(e.target.value)}
                      className="input-corporate min-h-[120px]"
                      placeholder={QUALITY_SURVEY_COMMENT_PLACEHOLDER}
                      maxLength={2000}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={!inPersonAllRated || inPersonMutation.isLoading}
                    onClick={() =>
                      inPersonMutation.mutate({
                        inviteId: manualInviteId,
                        payload: {
                          ...inPersonRatings,
                          comentario: inPersonComentario.trim() || undefined,
                        },
                      })
                    }
                    className="w-full text-white font-semibold py-3 rounded-xl disabled:opacity-60"
                    style={{ backgroundColor: brand.colorPrimario }}
                  >
                    {inPersonMutation.isLoading ? 'Enviando...' : 'Enviar encuesta'}
                  </button>
                  <p className="text-xs text-slate-500 text-center">
                    Si guarda aquí la encuesta, no se enviará el correo automático.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedInviteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className={`w-full max-w-3xl modal-panel rounded-2xl border border-slate-200 border-l-8 ${scoreBorderClass(detailQuery.data?.experiencia_global)} bg-gradient-to-b from-white to-slate-50 shadow-2xl`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white/95 backdrop-blur-sm">
              <div>
                <p className="text-base font-semibold text-slate-900">Detalle de encuesta</p>
                <p className="text-xs text-slate-500 mt-0.5">Vista completa de experiencia del cliente</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInviteId(null)}
                className="modal-close-btn inline-flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {detailQuery.isLoading && <p className="text-sm text-slate-500">Cargando detalle...</p>}
              {detailQuery.isError && (
                <p className="text-sm text-red-600">No fue posible cargar el detalle de esta encuesta.</p>
              )}

              {detailQuery.data && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Cliente</p>
                      <p className="font-semibold text-slate-900">{detailQuery.data.cliente_nombre}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Celular: <span className="font-medium">{detailQuery.data.cliente_celular || '-'}</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Sede del servicio</p>
                      <p className="font-semibold text-slate-900">{detailQuery.data.sucursal_nombre || '—'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Servicio</p>
                      <p className="font-semibold text-slate-900">{detailQuery.data.placa} - {detailQuery.data.tipo_vehiculo}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Estado:{' '}
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClass(detailQuery.data.status)}`}>
                          {statusLabel(detailQuery.data.status)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2 max-h-[50vh] overflow-y-auto">
                    <p className="text-sm font-semibold text-slate-800 mb-2">Calificaciones</p>
                    {QUALITY_SURVEY_QUESTIONS.map((q) => {
                      const value = detailQuery.data[q.key];
                      return (
                        <p key={q.key} className="text-sm text-slate-700">
                          <span className="text-slate-600">{q.label}</span>{' '}
                          <span className={`font-semibold ${scoreClass(value)}`}>{stars(value)}</span>
                        </p>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-800 mb-2">Comentario del cliente</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">
                      {detailQuery.data.comentario || 'Sin comentario.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Recepcionista</p>
                      <p className="text-sm font-medium text-slate-800">{detailQuery.data.recepcionista_nombre || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Cajero</p>
                      <p className="text-sm font-medium text-slate-800">{detailQuery.data.cajero_nombre || '-'}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

