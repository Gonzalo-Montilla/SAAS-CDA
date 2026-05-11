import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BellRing, RefreshCw, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import Layout from '../components/Layout';
import { sarlaftApi } from '../api/sarlaft';
import type { SarlaftCase, SarlaftCasePartyInput, SarlaftInternalAlert, SarlaftManualCheck } from '../types';
import { useAuth } from '../contexts/AuthContext';

function money(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v || 0);
}

type SarlaftSeccion = 'resumen' | 'alertas' | 'casos' | 'consultas' | 'screening';

const SARLAFT_SECCIONES: { id: SarlaftSeccion; label: string; hint: string }[] = [
  { id: 'resumen', label: 'Resumen', hint: 'Panorama general de alertas, casos y consultas manuales.' },
  { id: 'alertas', label: 'Alertas internas', hint: 'Seguimiento del motor interno SARLAFT y severidad por operación.' },
  { id: 'casos', label: 'Casos', hint: 'Creación, búsqueda y bandeja de casos SARLAFT.' },
  { id: 'consultas', label: 'Consultas manuales', hint: 'Consultas fuera de recepción con trazabilidad y certificado.' },
  // La pestaña de screening técnico se mantiene fuera del flujo visible para evitar ruido operativo.
];

export default function Sarlaft() {
  const { user } = useAuth();
  const isAdmin = user?.rol === 'administrador';
  const actionableAlertsStorageKey = useMemo(
    () => `sarlaft-only-actionable-alerts:${user?.id || user?.email || 'anon'}`,
    [user?.id, user?.email]
  );
  const [operacionRef, setOperacionRef] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'mixto' | 'transferencia' | 'otro'>('efectivo');
  const [partyRole, setPartyRole] = useState<'cliente' | 'propietario' | 'pagador' | 'apoderado'>('cliente');
  const [partyDocType, setPartyDocType] = useState('CC');
  const [partyDocNumber, setPartyDocNumber] = useState('');
  const [partyName, setPartyName] = useState('');
  const [manualSubjectType, setManualSubjectType] = useState<'natural' | 'juridica'>('natural');
  const [manualFullName, setManualFullName] = useState('');
  const [manualDocType, setManualDocType] = useState('CC');
  const [manualDocNumber, setManualDocNumber] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualEconomicActivity, setManualEconomicActivity] = useState('');
  const [manualLegalRepresentative, setManualLegalRepresentative] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualDataset, setManualDataset] = useState<'default' | 'sanctions'>('sanctions');
  const [screeningDataset, setScreeningDataset] = useState<'default' | 'sanctions'>('sanctions');
  const [caseIdLookup, setCaseIdLookup] = useState('');
  const [screeningCaseId, setScreeningCaseId] = useState('');
  const [screeningResult, setScreeningResult] = useState<{
    risk_level: 'verde' | 'amarillo' | 'rojo';
    recommended_action: string;
    raw_count: number;
    alert: boolean;
    hits: Array<{ caption?: string; score?: number; source_url?: string }>;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createdCase, setCreatedCase] = useState<SarlaftCase | null>(null);
  const [foundCase, setFoundCase] = useState<SarlaftCase | null>(null);
  const [createdManualCheck, setCreatedManualCheck] = useState<SarlaftManualCheck | null>(null);
  const [downloadingCertificateId, setDownloadingCertificateId] = useState<string | null>(null);
  const [copiedManualCheckId, setCopiedManualCheckId] = useState<string | null>(null);
  const [copiedCaseId, setCopiedCaseId] = useState<string | null>(null);
  const [internalAlertLevelFilter, setInternalAlertLevelFilter] = useState<'todas' | 'critica' | 'media' | 'baja'>('todas');
  const [onlyActionableAlerts, setOnlyActionableAlerts] = useState(true);
  const [sarlaftSeccion, setSarlaftSeccion] = useState<SarlaftSeccion>('resumen');
  const [caseDetailModalOpen, setCaseDetailModalOpen] = useState(false);
  const [contingenciaOpen, setContingenciaOpen] = useState(false);
  const [decisionModal, setDecisionModal] = useState<{
    alertId: string;
  } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionFundsSource, setDecisionFundsSource] = useState('');
  const [decisionEconomicSupport, setDecisionEconomicSupport] = useState('');
  const [decisionCashierInterview, setDecisionCashierInterview] = useState<'normal' | 'nervioso' | 'evasivo' | 'apresurado'>('normal');
  const [decisionSupportRefsRaw, setDecisionSupportRefsRaw] = useState('');

  useEffect(() => {
    setManualDocType((prev) => {
      if (manualSubjectType === 'juridica') return 'NIT';
      if (!prev || prev.toUpperCase() === 'NIT') return 'CC';
      return prev;
    });
  }, [manualSubjectType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(actionableAlertsStorageKey);
    if (raw === '1') {
      setOnlyActionableAlerts(true);
      return;
    }
    if (raw === '0') {
      setOnlyActionableAlerts(false);
    }
  }, [actionableAlertsStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(actionableAlertsStorageKey, onlyActionableAlerts ? '1' : '0');
  }, [actionableAlertsStorageKey, onlyActionableAlerts]);

  useEffect(() => {
    if (!caseDetailModalOpen) return;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCaseDetailModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [caseDetailModalOpen]);

  const saveBlobAsFile = (blob: Blob, filename: string): void => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    const value = (text || '').trim();
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  };
  const closeCaseDetailModal = (): void => {
    setCaseDetailModalOpen(false);
    setCaseIdLookup('');
    setFoundCase(null);
  };
  const closeDecisionModal = (): void => {
    setDecisionModal(null);
    setDecisionNotes('');
    setDecisionFundsSource('');
    setDecisionEconomicSupport('');
    setDecisionCashierInterview('normal');
    setDecisionSupportRefsRaw('');
  };

  const casesQuery = useQuery({
    queryKey: ['sarlaft-cases-list', 20],
    queryFn: async () => sarlaftApi.listCases({ limit: 20 }),
  });
  const manualChecksQuery = useQuery({
    queryKey: ['sarlaft-manual-checks-list', 20],
    queryFn: async () => sarlaftApi.listManualChecks({ limit: 20 }),
  });
  const internalAlertsQuery = useQuery({
    queryKey: ['sarlaft-internal-alerts-list', internalAlertLevelFilter, 30],
    queryFn: async () =>
      sarlaftApi.listInternalAlerts({
        limit: 30,
        alert_level: internalAlertLevelFilter === 'todas' ? undefined : internalAlertLevelFilter,
      }),
  });
  const profileQuery = useQuery({
    queryKey: ['sarlaft-profile'],
    queryFn: async () => sarlaftApi.getProfile(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const parties: SarlaftCasePartyInput[] = [
        {
          role: partyRole,
          doc_type: partyDocType.trim(),
          doc_number: partyDocNumber.trim(),
          full_name: partyName.trim(),
        },
      ];
      return sarlaftApi.createCase({
        operacion_ref: operacionRef.trim() || null,
        transaction_amount_cop: Number(transactionAmount || 0),
        cash_amount_cop: Number(cashAmount || 0),
        payment_method: paymentMethod,
        parties,
      });
    },
    onSuccess: (data) => {
      setFeedback('Caso SARLAFT creado correctamente.');
      setCreatedCase(data);
      setFoundCase(null);
      setScreeningCaseId(data.id);
      setOperacionRef('');
      setTransactionAmount('');
      setCashAmount('');
      setPartyRole('cliente');
      setPartyDocType('CC');
      setPartyDocNumber('');
      setPartyName('');
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No se pudo crear el caso SARLAFT.');
    },
  });

  const findMutation = useMutation({
    mutationFn: async (caseId?: string) => sarlaftApi.getCase((caseId || caseIdLookup).trim()),
    onSuccess: (data) => {
      setFeedback(null);
      setFoundCase(data);
      setCaseDetailModalOpen(true);
    },
    onError: (err: any) => {
      setFoundCase(null);
      setCaseDetailModalOpen(false);
      setFeedback(err?.response?.data?.detail || 'No se encontró el caso.');
    },
  });

  const screeningMutation = useMutation({
    mutationFn: async () =>
      sarlaftApi.screeningOpenSanctions({
        schema: 'Person',
        full_name: partyName.trim(),
        document_number: partyDocNumber.trim() || null,
        dataset: screeningDataset,
        algorithm: 'best',
        limit: 5,
        case_id: screeningCaseId.trim() || null,
        persist_in_case: Boolean(screeningCaseId.trim()),
      }),
    onSuccess: (data) => {
      setScreeningResult({
        risk_level: data.risk_level,
        recommended_action: data.recommended_action,
        raw_count: data.raw_count,
        alert: data.alert,
        hits: data.hits,
      });
      setFeedback(`Screening ejecutado (${data.dataset}). Nivel: ${data.risk_level.toUpperCase()}.`);
      casesQuery.refetch();
      if (data.case_id) {
        setCaseIdLookup(data.case_id);
      }
    },
    onError: (err: any) => {
      setScreeningResult(null);
      setFeedback(err?.response?.data?.detail || 'No se pudo ejecutar screening OpenSanctions.');
    },
  });

  const manualCheckMutation = useMutation({
    mutationFn: async () =>
      sarlaftApi.createManualCheck({
        subject_type: manualSubjectType,
        full_name: manualFullName.trim(),
        doc_type: manualDocType.trim() || null,
        doc_number: manualDocNumber.trim() || null,
        email: manualEmail.trim() || null,
        phone: manualPhone.trim() || null,
        economic_activity: manualEconomicActivity.trim() || null,
        legal_representative: manualLegalRepresentative.trim() || null,
        dataset: manualDataset,
        algorithm: 'best',
        limit: 5,
        notes: manualNotes.trim() || null,
      }),
    onSuccess: (data) => {
      setCreatedManualCheck(data);
      setFeedback(`Consulta manual registrada. Nivel: ${data.risk_level.toUpperCase()}.`);
      // Limpiar formulario para nueva consulta.
      setManualSubjectType('natural');
      setManualDataset('sanctions');
      setManualFullName('');
      setManualDocType('CC');
      setManualDocNumber('');
      setManualEmail('');
      setManualPhone('');
      setManualNotes('');
      setManualEconomicActivity('');
      setManualLegalRepresentative('');
      manualChecksQuery.refetch();
    },
    onError: (err: any) => {
      setCreatedManualCheck(null);
      setFeedback(err?.response?.data?.detail || 'No se pudo registrar la consulta manual.');
    },
  });

  const downloadCertificateMutation = useMutation({
    mutationFn: async (manualCheckId: string) => sarlaftApi.downloadManualCheckCertificate(manualCheckId),
    onMutate: (manualCheckId) => {
      setDownloadingCertificateId(manualCheckId);
    },
    onSuccess: ({ blob, filename, certificateCode }) => {
      saveBlobAsFile(blob, filename);
      setFeedback(
        certificateCode
          ? `Certificado SARLAFT descargado. Codigo: ${certificateCode}.`
          : 'Certificado SARLAFT descargado correctamente.'
      );
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No se pudo generar/descargar el certificado SARLAFT.');
    },
    onSettled: () => {
      setDownloadingCertificateId(null);
      manualChecksQuery.refetch();
    },
  });
  const decideAlertMutation = useMutation({
    mutationFn: async (payload: {
      alertId: string;
      decision: 'justificada' | 'sospechosa';
      notes?: string | null;
      funds_source_declaration: string;
      economic_activity_support: string;
      cashier_interview: 'normal' | 'nervioso' | 'evasivo' | 'apresurado';
      support_refs: string[];
    }) =>
      sarlaftApi.decideInternalAlert(payload.alertId, {
        decision: payload.decision,
        notes: payload.notes || null,
        funds_source_declaration: payload.funds_source_declaration,
        economic_activity_support: payload.economic_activity_support,
        cashier_interview: payload.cashier_interview,
        support_refs: payload.support_refs,
      }),
    onSuccess: (_, vars) => {
      setFeedback(
        vars.decision === 'justificada'
          ? 'Alerta marcada como Operación Inusual Justificada.'
          : 'Alerta marcada como Operación Sospechosa (ROS pendiente).'
      );
      closeDecisionModal();
      internalAlertsQuery.refetch();
      casesQuery.refetch();
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible registrar la decisión de la alerta.');
    },
  });
  const toggleApiMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      sarlaftApi.patchProfile({
        enabled: true,
        mode: enabled ? 'api' : 'manual',
        api_trigger_mode: enabled ? 'all' : profileQuery.data?.api_trigger_mode || 'all',
      }),
    onSuccess: (data) => {
      profileQuery.refetch();
      setFeedback(
        data.mode === 'api'
          ? 'API externa SARLAFT activada. El motor interno sigue activo permanentemente.'
          : 'API externa SARLAFT desactivada. El motor interno continúa activo.'
      );
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No se pudo cambiar el estado de API externa SARLAFT.');
    },
  });

  const riskBadgeClass = useMemo(
    () => (riskLevel: string) => {
      if (riskLevel === 'rojo') return 'border border-rose-200 bg-rose-50 text-rose-800';
      if (riskLevel === 'amarillo') return 'border border-amber-200 bg-amber-50 text-amber-800';
      return 'border border-emerald-200 bg-emerald-50 text-emerald-800';
    },
    [],
  );
  const manualFormValid = useMemo(() => {
    if (!manualFullName.trim()) return false;
    if (!manualDocType.trim()) return false;
    if (!manualDocNumber.trim()) return false;
    if (!manualEmail.trim()) return false;
    if (!manualPhone.trim()) return false;
    if (manualSubjectType === 'juridica' && manualDocType.trim().toUpperCase() !== 'NIT') return false;
    return true;
  }, [manualFullName, manualDocType, manualDocNumber, manualEmail, manualPhone, manualSubjectType]);
  const certificadoBadgeClass = useMemo(
    () => (hasCertificate: boolean) =>
      hasCertificate
        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border border-amber-200 bg-amber-50 text-amber-800',
    [],
  );
  const alertBadgeClass = useMemo(
    () => (level: string) => {
      if (level === 'critica' || level === 'alta') return 'border border-rose-200 bg-rose-50 text-rose-800';
      if (level === 'media') return 'border border-amber-200 bg-amber-50 text-amber-800';
      return 'border border-slate-200 bg-slate-100 text-slate-700';
    },
    [],
  );
  const internalAlertsRows = useMemo(() => {
    const levelWeight = (level: string): number => {
      if (level === 'critica' || level === 'alta') return 0;
      if (level === 'media') return 1;
      return 2;
    };
    const rows = [...(internalAlertsQuery.data || [])]
      .filter((row) => {
        if (!onlyActionableAlerts) return true;
        return !String(row.decision_status || '').trim();
      })
      .sort((a, b) => {
        const levelDiff = levelWeight(a.alert_level) - levelWeight(b.alert_level);
        if (levelDiff !== 0) return levelDiff;
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });
    return rows;
  }, [internalAlertsQuery.data, onlyActionableAlerts]);
  const internalAlertsKpi = useMemo(() => {
    const rows = internalAlertsRows;
    const total = rows.length;
    const criticas = rows.filter((r) => r.alert_level === 'critica' || r.alert_level === 'alta').length;
    const medias = rows.filter((r) => r.alert_level === 'media').length;
    const riesgoRojo = rows.filter((r) => r.risk_level === 'rojo').length;
    const pagoRiesgoso = rows.filter((r) => ['efectivo', 'mixto'].includes((r.payment_method || '').toLowerCase())).length;
    return { total, criticas, medias, riesgoRojo, pagoRiesgoso };
  }, [internalAlertsRows]);
  const alertLevelLabel = useMemo(
    () => (level: string) => {
      if (level === 'critica' || level === 'alta') return 'CRITICA';
      if (level === 'media') return 'MEDIA';
      if (level === 'baja') return 'BAJA';
      return (level || 'N/A').toUpperCase();
    },
    [],
  );
  const alertReasonLabel = useMemo(
    () => (reason?: string | null) => {
      const code = (reason || '').trim().toLowerCase();
      if (code === 'riesgo_rojo') return 'Riesgo rojo detectado por screening.';
      if (code === 'riesgo_amarillo_o_metodo_pago_riesgoso') return 'Riesgo amarillo o pago riesgoso (efectivo/mixto).';
      if (code === 'frecuencia_excesiva_fraccionamiento') return 'Frecuencia excesiva de operaciones y múltiples placas en ventana.';
      if (code === 'uso_intensivo_efectivo') return 'Uso intensivo de efectivo detectado en ventana temporal.';
      return reason || 'Sin detalle de motor.';
    },
    [],
  );
  const operationClassLabel = useMemo(
    () => (op?: string | null) => {
      const v = (op || '').trim().toLowerCase();
      if (v === 'operacion_inusual') return 'Inusual';
      if (v === 'operacion_sospechosa') return 'Sospechosa';
      return 'Regla básica';
    },
    [],
  );
  const decisionStatusLabel = useMemo(
    () => (decision?: string | null) => {
      const v = (decision || '').trim().toLowerCase();
      if (v === 'justificada') return 'Inusual justificada';
      if (v === 'sospechosa') return 'Sospechosa';
      return 'Pendiente';
    },
    [],
  );
  const decisionSupportRefs = useMemo(
    () =>
      decisionSupportRefsRaw
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    [decisionSupportRefsRaw],
  );
  const decisionFormValid = useMemo(
    () =>
      Boolean(
        decisionFundsSource.trim() &&
          decisionEconomicSupport.trim() &&
          decisionCashierInterview &&
          decisionSupportRefs.length >= 1
      ),
    [decisionFundsSource, decisionEconomicSupport, decisionCashierInterview, decisionSupportRefs.length],
  );
  const alertRowClass = useMemo(
    () => (level: string) => {
      if (level === 'critica' || level === 'alta') return 'border-t border-l-4 border-l-rose-400 border-slate-100 bg-rose-50/40';
      if (level === 'media') return 'border-t border-l-4 border-l-amber-400 border-slate-100 bg-amber-50/30';
      return 'border-t border-slate-100';
    },
    [],
  );
  const resumenKpi = useMemo(
    () => ({
      alertasInternas: internalAlertsKpi.total,
      casosRegistrados: (casesQuery.data || []).length,
      consultasManuales: (manualChecksQuery.data || []).length,
      alertasCriticas: internalAlertsKpi.criticas,
    }),
    [internalAlertsKpi, casesQuery.data, manualChecksQuery.data],
  );
  const seccionHint = useMemo(
    () => SARLAFT_SECCIONES.find((s) => s.id === sarlaftSeccion)?.hint || '',
    [sarlaftSeccion],
  );

  return (
    <Layout title="SARLAFT">
      <div className="space-y-6">
        <div className="sticky top-0 z-10 rounded-xl border border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-sm supports-[backdrop-filter]:bg-white/90">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motor SARLAFT</p>
              <p className="text-sm text-slate-700">
                Monitoreo interno: <strong>Siempre activo</strong>
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-medium text-slate-600">API externa</span>
              <button
                type="button"
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  (profileQuery.data?.mode || 'manual') === 'api' ? 'bg-primary-600' : 'bg-slate-300'
                } ${!isAdmin ? 'cursor-not-allowed opacity-60' : ''}`}
                onClick={() => {
                  if (!isAdmin || toggleApiMutation.isLoading || profileQuery.isLoading) return;
                  const current = (profileQuery.data?.mode || 'manual') === 'api';
                  toggleApiMutation.mutate(!current);
                }}
                disabled={!isAdmin || toggleApiMutation.isLoading || profileQuery.isLoading}
                title={isAdmin ? 'Activar/desactivar API externa' : 'Solo administrador'}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    (profileQuery.data?.mode || 'manual') === 'api' ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-xs font-semibold text-slate-700">
                {(profileQuery.data?.mode || 'manual') === 'api' ? 'Activa' : 'Inactiva'}
              </span>
            </div>
          </div>
          <div
            className="flex overflow-x-auto gap-0 border-b border-slate-100 px-1 pt-1 sm:px-2"
            role="tablist"
            aria-label="Secciones del panel SARLAFT"
          >
            {SARLAFT_SECCIONES.map((s) => {
              const active = sarlaftSeccion === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSarlaftSeccion(s.id)}
                  className={`min-w-[6.5rem] shrink-0 rounded-t-lg px-3 py-2.5 text-sm font-semibold transition-colors sm:min-w-0 sm:px-4 ${
                    active
                      ? 'border-b-2 border-primary-600 bg-primary-50/70 text-primary-900'
                      : 'border-b-2 border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="border-t border-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 sm:px-4">{seccionHint}</p>
        </div>

        {feedback && <p className="text-sm text-slate-700">{feedback}</p>}

        {sarlaftSeccion === 'resumen' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">Alertas internas</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{resumenKpi.alertasInternas}</p>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                <p className="text-xs text-rose-700">Alertas críticas</p>
                <p className="mt-1 text-2xl font-semibold text-rose-800">{resumenKpi.alertasCriticas}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">Casos SARLAFT</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{resumenKpi.casosRegistrados}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">Consultas manuales</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{resumenKpi.consultasManuales}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">Atajos rápidos</h3>
              <p className="mt-1 text-xs text-slate-500">Navega por pestañas para evitar una pantalla extensa y mantener foco operativo.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-corporate-muted px-3 py-1.5 text-xs" onClick={() => setSarlaftSeccion('alertas')}>
                  Ver alertas internas
                </button>
                <button className="btn-corporate-muted px-3 py-1.5 text-xs" onClick={() => setSarlaftSeccion('casos')}>
                  Gestionar casos
                </button>
                <button className="btn-corporate-muted px-3 py-1.5 text-xs" onClick={() => setSarlaftSeccion('consultas')}>
                  Registrar consulta manual
                </button>
                <button className="btn-corporate-muted px-3 py-1.5 text-xs" onClick={() => setSarlaftSeccion('screening')}>
                  Ejecutar screening
                </button>
              </div>
            </div>
          </div>
        )}

        {sarlaftSeccion === 'casos' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-900">Contingencia: registro manual de caso</h3>
              <p className="text-xs text-amber-800">
                Úsalo solo si el flujo automático de caja falla. Si no ingresas referencia interna, el sistema la genera automáticamente.
              </p>
            </div>
            <button
              type="button"
              className="btn-corporate-muted px-3 py-1.5 text-xs"
              onClick={() => setContingenciaOpen((prev) => !prev)}
            >
              {contingenciaOpen ? 'Ocultar contingencia' : 'Mostrar contingencia'}
            </button>
          </div>
          {contingenciaOpen && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Registro manual de caso SARLAFT</h2>
                  <p className="text-xs text-slate-500">
                    Crea expediente base; el screening se ejecuta en la pestaña Screening o por el flujo automático en caja.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="input-corporate"
                  placeholder="Referencia interna (opcional)"
                  value={operacionRef}
                  onChange={(e) => setOperacionRef(e.target.value)}
                />
                <select className="input-corporate" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="mixto">Mixto</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="otro">Otro</option>
                </select>
                <input className="input-corporate" type="number" placeholder="Valor total COP" value={transactionAmount} onChange={(e) => setTransactionAmount(e.target.value)} />
                <input className="input-corporate" type="number" placeholder="Valor efectivo COP" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
                <select className="input-corporate" value={partyRole} onChange={(e) => setPartyRole(e.target.value as any)}>
                  <option value="cliente">Cliente</option>
                  <option value="propietario">Propietario</option>
                  <option value="pagador">Pagador</option>
                  <option value="apoderado">Apoderado</option>
                </select>
                <input className="input-corporate" placeholder="Tipo documento" value={partyDocType} onChange={(e) => setPartyDocType(e.target.value)} />
                <input className="input-corporate" placeholder="Número documento" value={partyDocNumber} onChange={(e) => setPartyDocNumber(e.target.value)} />
                <input className="input-corporate" placeholder="Nombre completo" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
              </div>
              <div className="mt-4 flex justify-end">
                <button className="btn-corporate-primary px-4" disabled={createMutation.isLoading} onClick={() => createMutation.mutate()}>
                  {createMutation.isLoading ? 'Guardando...' : 'Crear caso'}
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        {sarlaftSeccion === 'consultas' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Search className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Consulta manual (fuera de recepción)</h3>
              <p className="text-xs text-slate-500">
                Para terceros fuera del flujo de recepción, con campos según tipo de sujeto.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              className="input-corporate"
              value={manualSubjectType}
              onChange={(e) => setManualSubjectType(e.target.value as 'natural' | 'juridica')}
            >
              <option value="natural">Persona natural</option>
              <option value="juridica">Persona jurídica</option>
            </select>
            <select
              className="input-corporate"
              value={manualDataset}
              onChange={(e) => setManualDataset(e.target.value as 'default' | 'sanctions')}
            >
              <option value="sanctions">sanctions</option>
              <option value="default">default</option>
            </select>
            <input
              className="input-corporate md:col-span-1"
              placeholder={manualSubjectType === 'juridica' ? 'Razón social *' : 'Nombre completo *'}
              value={manualFullName}
              onChange={(e) => setManualFullName(e.target.value.toUpperCase())}
            />
            {manualSubjectType === 'juridica' ? (
              <input className="input-corporate" value="NIT" disabled />
            ) : (
              <select className="input-corporate" value={manualDocType} onChange={(e) => setManualDocType(e.target.value)}>
                <option value="CC">CC</option>
                <option value="CE">CE</option>
                <option value="PA">PA</option>
                <option value="TI">TI</option>
              </select>
            )}
            <input
              className="input-corporate"
              placeholder={manualSubjectType === 'juridica' ? 'NIT *' : 'Número de documento *'}
              value={manualDocNumber}
              onChange={(e) => setManualDocNumber(e.target.value)}
            />
            <input
              className="input-corporate"
              placeholder="Correo *"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value.toLowerCase())}
            />
            <input className="input-corporate" placeholder="Celular / Teléfono *" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
            <input
              className="input-corporate md:col-span-1"
              placeholder="Notas internas (opcional)"
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
            />
            {manualSubjectType === 'juridica' && (
              <>
                <input
                  className="input-corporate md:col-span-2"
                  placeholder="Actividad económica (opcional)"
                  value={manualEconomicActivity}
                  onChange={(e) => setManualEconomicActivity(e.target.value)}
                />
                <input
                  className="input-corporate md:col-span-1"
                  placeholder="Representante legal (opcional)"
                  value={manualLegalRepresentative}
                  onChange={(e) => setManualLegalRepresentative(e.target.value)}
                />
              </>
            )}
          </div>
          {!manualFormValid && (
            <p className="mt-2 text-xs text-amber-700">
              Completa tipo, nombre/razón social, documento, correo y celular para registrar la consulta.
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              className="btn-corporate-primary px-4"
              disabled={manualCheckMutation.isLoading || !manualFormValid}
              onClick={() => manualCheckMutation.mutate()}
            >
              {manualCheckMutation.isLoading ? 'Registrando...' : 'Registrar consulta manual'}
            </button>
          </div>
          {createdManualCheck && (
            <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-700">
                    Consulta registrada
                  </p>
                  <p className="text-xs text-slate-600">Código de consulta (trazabilidad SARLAFT)</p>
                  <p className="mt-1 break-all font-mono text-sm font-semibold text-indigo-950 md:text-base">
                    {createdManualCheck.id}
                  </p>
                  <button
                    className="mt-2 inline-flex items-center rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                    onClick={async () => {
                      const ok = await copyTextToClipboard(createdManualCheck.id);
                      if (ok) {
                        setCopiedManualCheckId(createdManualCheck.id);
                        setFeedback('ID de consulta copiado al portapapeles.');
                        window.setTimeout(() => {
                          setCopiedManualCheckId((prev) => (prev === createdManualCheck.id ? null : prev));
                        }, 1500);
                      } else {
                        setFeedback('No fue posible copiar el ID. Cópialo manualmente.');
                      }
                    }}
                  >
                    {copiedManualCheckId === createdManualCheck.id ? 'Copiado' : 'Copiar ID'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(createdManualCheck.risk_level)}`}>
                    {createdManualCheck.risk_level.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-slate-700">Hits: {createdManualCheck.hits_count}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {sarlaftSeccion === 'screening' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Screening OpenSanctions</h3>
              <p className="text-xs text-slate-500">Clasifica automáticamente en verde/amarillo/rojo.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select className="input-corporate" value={screeningDataset} onChange={(e) => setScreeningDataset(e.target.value as 'default' | 'sanctions')}>
              <option value="sanctions">Dataset sanctions (alerta fuerte)</option>
              <option value="default">Dataset default (amplio)</option>
            </select>
            <input
              className="input-corporate md:col-span-2"
              placeholder="Case ID opcional para persistir nivel de riesgo"
              value={screeningCaseId}
              onChange={(e) => setScreeningCaseId(e.target.value)}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              className="btn-corporate-primary px-4"
              disabled={screeningMutation.isLoading || !partyName.trim()}
              onClick={() => screeningMutation.mutate()}
            >
              {screeningMutation.isLoading ? 'Consultando...' : 'Ejecutar screening'}
            </button>
          </div>

          {screeningResult && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${riskBadgeClass(screeningResult.risk_level)}`}>
                  Nivel {screeningResult.risk_level.toUpperCase()}
                </span>
                <span className="text-xs text-slate-600">Hits: {screeningResult.raw_count} · Alert: {screeningResult.alert ? 'Sí' : 'No'}</span>
              </div>
              <p className="text-sm text-slate-700">{screeningResult.recommended_action}</p>
              {screeningResult.hits.length > 0 && (
                <div className="text-xs text-slate-700 space-y-1">
                  {screeningResult.hits.slice(0, 3).map((h, idx) => (
                    <p key={`${h.caption || 'hit'}-${idx}`}>
                      {h.caption || 'Coincidencia'} · score: {typeof h.score === 'number' ? h.score.toFixed(3) : 'N/A'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {sarlaftSeccion === 'casos' && (
        <>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">Consultar caso por ID</h3>
          <div className="flex gap-2">
            <input className="input-corporate flex-1" placeholder="UUID del caso SARLAFT" value={caseIdLookup} onChange={(e) => setCaseIdLookup(e.target.value)} />
            <button
              className="btn-corporate-muted px-4 flex items-center gap-2"
              disabled={findMutation.isLoading}
              onClick={() => findMutation.mutate(caseIdLookup)}
            >
              <Search className="h-4 w-4" />
              Buscar
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Tip: puedes usar <strong>Ver detalle</strong> o <strong>Copiar ID</strong> desde la tabla de casos para no digitar el UUID manualmente.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">Bandeja básica SARLAFT (últimos 20)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Operación</th>
                  <th className="py-2 pr-3">Placa</th>
                  <th className="py-2 pr-3">Tipo vehículo</th>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Nombre cliente</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Riesgo</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Monto</th>
                  <th className="py-2 pr-3">Acciones</th>
                  <th className="py-2 pr-3">Creado</th>
                </tr>
              </thead>
              <tbody>
                {(casesQuery.data || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.operacion_ref}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.placa || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.tipo_vehiculo || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {(row.cliente_doc_type || '—') + (row.cliente_doc_number ? ` ${row.cliente_doc_number}` : '')}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.cliente_full_name || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.status}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(row.risk_level)}`}>
                        {row.risk_level.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{Number(row.risk_score || 0).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-slate-700">{money(row.transaction_amount_cop)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs"
                          onClick={() => {
                            setCaseIdLookup(row.id);
                            findMutation.mutate(row.id);
                          }}
                          disabled={findMutation.isLoading}
                        >
                          Ver detalle
                        </button>
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs"
                          onClick={async () => {
                            const ok = await copyTextToClipboard(row.id);
                            if (ok) {
                              setCopiedCaseId(row.id);
                              setFeedback('ID del caso copiado al portapapeles.');
                              window.setTimeout(() => {
                                setCopiedCaseId((prev) => (prev === row.id ? null : prev));
                              }, 1500);
                            } else {
                              setFeedback('No fue posible copiar el ID del caso.');
                            }
                          }}
                        >
                          {copiedCaseId === row.id ? 'Copiado' : 'Copiar ID'}
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                ))}
                {!casesQuery.isLoading && (casesQuery.data || []).length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={11}>
                      Sin casos registrados aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        {sarlaftSeccion === 'alertas' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <BellRing className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Alertas internas SARLAFT (últimas 30)</h3>
                <p className="text-xs text-slate-500">
                  Eventos generados por motor interno desde cobro/validación para seguimiento de cumplimiento.
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 md:w-auto md:items-end">
              <div className="flex w-full gap-2 md:w-auto">
                <select
                  className="input-corporate w-full md:w-52"
                  value={internalAlertLevelFilter}
                  onChange={(e) => setInternalAlertLevelFilter(e.target.value as 'todas' | 'critica' | 'media' | 'baja')}
                >
                  <option value="todas">Todas</option>
                  <option value="critica">Crítica</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
                <button
                  className="btn-corporate-muted inline-flex items-center gap-2 px-3"
                  onClick={() => internalAlertsQuery.refetch()}
                  disabled={internalAlertsQuery.isFetching}
                >
                  <RefreshCw className={`h-4 w-4 ${internalAlertsQuery.isFetching ? 'animate-spin' : ''}`} />
                  Actualizar
                </button>
              </div>
              <div className="flex w-full justify-end">
                <button
                  type="button"
                  onClick={() => setOnlyActionableAlerts((prev) => !prev)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    onlyActionableAlerts
                      ? 'border-primary-200 bg-primary-50 text-primary-800'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Solo alertas accionables: {onlyActionableAlerts ? 'ON' : 'OFF'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                {internalAlertsQuery.dataUpdatedAt
                  ? `Actualizado: ${new Date(internalAlertsQuery.dataUpdatedAt).toLocaleString('es-CO')}`
                  : 'Sin sincronización aún.'}
              </p>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total alertas</p>
              <p className="text-lg font-semibold text-slate-900">{internalAlertsKpi.total}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-rose-700">Críticas</p>
              <p className="text-lg font-semibold text-rose-800">{internalAlertsKpi.criticas}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-amber-700">Medias</p>
              <p className="text-lg font-semibold text-amber-800">{internalAlertsKpi.medias}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-rose-700">Riesgo rojo</p>
              <p className="text-lg font-semibold text-rose-800">{internalAlertsKpi.riesgoRojo}</p>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-indigo-700">Pago riesgoso</p>
              <p className="text-lg font-semibold text-indigo-800">{internalAlertsKpi.pagoRiesgoso}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Nivel alerta</th>
                  <th className="py-2 pr-3">Clasificación</th>
                  <th className="py-2 pr-3">Regla</th>
                  <th className="py-2 pr-3">Riesgo caso</th>
                  <th className="py-2 pr-3">Operación</th>
                  <th className="py-2 pr-3">Motivo</th>
                  <th className="py-2 pr-3">Pago</th>
                  <th className="py-2 pr-3">Monto</th>
                  <th className="py-2 pr-3">Efectivo</th>
                  <th className="py-2 pr-3">Decisión oficial</th>
                  <th className="py-2 pr-3">Acción</th>
                  <th className="py-2 pr-3">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {internalAlertsQuery.isLoading && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={12}>
                      Cargando alertas internas...
                    </td>
                  </tr>
                )}
                {internalAlertsRows.map((row: SarlaftInternalAlert) => (
                  <tr key={row.id} className={alertRowClass(row.alert_level)}>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${alertBadgeClass(row.alert_level)}`}>
                        {alertLevelLabel(row.alert_level)}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                        {operationClassLabel(row.operation_classification)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.rule_code || 'BASE'}</td>
                    <td className="py-2 pr-3">
                      {row.risk_level ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(row.risk_level)}`}>
                          {row.risk_level.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.operacion_ref || row.case_id || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">{alertReasonLabel(row.reason)}</td>
                    <td className="py-2 pr-3 text-slate-700 capitalize">{row.payment_method || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">{typeof row.transaction_amount_cop === 'number' ? money(row.transaction_amount_cop) : '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">{typeof row.cash_amount_cop === 'number' ? money(row.cash_amount_cop) : '—'}</td>
                    <td className="py-2 pr-3">
                      <div className="space-y-1">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {decisionStatusLabel(row.decision_status)}
                        </span>
                        {row.reviewed_at && (
                          <p className="text-[11px] text-slate-500">
                            {new Date(row.reviewed_at).toLocaleString('es-CO')}
                          </p>
                        )}
                        {row.decision_notes && (
                          <p className="max-w-[240px] truncate text-[11px] text-slate-600" title={row.decision_notes}>
                            {row.decision_notes}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-col gap-1">
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!row.case_id}
                          onClick={() => {
                            if (!row.case_id) return;
                            setCaseIdLookup(row.case_id);
                            setSarlaftSeccion('casos');
                            findMutation.mutate(row.case_id);
                          }}
                        >
                          Ver caso
                        </button>
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs disabled:opacity-50"
                          disabled={decideAlertMutation.isLoading}
                          onClick={() => {
                            setDecisionModal({ alertId: row.id });
                            setDecisionNotes('');
                            setDecisionFundsSource('');
                            setDecisionEconomicSupport('');
                            setDecisionCashierInterview('normal');
                            setDecisionSupportRefsRaw('');
                          }}
                        >
                          Evaluar alerta (DDI)
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                ))}
                {internalAlertsQuery.isError && (
                  <tr>
                    <td className="py-3 text-red-600" colSpan={12}>
                      No fue posible cargar las alertas internas. Intenta actualizar.
                    </td>
                  </tr>
                )}
                {!internalAlertsQuery.isLoading && internalAlertsRows.length === 0 && (
                  <tr>
                    <td className="py-4" colSpan={12}>
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-slate-600">
                        <p className="text-sm font-medium text-slate-800">Sin alertas internas para el filtro actual.</p>
                        <p className="mt-1 text-xs">
                          Si tienes activado <strong>Solo alertas accionables</strong>, se ocultan alertas ya decididas.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {sarlaftSeccion === 'consultas' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">
            Consultas manuales SARLAFT (últimas 20)
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Nombre</th>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Dataset</th>
                  <th className="py-2 pr-3">Riesgo</th>
                  <th className="py-2 pr-3">Hits</th>
                  <th className="py-2 pr-3">Estado cert.</th>
                  <th className="py-2 pr-3">Certificado</th>
                  <th className="py-2 pr-3">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {(manualChecksQuery.data || []).map((row) => (
                  (() => {
                    const hasCertificate = Boolean((row.certificate_code || '').trim() || row.certificate_issued_at);
                    return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 text-slate-700 capitalize">{row.subject_type}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.full_name}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {(row.doc_type || '—') + (row.doc_number ? ` ${row.doc_number}` : '')}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.dataset}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(row.risk_level)}`}>
                        {row.risk_level.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.hits_count}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${certificadoBadgeClass(hasCertificate)}`}>
                        {hasCertificate ? 'Generado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        className="btn-corporate-muted px-3 py-1 text-xs"
                        disabled={downloadingCertificateId === row.id || downloadCertificateMutation.isLoading}
                        onClick={() => downloadCertificateMutation.mutate(row.id)}
                      >
                        {downloadingCertificateId === row.id ? 'Generando...' : 'Descargar PDF'}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                    );
                  })()
                ))}
                {!manualChecksQuery.isLoading && (manualChecksQuery.data || []).length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={9}>
                      Sin consultas manuales registradas aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {decisionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="modal-panel glass-card max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-slate-200/80 p-5">
              <div className="modal-header-sticky -mx-5 mb-4 border-b border-slate-200 px-5 pb-3 pt-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Debida diligencia intensificada</p>
                    <h3 className="text-base font-semibold text-slate-900">
                      Evaluar alerta interna SARLAFT
                    </h3>
                    <p className="text-xs text-slate-500">
                      La venta no se bloquea; esta decisión exige soporte documental para trazabilidad ante auditoría.
                    </p>
                  </div>
                  <button
                    className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                    onClick={closeDecisionModal}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <textarea
                  className="input-corporate min-h-[72px]"
                  placeholder="Origen de fondos declarado por el cliente *"
                  value={decisionFundsSource}
                  onChange={(e) => setDecisionFundsSource(e.target.value)}
                />
                <textarea
                  className="input-corporate min-h-[72px]"
                  placeholder="Soporte de actividad económica presentado (RUT, contrato, etc.) *"
                  value={decisionEconomicSupport}
                  onChange={(e) => setDecisionEconomicSupport(e.target.value)}
                />
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Entrevista cajero *</label>
                  <select
                    className="input-corporate"
                    value={decisionCashierInterview}
                    onChange={(e) =>
                      setDecisionCashierInterview(
                        e.target.value as 'normal' | 'nervioso' | 'evasivo' | 'apresurado'
                      )
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="nervioso">Nervioso</option>
                    <option value="evasivo">Evasivo</option>
                    <option value="apresurado">Apresurado</option>
                  </select>
                </div>
                <textarea
                  className="input-corporate min-h-[88px]"
                  placeholder="Referencias de soportes (una por línea) *"
                  value={decisionSupportRefsRaw}
                  onChange={(e) => setDecisionSupportRefsRaw(e.target.value)}
                />
                <textarea
                  className="input-corporate min-h-[72px]"
                  placeholder="Nota del oficial (opcional)"
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                />
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button className="btn-corporate-muted px-4" onClick={closeDecisionModal}>
                  Cancelar
                </button>
                <button
                  className="btn-corporate-primary px-4 disabled:opacity-50"
                  disabled={!decisionFormValid || decideAlertMutation.isLoading}
                  onClick={() =>
                    decideAlertMutation.mutate({
                      alertId: decisionModal.alertId,
                      decision: 'justificada',
                      notes: decisionNotes || null,
                      funds_source_declaration: decisionFundsSource.trim(),
                      economic_activity_support: decisionEconomicSupport.trim(),
                      cashier_interview: decisionCashierInterview,
                      support_refs: decisionSupportRefs,
                    })
                  }
                >
                  {decideAlertMutation.isLoading ? 'Guardando...' : 'Guardar como justificada'}
                </button>
                <button
                  className="rounded-xl border border-rose-200 bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                  disabled={!decisionFormValid || decideAlertMutation.isLoading}
                  onClick={() =>
                    decideAlertMutation.mutate({
                      alertId: decisionModal.alertId,
                      decision: 'sospechosa',
                      notes: decisionNotes || null,
                      funds_source_declaration: decisionFundsSource.trim(),
                      economic_activity_support: decisionEconomicSupport.trim(),
                      cashier_interview: decisionCashierInterview,
                      support_refs: decisionSupportRefs,
                    })
                  }
                >
                  {decideAlertMutation.isLoading ? 'Guardando...' : 'Guardar como sospechosa'}
                </button>
              </div>
            </div>
          </div>
        )}

        {caseDetailModalOpen && (foundCase || createdCase) && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={closeCaseDetailModal}
          >
            <div
              className="modal-panel glass-card max-h-[90vh] w-full max-w-5xl border border-slate-200/80 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const c = foundCase || createdCase;
                if (!c) return null;
                const cliente =
                  c.parties.find((p) => (p.role || '').toLowerCase() === 'cliente') ||
                  c.parties[0] ||
                  null;
                return (
                  <>
                    <div className="modal-header-sticky -mx-0 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle de caso SARLAFT</p>
                          <h3 className="mt-1 text-lg font-semibold text-slate-900">{c.operacion_ref}</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Creado {new Date(c.created_at).toLocaleString('es-CO')}
                          </p>
                        </div>
                        <button
                          className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                          onClick={closeCaseDetailModal}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4 p-5">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Estado</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">{(c.status || 'N/D').toUpperCase()}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Riesgo</p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(c.risk_level)}`}>
                            {(c.risk_level || 'N/D').toUpperCase()}
                          </span>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Monto total</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">{money(c.transaction_amount_cop)}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Efectivo</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">{money(c.cash_amount_cop)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 p-4">
                          <h4 className="text-sm font-semibold text-slate-900">Información operativa</h4>
                          <div className="mt-3 space-y-1 text-sm text-slate-700">
                            <p><strong>ID caso:</strong> <span className="font-mono">{c.id}</span></p>
                            <p><strong>Sucursal:</strong> {c.sede_nombre || 'N/D'}</p>
                            <p><strong>Método pago:</strong> {(c.payment_method || 'N/D').replace('_', ' ')}</p>
                            <p><strong>Score:</strong> {Number(c.risk_score || 0).toFixed(2)}</p>
                            <p><strong>Vehículo ID:</strong> {c.vehiculo_id || 'N/D'}</p>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4">
                          <h4 className="text-sm font-semibold text-slate-900">Vehículo y cliente principal</h4>
                          <div className="mt-3 space-y-1 text-sm text-slate-700">
                            <p><strong>Placa:</strong> {c.placa || 'N/D'}</p>
                            <p><strong>Tipo vehículo:</strong> {c.tipo_vehiculo || 'N/D'}</p>
                            <p>
                              <strong>Documento:</strong>{' '}
                              {((c.cliente_doc_type || cliente?.doc_type || 'N/D') + ' ' + (c.cliente_doc_number || cliente?.doc_number || '')).trim()}
                            </p>
                            <p><strong>Nombre:</strong> {c.cliente_full_name || cliente?.full_name || 'N/D'}</p>
                            <p><strong>Correo:</strong> {cliente?.email || 'N/D'}</p>
                            <p><strong>Teléfono:</strong> {cliente?.phone || 'N/D'}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="text-sm font-semibold text-slate-900">Partes asociadas ({c.parties.length})</h4>
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead className="text-left text-slate-500">
                              <tr>
                                <th className="py-2 pr-3">Rol</th>
                                <th className="py-2 pr-3">Nombre</th>
                                <th className="py-2 pr-3">Documento</th>
                                <th className="py-2 pr-3">Correo</th>
                                <th className="py-2 pr-3">Teléfono</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.parties.map((p) => (
                                <tr key={p.id} className="border-t border-slate-100">
                                  <td className="py-2 pr-3 capitalize text-slate-700">{p.role}</td>
                                  <td className="py-2 pr-3 text-slate-900">{p.full_name}</td>
                                  <td className="py-2 pr-3 text-slate-700">{`${p.doc_type} ${p.doc_number}`.trim()}</td>
                                  <td className="py-2 pr-3 text-slate-700">{p.email || '—'}</td>
                                  <td className="py-2 pr-3 text-slate-700">{p.phone || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
