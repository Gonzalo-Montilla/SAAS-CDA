import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  Mail,
  MessageCircle,
  MessageSquareHeart,
  RefreshCw,
  RotateCcw,
  Trash2,
  Star,
  AlertTriangle,
  Store,
  X,
} from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { qualityApi } from '../api/quality';
import type { QualityInviteItem, QualitySatisfactionItem, RTMReminderItem, Usuario } from '../types';
import { useAuth } from '../contexts/AuthContext';
import type {
  QualitySurveySubmitPayload,
  MarkCertificateDeliveredPayload,
  CorrectInspectionResultPayload,
} from '../api/quality';
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

/** Normaliza celular colombiano para wa.me (código país 57, sin duplicarlo). */
const normalizeWhatsAppCo = (phoneRaw: string | null | undefined): string | null => {
  let digits = (phoneRaw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('57') && digits.length >= 12) {
    return digits;
  }
  if (digits.length === 10 && digits.startsWith('3')) {
    return `57${digits}`;
  }
  return null;
};

const hasValidRtmEmail = (email: string | null | undefined): boolean =>
  Boolean((email || '').trim() && (email || '').includes('@'));

const getInviteResultadoCierre = (row: QualityInviteItem): 'aprobado' | 'rechazado' | null => {
  if (row.revision_cierre_resultado === 'aprobado' || row.revision_cierre_resultado === 'rechazado') {
    return row.revision_cierre_resultado;
  }
  if (row.certificado_entregado_at) {
    return 'aprobado';
  }
  return null;
};

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

const DEFAULT_API_URL = 'http://localhost:8000/api/v1';

const extractHttpUrl = (value: string): string | null => {
  const match = value.match(/https?:\/\/[^\s"'|]+/i);
  return match ? match[0] : null;
};

const resolveBackendBaseUrl = (): string => {
  const rawEnv = String(import.meta.env.VITE_API_URL || '').trim();
  if (import.meta.env.DEV && rawEnv.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
  }
  const extractedEnvUrl = rawEnv ? extractHttpUrl(rawEnv) : null;
  const apiUrl = extractedEnvUrl || DEFAULT_API_URL;
  return apiUrl.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
};

const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/');

const buildLogoPreviewCandidates = (rawUrl?: string | null): string[] => {
  const raw = normalizeSlashes((rawUrl || '').trim());
  if (!raw) return [];
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return [raw];

  const backendBase = resolveBackendBaseUrl();
  const candidates = new Set<string>();
  candidates.add(raw);

  if (raw.startsWith('/uploads/')) {
    candidates.add(`${backendBase}${raw}`);
  }
  if (raw.startsWith('uploads/')) {
    candidates.add(`${backendBase}/${raw}`);
  }

  const uploadsIndex = raw.toLowerCase().indexOf('/uploads/');
  if (uploadsIndex >= 0) {
    candidates.add(`${backendBase}${raw.slice(uploadsIndex)}`);
  }

  const relUploadsIndex = raw.toLowerCase().indexOf('uploads/');
  if (relUploadsIndex >= 0) {
    candidates.add(`${backendBase}/${raw.slice(relUploadsIndex)}`);
  }

  return Array.from(candidates);
};

export default function Calidad() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const brand = useBrand();
  const { user, refreshTenantUser } = useAuth();
  const tenantUser = user && 'tenant_id' in user ? (user as Usuario) : null;
  const puedeElegirSedeCalidad =
    !!tenantUser && (tenantUser.rol === 'administrador' || tenantUser.rol === 'contador');
  const puedeGestionarLogoCalidad = !!tenantUser && tenantUser.rol === 'administrador';
  const puedeCorregirCierreInspeccion = !!tenantUser && tenantUser.rol === 'administrador';
  const [activeTab, setActiveTab] = useState<'encuestas' | 'satisfaccion' | 'vencimientos' | 'logo_calidad'>('encuestas');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [calidadSedeScope, setCalidadSedeScope] = useState<'todas' | 'sucursal'>('todas');
  const [calidadSedeId, setCalidadSedeId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [encuestasPagina, setEncuestasPagina] = useState(1);
  const [encuestasPorPagina, setEncuestasPorPagina] = useState(25);
  const [satWindow, setSatWindow] = useState<'7' | '30' | '90' | 'all'>('30');
  const [satSoloRiesgo, setSatSoloRiesgo] = useState(true);
  const [satSearchInput, setSatSearchInput] = useState('');
  const [satSearchDebounced, setSatSearchDebounced] = useState('');
  const [satPagina, setSatPagina] = useState(1);
  const [satDetalle, setSatDetalle] = useState<QualitySatisfactionItem | null>(null);
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);
  const [manualInviteId, setManualInviteId] = useState<string | null>(null);
  const [confirmEntregaInvite, setConfirmEntregaInvite] = useState<QualityInviteItem | null>(null);
  const [markingInviteId, setMarkingInviteId] = useState<string | null>(null);
  const [cierreResultado, setCierreResultado] = useState<'aprobado' | 'rechazado'>('aprobado');
  const [cierreObservacion, setCierreObservacion] = useState('');
  const [cierreConfirmAprobado, setCierreConfirmAprobado] = useState(false);
  const [confirmCorreccionInvite, setConfirmCorreccionInvite] = useState<QualityInviteItem | null>(null);
  const [correccionMotivo, setCorreccionMotivo] = useState('');
  const [correccionSincronizar, setCorreccionSincronizar] = useState(true);
  const [correccionInviteId, setCorreccionInviteId] = useState<string | null>(null);
  const correccionResultadoActual = confirmCorreccionInvite ? getInviteResultadoCierre(confirmCorreccionInvite) : null;
  const correccionResultadoNuevo: 'aprobado' | 'rechazado' =
    correccionResultadoActual === 'rechazado' ? 'aprobado' : 'rechazado';
  const correccionEsHaciaRechazado = correccionResultadoNuevo === 'rechazado';
  const [inPersonRatings, setInPersonRatings] = useState<Record<QualitySurveyRatingKey, number>>(
    emptyQualitySurveyRatings
  );
  const [inPersonComentario, setInPersonComentario] = useState('');
  const [logoCalidadFile, setLogoCalidadFile] = useState<File | null>(null);
  const [logoCalidadUrlInput, setLogoCalidadUrlInput] = useState('');
  const [logoCalidadPreviewLocal, setLogoCalidadPreviewLocal] = useState<string | null>(null);
  const [qualityLogoPreviewCandidateIndex, setQualityLogoPreviewCandidateIndex] = useState(0);
  const [formatoVersionInput, setFormatoVersionInput] = useState('');

  useEffect(() => {
    if (!manualInviteId) return;
    setInPersonRatings(emptyQualitySurveyRatings());
    setInPersonComentario('');
  }, [manualInviteId]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = window.setTimeout(() => setSatSearchDebounced(satSearchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [satSearchInput]);

  const [rtmWindow, setRtmWindow] = useState<8 | 15 | 30>(30);
  const [rtmStatusFilter, setRtmStatusFilter] = useState<string>('todos');
  const [rtmSearch, setRtmSearch] = useState('');
  const [rtmNotesDraft, setRtmNotesDraft] = useState<Record<string, string>>({});
  const [showTopEncuestasScroll, setShowTopEncuestasScroll] = useState(false);
  const topEncuestasScrollRef = useRef<HTMLDivElement | null>(null);
  const topEncuestasInnerRef = useRef<HTMLDivElement | null>(null);
  const bottomEncuestasScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingEncuestasScrollRef = useRef(false);

  const calidadSedeApiParam = useMemo(() => {
    if (!puedeElegirSedeCalidad) return undefined;
    if (calidadSedeScope === 'todas') return undefined;
    return calidadSedeId.trim() || undefined;
  }, [puedeElegirSedeCalidad, calidadSedeScope, calidadSedeId]);

  useEffect(() => {
    setEncuestasPagina(1);
  }, [searchDebounced, statusFilter, calidadSedeApiParam]);

  useEffect(() => {
    setSatPagina(1);
  }, [satWindow, satSoloRiesgo, satSearchDebounced, calidadSedeApiParam]);

  const summaryQuery = useQuery({
    queryKey: ['quality-summary', calidadSedeApiParam],
    queryFn: () =>
      qualityApi.getSummary(calidadSedeApiParam ? { sucursal_id: calidadSedeApiParam } : undefined),
    refetchInterval: 30000,
  });

  const satPorPagina = 25;
  const satisfactionQuery = useQuery({
    queryKey: [
      'quality-satisfaction',
      calidadSedeApiParam,
      satWindow,
      satSoloRiesgo,
      satSearchDebounced,
      satPagina,
    ],
    queryFn: () =>
      qualityApi.getSatisfaction({
        sucursal_id: calidadSedeApiParam,
        all_time: satWindow === 'all',
        days_window: satWindow === 'all' ? undefined : Number(satWindow),
        solo_riesgo: satSoloRiesgo,
        search: satSearchDebounced || undefined,
        skip: (satPagina - 1) * satPorPagina,
        limit: satPorPagina,
      }),
    enabled: activeTab === 'satisfaccion',
    refetchInterval: activeTab === 'satisfaccion' ? 30000 : false,
  });

  const qualityLogoQuery = useQuery({
    queryKey: ['quality-logo-calidad'],
    queryFn: qualityApi.getTenantLogoCalidad,
    staleTime: 30000,
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
      queryClient.invalidateQueries({ queryKey: ['quality-satisfaction'] });
    },
  });

  const upsertQualityLogoMutation = useMutation({
    mutationFn: qualityApi.upsertTenantLogoCalidad,
    onSuccess: async () => {
      setLogoCalidadFile(null);
      setLogoCalidadUrlInput('');
      queryClient.invalidateQueries({ queryKey: ['quality-logo-calidad'] });
      await refreshTenantUser();
      showToast('success', 'Logo de Calidad actualizado', 'Se guardó el logo que se usará en el PDF de pre-revisión.');
    },
    onError: (error: unknown) => {
      let message = 'No fue posible actualizar el logo de Calidad.';
      if (axios.isAxiosError(error)) {
        const d = error.response?.data?.detail;
        if (typeof d === 'string') message = d;
      } else if (error instanceof Error) {
        message = error.message;
      }
      showToast('error', 'Error', message);
    },
  });

  const clearQualityLogoMutation = useMutation({
    mutationFn: qualityApi.clearTenantLogoCalidad,
    onSuccess: async () => {
      setLogoCalidadFile(null);
      setLogoCalidadUrlInput('');
      queryClient.invalidateQueries({ queryKey: ['quality-logo-calidad'] });
      await refreshTenantUser();
      showToast('success', 'Logo de Calidad eliminado', 'El PDF de pre-revisión volverá a usar el logo general.');
    },
    onError: (error: unknown) => {
      let message = 'No fue posible eliminar el logo de Calidad.';
      if (axios.isAxiosError(error)) {
        const d = error.response?.data?.detail;
        if (typeof d === 'string') message = d;
      } else if (error instanceof Error) {
        message = error.message;
      }
      showToast('error', 'Error', message);
    },
  });

  const updateFormatoVersionMutation = useMutation({
    mutationFn: qualityApi.updateFormatoPrerevisionVersion,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['quality-logo-calidad'] });
      await refreshTenantUser();
      showToast('success', 'Versión actualizada', 'Se guardó la versión del formato de pre-revisión.');
    },
    onError: (error: unknown) => {
      let message = 'No fue posible actualizar la versión del formato.';
      if (axios.isAxiosError(error)) {
        const d = error.response?.data?.detail;
        if (typeof d === 'string') message = d;
      } else if (error instanceof Error) {
        message = error.message;
      }
      showToast('error', 'Error', message);
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
      queryClient.invalidateQueries({ queryKey: ['quality-satisfaction'] });
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

  const markCertificateDeliveredMutation = useMutation({
    mutationFn: ({ inviteId, payload }: { inviteId: string; payload: MarkCertificateDeliveredPayload }) =>
      qualityApi.markCertificateDelivered(inviteId, payload),
    onSuccess: (data) => {
      setConfirmEntregaInvite(null);
      setMarkingInviteId(null);
      setCierreResultado('aprobado');
      setCierreObservacion('');
      setCierreConfirmAprobado(false);
      showToast('success', data.resultado === 'aprobado' ? 'Resultado aprobado' : 'Resultado rechazado', data.message);
      queryClient.invalidateQueries({ queryKey: ['quality-invites'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-operativo'] });
      queryClient.invalidateQueries({ queryKey: ['quality-invite-detail'] });
    },
    onError: (error: unknown) => {
      setMarkingInviteId(null);
      let message = 'No fue posible guardar el resultado de inspección.';
      if (axios.isAxiosError(error)) {
        const d = error.response?.data?.detail;
        if (typeof d === 'string') message = d;
      } else if (error instanceof Error) {
        message = error.message;
      }
      showToast('error', 'Error', message);
    },
  });

  const correctInspectionResultMutation = useMutation({
    mutationFn: ({ inviteId, payload }: { inviteId: string; payload: CorrectInspectionResultPayload }) =>
      qualityApi.correctInspectionResult(inviteId, payload),
    onSuccess: (data) => {
      setConfirmCorreccionInvite(null);
      setCorreccionInviteId(null);
      setCorreccionMotivo('');
      setCorreccionSincronizar(true);
      showToast(
        'success',
        data.resultado_nuevo === 'aprobado'
          ? 'Corregido a aprobado'
          : data.reintento_sincronizado
            ? 'Corrección aplicada'
            : 'Corregido a rechazado',
        data.message
      );
      queryClient.invalidateQueries({ queryKey: ['quality-invites'] });
      queryClient.invalidateQueries({ queryKey: ['quality-invite-detail'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-operativo'] });
      queryClient.invalidateQueries({ queryKey: ['vehiculos-pendientes'] });
    },
    onError: (error: unknown) => {
      setCorreccionInviteId(null);
      let message = 'No fue posible corregir el resultado de inspección.';
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
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-rtm-reminders'] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'No fue posible enviar el recordatorio.';
      showToast('error', 'Error enviando recordatorio', message);
    },
  });
  const sendingRtmEmailId =
    sendRTMNowMutation.isLoading && typeof sendRTMNowMutation.variables === 'string'
      ? sendRTMNowMutation.variables
      : null;

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
  const qualityLogoSettings = qualityLogoQuery.data;
  const qualityLogoPreviewCandidates = useMemo(() => {
    const localCandidates = buildLogoPreviewCandidates(logoCalidadPreviewLocal);
    const calidadCandidates = buildLogoPreviewCandidates(qualityLogoSettings?.logo_calidad_url);
    const generalCandidates = buildLogoPreviewCandidates(qualityLogoSettings?.logo_general_url);
    return Array.from(new Set([...localCandidates, ...calidadCandidates, ...generalCandidates]));
  }, [logoCalidadPreviewLocal, qualityLogoSettings?.logo_calidad_url, qualityLogoSettings?.logo_general_url]);
  const qualityLogoPreview = qualityLogoPreviewCandidates[qualityLogoPreviewCandidateIndex] || null;
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

  const satSummary = satisfactionQuery.data?.summary;
  const satItems = satisfactionQuery.data?.items ?? [];
  const totalSat = satisfactionQuery.data?.total ?? 0;
  const totalPaginasSat = Math.max(1, Math.ceil(totalSat / satPorPagina) || 1);
  useEffect(() => {
    if (satPagina > totalPaginasSat) {
      setSatPagina(totalPaginasSat);
    }
  }, [satPagina, totalPaginasSat]);

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

  const openWhatsApp = (row: RTMReminderItem): boolean => {
    const phone = normalizeWhatsAppCo(row.cliente_celular);
    const nombreCda = (row.nombre_cda || 'CDASOFT').trim();
    if (!phone) {
      showToast('warning', 'Sin celular', 'Este cliente no tiene celular válido para WhatsApp.');
      return false;
    }
    const message = encodeURIComponent(
      `Hola ${row.cliente_nombre}, te escribimos de ${nombreCda} para recordarte la próxima RTM de tu vehículo ${row.placa}. ¿Te gustaría agendar tu cita? ${row.agendamiento_url || ''}`
    );
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
    touchRTMManagementMutation.mutate({
      reminderId: row.id,
      payload: { channel: 'whatsapp', auto_status: row.commercial_status === 'pendiente' ? 'contactado' : undefined },
    });
    showToast('success', 'WhatsApp abierto', 'Se registró la gestión comercial por WhatsApp.');
    return true;
  };

  useEffect(() => {
    const refreshTopScrollMetrics = () => {
      const bottom = bottomEncuestasScrollRef.current;
      if (!bottom) return;
      const topInner = topEncuestasInnerRef.current;
      const contentWidth = bottom.scrollWidth;
      const viewportWidth = bottom.clientWidth;
      if (topInner) topInner.style.width = `${contentWidth}px`;
      setShowTopEncuestasScroll(contentWidth > viewportWidth + 2);
      const top = topEncuestasScrollRef.current;
      if (top) top.scrollLeft = bottom.scrollLeft;
    };

    refreshTopScrollMetrics();
    window.addEventListener('resize', refreshTopScrollMetrics);
    const observer = new ResizeObserver(() => refreshTopScrollMetrics());
    if (bottomEncuestasScrollRef.current) observer.observe(bottomEncuestasScrollRef.current);
    const table = bottomEncuestasScrollRef.current?.querySelector('table');
    if (table) observer.observe(table);
    return () => {
      window.removeEventListener('resize', refreshTopScrollMetrics);
      observer.disconnect();
    };
  }, [rows, encuestasPorPagina, statusFilter, searchDebounced, calidadSedeApiParam]);

  useEffect(() => {
    if (!logoCalidadFile) {
      setLogoCalidadPreviewLocal(null);
      return;
    }
    const objectUrl = URL.createObjectURL(logoCalidadFile);
    setLogoCalidadPreviewLocal(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logoCalidadFile]);

  useEffect(() => {
    setQualityLogoPreviewCandidateIndex(0);
  }, [qualityLogoPreviewCandidates]);

  useEffect(() => {
    setFormatoVersionInput(qualityLogoSettings?.formato_prerevision_version || 'RTM-01-FR v13');
  }, [qualityLogoSettings?.formato_prerevision_version]);

  const handleTopEncuestasScroll = () => {
    const top = topEncuestasScrollRef.current;
    const bottom = bottomEncuestasScrollRef.current;
    if (!top || !bottom || syncingEncuestasScrollRef.current) return;
    syncingEncuestasScrollRef.current = true;
    bottom.scrollLeft = top.scrollLeft;
    requestAnimationFrame(() => {
      syncingEncuestasScrollRef.current = false;
    });
  };

  const handleBottomEncuestasScroll = () => {
    const top = topEncuestasScrollRef.current;
    const bottom = bottomEncuestasScrollRef.current;
    if (!top || !bottom || syncingEncuestasScrollRef.current) return;
    syncingEncuestasScrollRef.current = true;
    top.scrollLeft = bottom.scrollLeft;
    requestAnimationFrame(() => {
      syncingEncuestasScrollRef.current = false;
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
            Opera encuestas y cierres de inspección, y monitorea la satisfacción para detectar clientes en riesgo.
          </p>
        </section>

        <section className="section-card p-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('encuestas')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'encuestas' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Encuestas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('satisfaccion')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'satisfaccion' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Satisfacción
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vencimientos')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'vencimientos' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Próximos vencimientos RTM
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('logo_calidad')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'logo_calidad' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              <span className="inline-flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Logo Calidad
              </span>
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
            <p className="text-xs text-slate-500">Pendientes de envío</p>
            <p className="text-2xl font-bold text-cyan-700">{summaryQuery.data?.total_pendientes || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Tasa de respuesta</p>
            <p className="text-2xl font-bold text-slate-800">
              {summaryQuery.data?.tasa_respuesta != null
                ? `${summaryQuery.data.tasa_respuesta}%`
                : '0%'}
            </p>
          </div>
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Bandeja operativa de encuestas</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Mostrador, envíos y cierre de inspección. El análisis de satisfacción está en la pestaña Satisfacción.
              </p>
            </div>
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

          <div
            ref={topEncuestasScrollRef}
            onScroll={handleTopEncuestasScroll}
            className={`${showTopEncuestasScroll ? 'mb-2' : 'hidden'} overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 bg-white`}
            aria-label="Desplazamiento horizontal superior de encuestas"
          >
            <div ref={topEncuestasInnerRef} className="h-3" />
          </div>
          <div className="table-shell">
            <div ref={bottomEncuestasScrollRef} onScroll={handleBottomEncuestasScroll} className="overflow-x-auto">
            <table className="table-enterprise min-w-[1000px]">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Sede</th>
                  <th>Celular</th>
                  <th>Placa</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th className="sticky right-0 z-20 bg-slate-50 shadow-[-8px_0_8px_-10px_rgba(15,23,42,0.35)]">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invitesQuery.isLoading && (
                  <tr>
                    <td colSpan={8} className="text-sm text-slate-500">Cargando encuestas...</td>
                  </tr>
                )}
                {!invitesQuery.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-sm text-slate-500">No hay resultados para los filtros actuales.</td>
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
                      <span className={statusClass(row.status)}>{statusLabel(row.status)}</span>
                      {row.status === 'pending' && row.cliente_email && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Correo programado: {new Date(row.scheduled_send_at).toLocaleString()}
                        </p>
                      )}
                    </td>
                    <td className="sticky right-0 z-10 bg-white shadow-[-8px_0_8px_-10px_rgba(15,23,42,0.35)]">
                      <div className="flex flex-col gap-1 min-w-[156px]">
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
                        {!(row.revision_cierre_resultado || row.certificado_entregado_at) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCierreResultado('aprobado');
                              setCierreObservacion('');
                              setCierreConfirmAprobado(false);
                              setConfirmEntregaInvite(row);
                            }}
                            disabled={markCertificateDeliveredMutation.isLoading && markingInviteId === row.id}
                            className="px-3 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {markCertificateDeliveredMutation.isLoading && markingInviteId === row.id
                              ? 'Marcando...'
                              : 'Cerrar inspección'}
                          </button>
                        ) : (
                          <>
                            <span
                              className={`text-xs inline-flex items-center gap-1 ${
                                row.revision_cierre_resultado === 'rechazado'
                                  ? 'badge badge-warning'
                                  : 'badge badge-success'
                              }`}
                              title={
                                row.revision_cierre_resultado === 'aprobado' || (!row.revision_cierre_resultado && !!row.certificado_entregado_at)
                                  ? `Aprobado y entregado: ${row.certificado_entregado_at ? new Date(row.certificado_entregado_at).toLocaleString() : ''}${
                                      row.certificado_entregado_por ? ` · ${row.certificado_entregado_por}` : ''
                                    }`
                                  : `Rechazado: ${row.revision_cierre_observacion || 'Sin observación'}`
                              }
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {row.revision_cierre_resultado === 'rechazado' ? 'Rechazado' : 'Aprobado'}
                            </span>
                            {puedeCorregirCierreInspeccion &&
                              getInviteResultadoCierre(row) &&
                              row.correccion_cierre_disponible && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCorreccionMotivo('');
                                  setCorreccionSincronizar(true);
                                  setConfirmCorreccionInvite(row);
                                }}
                                disabled={
                                  correctInspectionResultMutation.isLoading && correccionInviteId === row.id
                                }
                                className="px-3 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                {correctInspectionResultMutation.isLoading && correccionInviteId === row.id
                                  ? 'Corrigiendo...'
                                  : getInviteResultadoCierre(row) === 'rechazado'
                                    ? 'Corregir a aprobado'
                                    : 'Corregir a rechazado'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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

        {activeTab === 'satisfaccion' && (
          <>
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="section-card p-4 border-l-4 border-l-red-500">
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  En riesgo (ventana)
                </p>
                <p className="text-2xl font-bold text-red-700">{satSummary?.en_riesgo ?? 0}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Experiencia o recomendar ≤ 2
                </p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">En riesgo (últimos 7 días)</p>
                <p className="text-2xl font-bold text-amber-700">{satSummary?.en_riesgo_7d ?? 0}</p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">% insatisfacción</p>
                <p className="text-2xl font-bold text-slate-900">
                  {satSummary?.pct_insatisfaccion != null ? `${satSummary.pct_insatisfaccion}%` : '0%'}
                </p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">Promedio experiencia global</p>
                <p className="text-2xl font-bold text-violet-700">
                  {satSummary?.promedio_experiencia_global?.toFixed(2) ?? '0.00'}
                </p>
              </div>
              <div className="section-card p-4">
                <p className="text-xs text-slate-500">NPS (recomendar)</p>
                <p className="text-2xl font-bold text-indigo-700">
                  {satSummary?.nps_recomendar != null ? satSummary.nps_recomendar : 0}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Compósito 9 ítems: {satSummary?.promedio_compuesto?.toFixed(2) ?? '0.00'}
                </p>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="section-card p-4 border-l-4 border-l-emerald-500">
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Store className="w-3.5 h-3.5 text-emerald-600" />
                  Encuestas en mostrador
                </p>
                <p className="text-2xl font-bold text-emerald-700">
                  {satSummary?.respondidas_mostrador ?? 0}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Registradas manualmente en el CDA
                  {satSummary?.total_respondidas
                    ? ` · ${Math.round(((satSummary.respondidas_mostrador ?? 0) / satSummary.total_respondidas) * 100)}%`
                    : ''}
                </p>
              </div>
              <div className="section-card p-4 border-l-4 border-l-sky-500">
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-sky-600" />
                  Encuestas por correo
                </p>
                <p className="text-2xl font-bold text-sky-700">
                  {satSummary?.respondidas_correo ?? 0}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Respondidas con el enlace del email
                  {satSummary?.total_respondidas
                    ? ` · ${Math.round(((satSummary.respondidas_correo ?? 0) / satSummary.total_respondidas) * 100)}%`
                    : ''}
                </p>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(
                [
                  ['Atención', satSummary?.dimensiones.atencion],
                  ['Operación', satSummary?.dimensiones.operacion],
                  ['Instalaciones', satSummary?.dimensiones.instalaciones],
                  ['Lealtad', satSummary?.dimensiones.lealtad],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="section-card p-4">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className={`text-xl font-bold ${scoreClass(value ? Math.round(value) : null)}`}>
                    {value != null ? value.toFixed(2) : '0.00'}
                  </p>
                </div>
              ))}
            </section>

            <section className="section-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Lectura gerencial de satisfacción</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Prioriza clientes insatisfechos. Las 9 preguntas y la escala 1–5 no cambian.
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Respondidas en ventana: <span className="font-semibold text-slate-800">{satSummary?.total_respondidas ?? 0}</span>
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                <select
                  className="input-corporate"
                  value={satWindow}
                  onChange={(e) => setSatWindow(e.target.value as typeof satWindow)}
                  aria-label="Ventana de análisis"
                >
                  <option value="7">Últimos 7 días</option>
                  <option value="30">Últimos 30 días</option>
                  <option value="90">Últimos 90 días</option>
                  <option value="all">Todo el histórico</option>
                </select>
                <select
                  className="input-corporate"
                  value={satSoloRiesgo ? 'riesgo' : 'todas'}
                  onChange={(e) => setSatSoloRiesgo(e.target.value === 'riesgo')}
                  aria-label="Filtro de riesgo"
                >
                  <option value="riesgo">Solo en riesgo</option>
                  <option value="todas">Todas las respondidas</option>
                </select>
                <input
                  type="text"
                  className="input-corporate md:col-span-2"
                  value={satSearchInput}
                  onChange={(e) => setSatSearchInput(e.target.value)}
                  placeholder="Buscar cliente, placa, sede o comentario"
                />
              </div>

              {satisfactionQuery.isLoading && (
                <p className="text-sm text-slate-500 py-6 text-center">Cargando satisfacción...</p>
              )}
              {satisfactionQuery.isError && (
                <p className="text-sm text-red-600 py-4">No fue posible cargar el análisis de satisfacción.</p>
              )}

              {!satisfactionQuery.isLoading && (
                <div className="table-shell">
                  <div className="overflow-x-auto">
                    <table className="table-enterprise min-w-[980px]">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Cliente</th>
                          <th>Sede</th>
                          <th>Placa</th>
                          <th>Canal</th>
                          <th>Exp. global</th>
                          <th>Recomendar</th>
                          <th>Prom. 9</th>
                          <th>Comentario</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {satItems.length === 0 && (
                          <tr>
                            <td colSpan={10} className="text-sm text-slate-500">
                              No hay respuestas para los filtros actuales.
                            </td>
                          </tr>
                        )}
                        {satItems.map((row) => (
                          <tr
                            key={row.response_id}
                            className={row.en_riesgo ? 'bg-red-50/70' : undefined}
                          >
                            <td>
                              {row.responded_at
                                ? new Date(row.responded_at).toLocaleString()
                                : '-'}
                            </td>
                            <td>
                              <p className="font-medium text-slate-900">{row.cliente_nombre}</p>
                              {row.en_riesgo && (
                                <span className="badge badge-warning text-[10px] mt-1 inline-flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  En riesgo
                                </span>
                              )}
                            </td>
                            <td className="max-w-[140px] truncate" title={row.sucursal_nombre || ''}>
                              {row.sucursal_nombre || '—'}
                            </td>
                            <td className="font-semibold text-slate-900">{row.placa}</td>
                            <td>
                              {row.canal_respuesta === 'mostrador' ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                                  <Store className="w-3.5 h-3.5" />
                                  Mostrador
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-sky-700">
                                  <Mail className="w-3.5 h-3.5" />
                                  Correo
                                </span>
                              )}
                            </td>
                            <td className={scoreClass(row.experiencia_global)}>
                              {row.experiencia_global} ({stars(row.experiencia_global)})
                            </td>
                            <td className={scoreClass(row.recomendar_cda)}>
                              {row.recomendar_cda} ({stars(row.recomendar_cda)})
                            </td>
                            <td>{row.promedio_9.toFixed(2)}</td>
                            <td className="max-w-[220px] truncate" title={row.comentario || ''}>
                              {row.comentario || '—'}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn-chip px-3 py-1 text-xs inline-flex items-center gap-1"
                                onClick={() => setSatDetalle(row)}
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Ver
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-600">
                  {totalSat === 0
                    ? 'Sin resultados en esta vista.'
                    : `Mostrando página ${satPagina} de ${totalPaginasSat} · ${totalSat} registro(s)`}
                </p>
                <div className="flex gap-1 justify-center sm:justify-end">
                  <button
                    type="button"
                    className="btn-corporate-muted p-2 rounded-lg disabled:opacity-40"
                    disabled={satPagina <= 1 || satisfactionQuery.isLoading}
                    onClick={() => setSatPagina((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-corporate-muted p-2 rounded-lg disabled:opacity-40"
                    disabled={satPagina >= totalPaginasSat || satisfactionQuery.isLoading}
                    onClick={() => setSatPagina((p) => Math.min(totalPaginasSat, p + 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>

            {satDetalle && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                <div
                  className={`w-full max-w-2xl modal-panel rounded-2xl border border-slate-200 border-l-8 ${scoreBorderClass(satDetalle.experiencia_global)} bg-white shadow-2xl`}
                >
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <div>
                      <p className="text-base font-semibold text-slate-900">Detalle de satisfacción</p>
                      <p className="text-xs text-slate-500">
                        {satDetalle.placa} · {satDetalle.cliente_nombre}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSatDetalle(null)}
                      className="modal-close-btn inline-flex items-center justify-center"
                    >
                      <X className="w-5 h-5 text-slate-600" />
                    </button>
                  </div>
                  <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    {satDetalle.en_riesgo && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Cliente en riesgo: experiencia o recomendación ≤ 2.
                      </div>
                    )}
                    <div className="space-y-2">
                      {QUALITY_SURVEY_QUESTIONS.map((q) => {
                        const value = satDetalle[q.key as keyof QualitySatisfactionItem];
                        const n = typeof value === 'number' ? value : null;
                        return (
                          <p key={q.key} className="text-sm text-slate-700 flex justify-between gap-3">
                            <span className="text-slate-600">{q.label}</span>
                            <span className={`font-semibold ${scoreClass(n)}`}>{stars(n)}</span>
                          </p>
                        );
                      })}
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Comentario</p>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">
                        {satDetalle.comentario || 'Sin comentario.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <p>
                        <span className="text-slate-500">Canal: </span>
                        {satDetalle.canal_respuesta === 'mostrador' ? 'Mostrador' : 'Correo'}
                      </p>
                      <p>
                        <span className="text-slate-500">Sede: </span>
                        {satDetalle.sucursal_nombre || '—'}
                      </p>
                      <p>
                        <span className="text-slate-500">Recepcionista: </span>
                        {satDetalle.recepcionista_nombre || '—'}
                      </p>
                      <p>
                        <span className="text-slate-500">Cajero: </span>
                        {satDetalle.cajero_nombre || '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
                                      rtm_reminder_id: row.id,
                                    },
                                  },
                                });
                                touchRTMManagementMutation.mutate({
                                  reminderId: row.id,
                                  payload: {
                                    channel: 'agendamiento',
                                    auto_status: row.commercial_status === 'pendiente' ? 'interesado' : undefined,
                                  },
                                });
                                showToast('success', 'Cliente precargado', 'Abriendo Agendamiento con datos del cliente.');
                              }}
                              className="btn-chip px-2 py-1 rounded-md text-xs font-semibold"
                            >
                              Agendar
                            </button>
                            <button
                              type="button"
                              onClick={() => openWhatsApp(row)}
                              disabled={!normalizeWhatsAppCo(row.cliente_celular)}
                              title={
                                normalizeWhatsAppCo(row.cliente_celular)
                                  ? 'Abrir WhatsApp'
                                  : 'Sin celular válido'
                              }
                              className="btn-chip px-2 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-60"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              WhatsApp
                            </button>
                            <button
                              type="button"
                              onClick={() => sendRTMNowMutation.mutate(row.id)}
                              disabled={!hasValidRtmEmail(row.cliente_email) || sendingRtmEmailId === row.id}
                              title={
                                hasValidRtmEmail(row.cliente_email)
                                  ? 'Enviar recordatorio por correo'
                                  : 'Sin correo registrado'
                              }
                              className="btn-chip px-2 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-60"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              {sendingRtmEmailId === row.id ? 'Enviando...' : 'Email'}
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
        {activeTab === 'logo_calidad' && (
          <section className="section-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">Logo de Calidad (PDF Pre-revisión)</p>
                <p className="text-xs text-slate-500 mt-1">
                  Este logo solo aplica al PDF de pre-revisión. Si no configuras uno, se usa el logo general del tenant.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                Formatos permitidos: PNG, JPG, JPEG, WEBP
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-4 mt-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-600 mb-2">Vista previa</p>
                <div className="h-28 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                  {qualityLogoPreview ? (
                    <img
                      src={qualityLogoPreview}
                      alt="Logo de calidad"
                      className="max-h-full max-w-full object-contain"
                      onError={() => {
                        setQualityLogoPreviewCandidateIndex((prev) =>
                          prev < qualityLogoPreviewCandidates.length - 1 ? prev + 1 : prev
                        );
                      }}
                    />
                  ) : (
                    <span className="text-xs text-slate-500 px-3 text-center">Sin logo de calidad configurado</span>
                  )}
                </div>
                {!qualityLogoPreview && qualityLogoSettings?.logo_general_url && (
                  <p className="text-[11px] text-slate-500 mt-2">Se usará el logo general actual en el PDF.</p>
                )}
              </div>
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Versión formato pre-revisión</p>
                  {puedeGestionarLogoCalidad ? (
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="text"
                        value={formatoVersionInput}
                        onChange={(e) => setFormatoVersionInput(e.target.value)}
                        className="input-corporate flex-1 min-w-[220px]"
                        maxLength={50}
                        placeholder="Ej: RTM-01-FR v13"
                      />
                      <button
                        type="button"
                        onClick={() => updateFormatoVersionMutation.mutate(formatoVersionInput.trim())}
                        disabled={updateFormatoVersionMutation.isLoading || !formatoVersionInput.trim()}
                        className="btn-corporate-primary px-4 disabled:opacity-60"
                      >
                        {updateFormatoVersionMutation.isLoading ? 'Guardando...' : 'Guardar versión'}
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">{qualityLogoSettings?.formato_prerevision_version || 'RTM-01-FR v13'}</p>
                  )}
                </div>
                {puedeGestionarLogoCalidad ? (
                  <>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={(e) => setLogoCalidadFile(e.target.files?.[0] || null)}
                      className="input-corporate"
                    />
                    <input
                      type="url"
                      value={logoCalidadUrlInput}
                      onChange={(e) => setLogoCalidadUrlInput(e.target.value)}
                      className="input-corporate"
                      placeholder="O pega una URL (https://...)"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => upsertQualityLogoMutation.mutate({ logoFile: logoCalidadFile, logoUrl: logoCalidadUrlInput })}
                        disabled={upsertQualityLogoMutation.isLoading || (!logoCalidadFile && !logoCalidadUrlInput.trim())}
                        className="btn-corporate-primary px-4 inline-flex items-center gap-2 disabled:opacity-60"
                      >
                        <ImagePlus className="w-4 h-4" />
                        {upsertQualityLogoMutation.isLoading ? 'Guardando...' : 'Guardar logo de Calidad'}
                      </button>
                      <button
                        type="button"
                        onClick={() => clearQualityLogoMutation.mutate()}
                        disabled={clearQualityLogoMutation.isLoading || !qualityLogoSettings?.logo_calidad_url}
                        className="btn-corporate-muted px-4 inline-flex items-center gap-2 disabled:opacity-60"
                      >
                        <Trash2 className="w-4 h-4" />
                        {clearQualityLogoMutation.isLoading ? 'Restaurando...' : 'Quitar y usar logo general'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Solo el rol administrador puede actualizar este logo.
                  </p>
                )}
                {qualityLogoSettings?.logo_general_url && (
                  <p className="text-[11px] text-slate-500">
                    Logo general configurado: <span className="font-semibold text-slate-700">disponible</span>
                  </p>
                )}
              </div>
            </div>
          </section>
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

      {confirmEntregaInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md section-card p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-0.5">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">Cerrar resultado de inspección</p>
                <p className="text-sm text-slate-600 mt-1">
                  Registra el resultado final para la placa{' '}
                  <span className="font-semibold text-slate-800">{confirmEntregaInvite.placa}</span>.
                </p>
                <p className="text-xs text-slate-500 mt-1">Este registro define si puede aplicar reinspección por rechazo.</p>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="resultado-cierre"
                  checked={cierreResultado === 'aprobado'}
                  onChange={() => setCierreResultado('aprobado')}
                />
                Aprobado (entrega de certificado)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="resultado-cierre"
                  checked={cierreResultado === 'rechazado'}
                  onChange={() => setCierreResultado('rechazado')}
                />
                Rechazado (sin entrega de certificado)
              </label>
              <textarea
                value={cierreObservacion}
                onChange={(e) => setCierreObservacion(e.target.value)}
                placeholder={
                  cierreResultado === 'rechazado'
                    ? 'Observación obligatoria del rechazo'
                    : 'Observación opcional'
                }
                className="input-corporate min-h-[96px]"
                maxLength={2000}
              />
              {cierreResultado === 'rechazado' && (
                <p className="text-xs text-amber-700">
                  Para rechazo, la observación es obligatoria.
                </p>
              )}
              {cierreResultado === 'aprobado' && (
                <label className="flex items-start gap-2 text-sm text-slate-800 border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={cierreConfirmAprobado}
                    onChange={(e) => setCierreConfirmAprobado(e.target.checked)}
                  />
                  <span>
                    Confirmo que el vehículo <strong>aprobó</strong> la inspección física y se entrega certificado.
                  </span>
                </label>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmEntregaInvite(null);
                  setCierreConfirmAprobado(false);
                }}
                className="btn-corporate-muted px-4 py-2 rounded-lg"
                disabled={markCertificateDeliveredMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const observacion = cierreObservacion.trim();
                  if (cierreResultado === 'rechazado' && !observacion) {
                    showToast('warning', 'Observación requerida', 'Debes registrar la observación del rechazo.');
                    return;
                  }
                  if (cierreResultado === 'aprobado' && !cierreConfirmAprobado) {
                    showToast(
                      'warning',
                      'Confirmación requerida',
                      'Debes confirmar que el vehículo aprobó la inspección física.'
                    );
                    return;
                  }
                  setMarkingInviteId(confirmEntregaInvite.id);
                  markCertificateDeliveredMutation.mutate({
                    inviteId: confirmEntregaInvite.id,
                    payload: {
                      resultado: cierreResultado,
                      observacion: observacion || undefined,
                    },
                  });
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-2"
                disabled={
                  markCertificateDeliveredMutation.isLoading ||
                  (cierreResultado === 'aprobado' && !cierreConfirmAprobado)
                }
              >
                <CheckCircle2 className="w-4 h-4" />
                {markCertificateDeliveredMutation.isLoading ? 'Guardando...' : 'Guardar resultado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCorreccionInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md section-card p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-0.5">
                <RotateCcw className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">Corregir resultado de inspección</p>
                <p className="text-sm text-slate-600 mt-1">
                  Cambiará el cierre de <span className="font-semibold text-slate-800">{correccionResultadoActual || 'aprobado'}</span> a{' '}
                  <span className="font-semibold text-slate-800">{correccionResultadoNuevo}</span> para la placa{' '}
                  <span className="font-semibold text-slate-800">{confirmCorreccionInvite.placa}</span>.
                </p>
                {correccionEsHaciaRechazado ? (
                  <p className="text-xs text-amber-700 mt-2">
                    No revierte cobros ni facturas ya emitidas. Habilita reinspección sin cobro si hay un registro
                    pendiente en Caja.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 mt-2">
                    No revierte cobros ni facturas ya emitidas. Si existe un pendiente en Caja para esta placa,
                    primero debes regularizarlo para evitar inconsistencias operativas.
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <textarea
                value={correccionMotivo}
                onChange={(e) => setCorreccionMotivo(e.target.value)}
                placeholder="Motivo obligatorio de la corrección (mínimo 10 caracteres)"
                className="input-corporate min-h-[110px]"
                maxLength={2000}
              />
              {correccionEsHaciaRechazado && (
                <label className="flex items-start gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={correccionSincronizar}
                    onChange={(e) => setCorreccionSincronizar(e.target.checked)}
                  />
                  <span>
                    Si existe un registro pendiente en Caja para esta placa, marcarlo automáticamente como reintento
                    exento ($0).
                  </span>
                </label>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCorreccionInvite(null)}
                className="btn-corporate-muted px-4 py-2 rounded-lg"
                disabled={correctInspectionResultMutation.isLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const motivo = correccionMotivo.trim();
                  if (motivo.length < 10) {
                    showToast(
                      'warning',
                      'Motivo requerido',
                      'Debes registrar un motivo de al menos 10 caracteres.'
                    );
                    return;
                  }
                  setCorreccionInviteId(confirmCorreccionInvite.id);
                  correctInspectionResultMutation.mutate({
                    inviteId: confirmCorreccionInvite.id,
                    payload: {
                      motivo,
                      sincronizar_reintento_pendiente: correccionEsHaciaRechazado
                        ? correccionSincronizar
                        : false,
                    },
                  });
                }}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60 inline-flex items-center gap-2"
                disabled={correctInspectionResultMutation.isLoading}
              >
                <RotateCcw className="w-4 h-4" />
                {correctInspectionResultMutation.isLoading ? 'Aplicando...' : 'Confirmar corrección'}
              </button>
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

