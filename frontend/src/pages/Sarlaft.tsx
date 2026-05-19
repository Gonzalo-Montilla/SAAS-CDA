import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BellRing, RefreshCw, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import Layout from '../components/Layout';
import { sarlaftApi } from '../api/sarlaft';
import type {
  SarlaftBatchJob,
  SarlaftBatchRow,
  SarlaftCase,
  SarlaftCasePartyInput,
  SarlaftInternalAlert,
  SarlaftManualCheck,
  SarlaftSirelQueueItem,
  SarlaftSubjectExpediente,
} from '../types';
import { useAuth } from '../contexts/AuthContext';

function money(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v || 0);
}

type SarlaftSeccion = 'resumen' | 'alertas' | 'casos' | 'consultas' | 'lotes' | 'sirel' | 'expediente' | 'screening';

const SARLAFT_SECCIONES: { id: SarlaftSeccion; label: string; hint: string }[] = [
  { id: 'resumen', label: 'Resumen', hint: 'Panorama general de alertas, casos y consultas manuales.' },
  { id: 'expediente', label: 'Expediente sujeto', hint: 'Hoja de vida SARLAFT por documento: casos, alertas, consultas y soportes.' },
  { id: 'alertas', label: 'Alertas internas', hint: 'Seguimiento del motor interno SARLAFT y severidad por operación.' },
  { id: 'casos', label: 'Casos', hint: 'Creación, búsqueda y bandeja de casos SARLAFT.' },
  { id: 'consultas', label: 'Consultas manuales', hint: 'Consultas fuera de recepción con trazabilidad y certificado.' },
  { id: 'lotes', label: 'Consulta por lotes', hint: 'Carga CSV, ejecución masiva y resultados consolidados SARLAFT.' },
  { id: 'sirel', label: 'SIREL/UIAF', hint: 'Bandeja de casos para reporte ROS y trazabilidad de radicado SIREL.' },
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
    source_labels: string[];
    source_coverage?: {
      colombia?: boolean;
      onu?: boolean;
      ofac?: boolean;
      europea?: boolean;
      otras?: boolean;
    };
    hits: Array<{ caption?: string; score?: number; source_url?: string }>;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createdCase, setCreatedCase] = useState<SarlaftCase | null>(null);
  const [foundCase, setFoundCase] = useState<SarlaftCase | null>(null);
  const [createdManualCheck, setCreatedManualCheck] = useState<SarlaftManualCheck | null>(null);
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
  const [decisionCustomerProfile, setDecisionCustomerProfile] = useState('');
  const [decisionOperationJustification, setDecisionOperationJustification] = useState('');
  const [decisionRelationshipWithAssets, setDecisionRelationshipWithAssets] = useState('');
  const [decisionActsOnBehalf, setDecisionActsOnBehalf] = useState<'propia' | 'tercero'>('propia');
  const [decisionPepStatus, setDecisionPepStatus] = useState<'si' | 'no' | 'no_informado'>('no_informado');
  const [decisionPaymentConsistency, setDecisionPaymentConsistency] = useState<'coherente' | 'incoherente' | 'no_aplica'>('no_aplica');
  const [decisionCashierInterview, setDecisionCashierInterview] = useState<'normal' | 'nervioso' | 'evasivo' | 'apresurado'>('normal');
  const [decisionUnusualSignals, setDecisionUnusualSignals] = useState<
    Array<'urgencia' | 'inconsistencia_documental' | 'negativa_informacion' | 'patron_repetitivo' | 'otro'>
  >([]);
  const [decisionSupportRefsRaw, setDecisionSupportRefsRaw] = useState('');
  const [decisionOfficialConclusion, setDecisionOfficialConclusion] = useState('');
  const [decisionFollowUpRequired, setDecisionFollowUpRequired] = useState(false);
  const [decisionFollowUpDate, setDecisionFollowUpDate] = useState('');
  const [internalAlertsPage, setInternalAlertsPage] = useState(1);
  const [internalAlertsPageSize, setInternalAlertsPageSize] = useState(10);
  const [sirelStatusFilter, setSirelStatusFilter] = useState<'all' | 'pending' | 'reported'>('pending');
  const [sirelModal, setSirelModal] = useState<{
    caseId: string;
    operacionRef: string;
    preRosText: string;
  } | null>(null);
  const [sirelReference, setSirelReference] = useState('');
  const [sirelNotes, setSirelNotes] = useState('');
  const [sirelEvidenceUrl, setSirelEvidenceUrl] = useState('');
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualViewMode, setManualViewMode] = useState<'operativo' | 'completo'>('operativo');
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchDataset, setBatchDataset] = useState<'default' | 'sanctions'>('sanctions');
  const [selectedBatchJobId, setSelectedBatchJobId] = useState<string | null>(null);
  const [expedienteDocType, setExpedienteDocType] = useState('CC');
  const [expedienteDocNumber, setExpedienteDocNumber] = useState('');
  const [expedienteData, setExpedienteData] = useState<SarlaftSubjectExpediente | null>(null);
  const [previewingCertificateId, setPreviewingCertificateId] = useState<string | null>(null);
  const [certificatePreviewModal, setCertificatePreviewModal] = useState<{
    manualCheckId: string;
    filename: string;
    url: string;
  } | null>(null);

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
    if (sarlaftSeccion !== 'expediente') {
      setExpedienteDocNumber('');
      setExpedienteData(null);
    }
  }, [sarlaftSeccion]);

  useEffect(() => {
    return () => {
      if (certificatePreviewModal?.url) {
        window.URL.revokeObjectURL(certificatePreviewModal.url);
      }
    };
  }, [certificatePreviewModal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(actionableAlertsStorageKey, onlyActionableAlerts ? '1' : '0');
  }, [actionableAlertsStorageKey, onlyActionableAlerts]);
  const internalAlertsPageStorageKey = useMemo(
    () => `sarlaft-internal-alerts-page:${user?.id || user?.email || 'anon'}`,
    [user?.id, user?.email]
  );
  const internalAlertsPageSizeStorageKey = useMemo(
    () => `sarlaft-internal-alerts-page-size:${user?.id || user?.email || 'anon'}`,
    [user?.id, user?.email]
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawPage = window.localStorage.getItem(internalAlertsPageStorageKey);
    const rawSize = window.localStorage.getItem(internalAlertsPageSizeStorageKey);
    const parsedPage = Number(rawPage || 1);
    const parsedSize = Number(rawSize || 10);
    if (Number.isFinite(parsedPage) && parsedPage >= 1) setInternalAlertsPage(Math.floor(parsedPage));
    if (Number.isFinite(parsedSize) && [10, 20, 50].includes(Math.floor(parsedSize))) {
      setInternalAlertsPageSize(Math.floor(parsedSize));
    }
  }, [internalAlertsPageStorageKey, internalAlertsPageSizeStorageKey]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(internalAlertsPageStorageKey, String(internalAlertsPage));
  }, [internalAlertsPage, internalAlertsPageStorageKey]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(internalAlertsPageSizeStorageKey, String(internalAlertsPageSize));
  }, [internalAlertsPageSize, internalAlertsPageSizeStorageKey]);

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
    setDecisionCustomerProfile('');
    setDecisionOperationJustification('');
    setDecisionRelationshipWithAssets('');
    setDecisionActsOnBehalf('propia');
    setDecisionPepStatus('no_informado');
    setDecisionPaymentConsistency('no_aplica');
    setDecisionCashierInterview('normal');
    setDecisionUnusualSignals([]);
    setDecisionSupportRefsRaw('');
    setDecisionOfficialConclusion('');
    setDecisionFollowUpRequired(false);
    setDecisionFollowUpDate('');
  };
  const closeSirelModal = (): void => {
    setSirelModal(null);
    setSirelReference('');
    setSirelNotes('');
    setSirelEvidenceUrl('');
  };
  const closeCertificatePreviewModal = (): void => {
    setCertificatePreviewModal((prev) => {
      if (prev?.url) window.URL.revokeObjectURL(prev.url);
      return null;
    });
  };
  const closeManualModal = (): void => {
    setManualModalOpen(false);
  };
  const manualDocPath = useMemo(
    () =>
      manualViewMode === 'operativo'
        ? '/manuales/sarlaft-modulo-operativo.html'
        : '/manuales/sarlaft-modulo.html',
    [manualViewMode]
  );

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
  const sirelQueueQuery = useQuery({
    queryKey: ['sarlaft-sirel-queue', sirelStatusFilter, 80],
    queryFn: async () => sarlaftApi.listSirelQueue({ status: sirelStatusFilter, limit: 80 }),
  });
  const batchJobsQuery = useQuery({
    queryKey: ['sarlaft-batch-jobs', 20],
    queryFn: async () => sarlaftApi.listBatchJobs({ limit: 20 }),
  });
  const batchRowsQuery = useQuery({
    queryKey: ['sarlaft-batch-rows', selectedBatchJobId],
    queryFn: async () => sarlaftApi.listBatchRows(selectedBatchJobId as string, { limit: 1000 }),
    enabled: Boolean(selectedBatchJobId),
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
      setScreeningDataset('default');
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
        source_labels: data.source_labels || [],
        source_coverage: data.source_coverage || {},
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

  const previewCertificateMutation = useMutation({
    mutationFn: async (manualCheckId: string) => sarlaftApi.downloadManualCheckCertificate(manualCheckId),
    onMutate: (manualCheckId) => {
      setPreviewingCertificateId(manualCheckId);
    },
    onSuccess: ({ blob, filename }, manualCheckId) => {
      const url = window.URL.createObjectURL(blob);
      setCertificatePreviewModal((prev) => {
        if (prev?.url) window.URL.revokeObjectURL(prev.url);
        return {
          manualCheckId,
          filename,
          url,
        };
      });
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No se pudo previsualizar el certificado SARLAFT.');
    },
    onSettled: () => {
      setPreviewingCertificateId(null);
    },
  });
  const decideAlertMutation = useMutation({
    mutationFn: async (payload: {
      alertId: string;
      decision: 'justificada' | 'sospechosa';
      notes?: string | null;
      funds_source_declaration: string;
      economic_activity_support: string;
      customer_profile: string;
      operation_justification: string;
      relationship_with_assets: string;
      acts_on_behalf: 'propia' | 'tercero';
      pep_status: 'si' | 'no' | 'no_informado';
      payment_profile_consistency: 'coherente' | 'incoherente' | 'no_aplica';
      cashier_interview: 'normal' | 'nervioso' | 'evasivo' | 'apresurado';
      unusual_signals: Array<'urgencia' | 'inconsistencia_documental' | 'negativa_informacion' | 'patron_repetitivo' | 'otro'>;
      support_refs: string[];
      official_conclusion: string;
      follow_up_required: boolean;
      follow_up_date?: string | null;
    }) =>
      sarlaftApi.decideInternalAlert(payload.alertId, {
        decision: payload.decision,
        notes: payload.notes || null,
        funds_source_declaration: payload.funds_source_declaration,
        economic_activity_support: payload.economic_activity_support,
        customer_profile: payload.customer_profile,
        operation_justification: payload.operation_justification,
        relationship_with_assets: payload.relationship_with_assets,
        acts_on_behalf: payload.acts_on_behalf,
        pep_status: payload.pep_status,
        payment_profile_consistency: payload.payment_profile_consistency,
        cashier_interview: payload.cashier_interview,
        unusual_signals: payload.unusual_signals,
        support_refs: payload.support_refs,
        official_conclusion: payload.official_conclusion,
        follow_up_required: payload.follow_up_required,
        follow_up_date: payload.follow_up_date || null,
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
  const createCaseFromAlertMutation = useMutation({
    mutationFn: async (alertId: string) => sarlaftApi.createCaseFromInternalAlert(alertId),
    onSuccess: (data) => {
      setFeedback(`Caso creado desde alerta interna: ${data.operacion_ref}`);
      setCaseIdLookup(data.id);
      internalAlertsQuery.refetch();
      casesQuery.refetch();
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible crear el caso desde la alerta.');
    },
  });
  const subjectExpedienteMutation = useMutation({
    mutationFn: async () =>
      sarlaftApi.getSubjectExpediente({
        doc_number: expedienteDocNumber.trim(),
        doc_type: expedienteDocType.trim() || undefined,
      }),
    onSuccess: (data) => {
      setExpedienteData(data);
      setFeedback('Expediente SARLAFT cargado correctamente.');
    },
    onError: (err: any) => {
      setExpedienteData(null);
      setFeedback(err?.response?.data?.detail || 'No fue posible consultar el expediente del sujeto.');
    },
  });
  const markSirelReportedMutation = useMutation({
    mutationFn: async (payload: {
      caseId: string;
      sirel_reference: string;
      notes?: string | null;
      evidence_url: string;
    }) =>
      sarlaftApi.markSirelReported(payload.caseId, {
        sirel_reference: payload.sirel_reference,
        notes: payload.notes || null,
        evidence_url: payload.evidence_url,
      }),
    onSuccess: () => {
      setFeedback('Caso marcado como reportado en SIREL/UIAF.');
      closeSirelModal();
      sirelQueueQuery.refetch();
      casesQuery.refetch();
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible marcar el reporte SIREL.');
    },
  });
  const downloadSirelPreRosMutation = useMutation({
    mutationFn: async (caseId: string) => sarlaftApi.downloadSirelPreRosTxt(caseId),
    onSuccess: ({ blob, filename }) => {
      saveBlobAsFile(blob, filename);
      setFeedback('Pre-ROS descargado en TXT.');
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible descargar el pre-ROS.');
    },
  });
  const downloadSirelExpedienteTemplateMutation = useMutation({
    mutationFn: async (caseId: string) => sarlaftApi.downloadSirelExpedienteTemplateTxt(caseId),
    onSuccess: ({ blob, filename }) => {
      saveBlobAsFile(blob, filename);
      setFeedback('Plantilla de expediente ROS descargada.');
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible descargar la plantilla de expediente ROS.');
    },
  });
  const downloadSirelExpedienteTemplatePdfMutation = useMutation({
    mutationFn: async (caseId: string) => sarlaftApi.downloadSirelExpedienteTemplatePdf(caseId),
    onSuccess: ({ blob, filename }) => {
      saveBlobAsFile(blob, filename);
      setFeedback('Plantilla de expediente ROS en PDF descargada.');
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible descargar la plantilla de expediente ROS en PDF.');
    },
  });
  const downloadBatchTemplateMutation = useMutation({
    mutationFn: async () => sarlaftApi.downloadBatchTemplateCsv(),
    onSuccess: ({ blob, filename }) => {
      saveBlobAsFile(blob, filename);
      setFeedback('Plantilla de lote descargada.');
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible descargar la plantilla de lote.');
    },
  });
  const createBatchJobMutation = useMutation({
    mutationFn: async () => {
      if (!batchFile) throw new Error('Selecciona un archivo CSV para procesar.');
      return sarlaftApi.createBatchJob({ file: batchFile, dataset: batchDataset });
    },
    onSuccess: (job) => {
      setFeedback(`Lote procesado: ${job.processed_records}/${job.total_records} registros.`);
      setBatchFile(null);
      setSelectedBatchJobId(job.id);
      batchJobsQuery.refetch();
      manualChecksQuery.refetch();
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || err?.message || 'No fue posible ejecutar el lote.');
    },
  });
  const downloadBatchRowsCsvMutation = useMutation({
    mutationFn: async (jobId: string) => sarlaftApi.downloadBatchRowsCsv(jobId),
    onSuccess: ({ blob, filename }) => {
      saveBlobAsFile(blob, filename);
      setFeedback('Resultado del lote descargado en CSV.');
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No fue posible descargar el resultado del lote.');
    },
  });
  const sirelAgingKpi = useMemo(() => {
    const rows = (sirelQueueQuery.data || []).filter((r) => r.sirel_status === 'pendiente_envio');
    const now = Date.now();
    const ageDays = rows.map((r) => {
      const base = new Date(r.created_at).getTime();
      if (!base || Number.isNaN(base)) return 0;
      return Math.max(0, Math.floor((now - base) / (1000 * 60 * 60 * 24)));
    });
    const mayores3 = ageDays.filter((d) => d >= 3).length;
    const mayores7 = ageDays.filter((d) => d >= 7).length;
    const maxAge = ageDays.length > 0 ? Math.max(...ageDays) : 0;
    const reportedRows = (sirelQueueQuery.data || []).filter((r) => r.sirel_status === 'reportado' && r.sirel_sent_at);
    const promedioReporteDias =
      reportedRows.length > 0
        ? reportedRows.reduce((acc, r) => {
            const created = new Date(r.created_at).getTime();
            const sent = new Date(r.sirel_sent_at || '').getTime();
            if (!created || !sent || Number.isNaN(created) || Number.isNaN(sent) || sent < created) return acc;
            return acc + (sent - created) / (1000 * 60 * 60 * 24);
          }, 0) / reportedRows.length
        : 0;
    return {
      pendientes: rows.length,
      mayores3,
      mayores7,
      maxAge,
      promedioReporteDias,
    };
  }, [sirelQueueQuery.data]);
  const sirelReferenceNormalized = useMemo(() => sirelReference.trim().toUpperCase(), [sirelReference]);
  const sirelReferenceValid = useMemo(
    () => /^[A-Z0-9][A-Z0-9\-_\/]{5,119}$/.test(sirelReferenceNormalized),
    [sirelReferenceNormalized]
  );
  const sirelEvidenceNormalized = useMemo(() => sirelEvidenceUrl.trim(), [sirelEvidenceUrl]);
  const sirelEvidenceValid = useMemo(
    () => /^https?:\/\//i.test(sirelEvidenceNormalized),
    [sirelEvidenceNormalized]
  );

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
  const internalAlertsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(internalAlertsRows.length / internalAlertsPageSize)),
    [internalAlertsRows.length, internalAlertsPageSize]
  );
  const internalAlertsRowsPage = useMemo(() => {
    const start = (internalAlertsPage - 1) * internalAlertsPageSize;
    return internalAlertsRows.slice(start, start + internalAlertsPageSize);
  }, [internalAlertsRows, internalAlertsPage]);
  useEffect(() => {
    if (internalAlertsPage > internalAlertsTotalPages) {
      setInternalAlertsPage(internalAlertsTotalPages);
    }
  }, [internalAlertsPage, internalAlertsTotalPages]);
  useEffect(() => {
    setInternalAlertsPage(1);
  }, [internalAlertLevelFilter, onlyActionableAlerts]);
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
  const sourceOriginLabel = useMemo(
    () => (origin?: string | null) => {
      const v = (origin || '').trim().toLowerCase();
      if (v === 'manual') return 'MANUAL';
      if (v === 'lote') return 'LOTE';
      return 'CASO';
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
  const decisionFormBaseValid = useMemo(
    () =>
      Boolean(
        decisionFundsSource.trim() &&
          decisionEconomicSupport.trim() &&
          decisionCustomerProfile.trim() &&
          decisionOperationJustification.trim() &&
          decisionRelationshipWithAssets.trim() &&
          decisionActsOnBehalf &&
          decisionPepStatus &&
          decisionPaymentConsistency &&
          decisionCashierInterview &&
          decisionSupportRefs.length >= 1 &&
          decisionOfficialConclusion.trim().length >= 10 &&
          (!decisionFollowUpRequired || decisionFollowUpDate)
      ),
    [
      decisionFundsSource,
      decisionEconomicSupport,
      decisionCustomerProfile,
      decisionOperationJustification,
      decisionRelationshipWithAssets,
      decisionActsOnBehalf,
      decisionPepStatus,
      decisionPaymentConsistency,
      decisionCashierInterview,
      decisionSupportRefs.length,
      decisionOfficialConclusion,
      decisionFollowUpRequired,
      decisionFollowUpDate,
    ],
  );
  const decisionFormSospechosaValid = useMemo(
    () => decisionFormBaseValid && decisionSupportRefs.length >= 2,
    [decisionFormBaseValid, decisionSupportRefs.length],
  );
  const decisionFormValid = useMemo(
    () => decisionFormBaseValid,
    [decisionFormBaseValid],
  );
  const alertRowClass = useMemo(
    () => (level: string) => {
      if (level === 'critica' || level === 'alta') return 'border-t border-l-4 border-l-rose-400 border-slate-100 bg-rose-50/40';
      if (level === 'media') return 'border-t border-l-4 border-l-amber-400 border-slate-100 bg-amber-50/30';
      return 'border-t border-slate-100';
    },
    [],
  );
  const batchRowStatusLabel = useMemo(
    () => (status: string) => {
      const v = (status || '').trim().toLowerCase();
      if (v === 'ok') return 'Procesado';
      if (v === 'error') return 'Error';
      if (v === 'pending') return 'Pendiente';
      return status || 'N/D';
    },
    [],
  );
  const batchJobStatusLabel = useMemo(
    () => (status: string) => {
      const v = (status || '').trim().toLowerCase();
      if (v === 'completed') return 'Finalizado';
      if (v === 'completed_with_errors') return 'Finalizado con errores';
      if (v === 'processing') return 'Procesando';
      if (v === 'queued') return 'En cola';
      return status || 'N/D';
    },
    [],
  );
  const resumenKpi = useMemo(
    () => ({
      alertasInternas: internalAlertsKpi.total,
      casosRegistrados: (casesQuery.data || []).length,
      consultasManuales: (manualChecksQuery.data || []).length,
      alertasCriticas: internalAlertsKpi.criticas,
      sirelPendientes: (sirelQueueQuery.data || []).filter((x) => x.sirel_status === 'pendiente_envio').length,
    }),
    [internalAlertsKpi, casesQuery.data, manualChecksQuery.data, sirelQueueQuery.data],
  );
  const lotesConErrores = useMemo(
    () => (batchJobsQuery.data || []).filter((j) => (j.error_records || 0) > 0).length,
    [batchJobsQuery.data]
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
              <button
                type="button"
                className="btn-corporate-muted px-3 py-1 text-xs"
                onClick={() => setManualModalOpen(true)}
              >
                Manual de uso
              </button>
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
                  <span className="inline-flex items-center gap-1.5">
                    {s.label}
                    {s.id === 'lotes' && lotesConErrores > 0 && (
                      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                        {lotesConErrores}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="border-t border-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 sm:px-4">{seccionHint}</p>
        </div>

        {feedback && <p className="text-sm text-slate-700">{feedback}</p>}

        {sarlaftSeccion === 'resumen' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
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
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                <p className="text-xs text-indigo-700">SIREL pendientes</p>
                <p className="mt-1 text-2xl font-semibold text-indigo-800">{resumenKpi.sirelPendientes}</p>
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
                <button className="btn-corporate-muted px-3 py-1.5 text-xs" onClick={() => setSarlaftSeccion('lotes')}>
                  Ejecutar consulta por lotes
                </button>
                <button className="btn-corporate-muted px-3 py-1.5 text-xs" onClick={() => setSarlaftSeccion('sirel')}>
                  Gestionar reporte SIREL
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
              <option value="sanctions">sanctions (fuerte)</option>
              <option value="default">default (comun)</option>
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
              <option value="default">Dataset default (comun para recepcion/cobro)</option>
              <option value="sanctions">Dataset sanctions (fuerte para analisis)</option>
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
              <div className="flex flex-wrap gap-1">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${screeningResult.source_coverage?.colombia ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}>
                  Colombia {screeningResult.source_coverage?.colombia ? 'Si' : 'No'}
                </span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${screeningResult.source_coverage?.onu ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}>
                  ONU {screeningResult.source_coverage?.onu ? 'Si' : 'No'}
                </span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${screeningResult.source_coverage?.ofac ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}>
                  OFAC {screeningResult.source_coverage?.ofac ? 'Si' : 'No'}
                </span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${screeningResult.source_coverage?.europea ? 'border border-indigo-200 bg-indigo-50 text-indigo-800' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}>
                  Europea {screeningResult.source_coverage?.europea ? 'Si' : 'No'}
                </span>
              </div>
              {screeningResult.source_labels.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  Fuentes: {screeningResult.source_labels.slice(0, 4).join(' · ')}
                </p>
              )}
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

        {sarlaftSeccion === 'expediente' && (
        <>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">Expediente SARLAFT por documento</h3>
          <div className="grid gap-2 md:grid-cols-[170px_minmax(0,1fr)_auto]">
            <select
              className="input-corporate"
              value={expedienteDocType}
              onChange={(e) => setExpedienteDocType(e.target.value)}
            >
              {['CC', 'CE', 'NIT', 'PAS', 'TI'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className="input-corporate"
              placeholder="Número de documento"
              value={expedienteDocNumber}
              onChange={(e) => setExpedienteDocNumber(e.target.value)}
            />
            <button
              className="btn-corporate-primary px-4 flex items-center gap-2"
              disabled={subjectExpedienteMutation.isLoading || !expedienteDocNumber.trim()}
              onClick={() => subjectExpedienteMutation.mutate()}
            >
              <Search className="h-4 w-4" />
              {subjectExpedienteMutation.isLoading ? 'Consultando...' : 'Consultar expediente'}
            </button>
          </div>
        </div>

        {expedienteData && (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documento</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {(expedienteData.doc_type || expedienteDocType) + ' ' + expedienteData.doc_number}
                </span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(expedienteData.current_risk_level || 'verde')}`}>
                  Riesgo actual {(expedienteData.current_risk_level || 'N/D').toUpperCase()}
                </span>
              </div>
              {expedienteData.full_names.length > 0 && (
                <p className="mt-2 text-sm text-slate-700">
                  Nombres registrados: <strong>{expedienteData.full_names.slice(0, 3).join(' · ')}</strong>
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Casos: {expedienteData.cases.length} · Consultas manuales: {expedienteData.manual_checks.length} · Alertas: {expedienteData.alerts.length} · Documentos: {expedienteData.documents.length}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-slate-900 mb-2">Casos SARLAFT</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Operación</th>
                      <th className="py-2 pr-3">Riesgo</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Placa</th>
                      <th className="py-2 pr-3">Monto</th>
                      <th className="py-2 pr-3">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expedienteData.cases.map((c) => (
                      <tr key={c.case_id} className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-medium text-slate-800">{c.operacion_ref}</td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${riskBadgeClass(c.risk_level)}`}>{c.risk_level.toUpperCase()}</span>
                        </td>
                        <td className="py-2 pr-3 text-slate-700">{c.status}</td>
                        <td className="py-2 pr-3 text-slate-700">{c.placa || '—'}</td>
                        <td className="py-2 pr-3 text-slate-700">{money(c.transaction_amount_cop)}</td>
                        <td className="py-2 pr-3 text-slate-500">{new Date(c.created_at).toLocaleString('es-CO')}</td>
                      </tr>
                    ))}
                    {expedienteData.cases.length === 0 && (
                      <tr><td className="py-2 text-slate-500" colSpan={6}>Sin casos vinculados.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h4 className="text-sm font-semibold text-slate-900 mb-2">Consultas manuales</h4>
                <div className="space-y-2">
                  {expedienteData.manual_checks.map((m) => (
                    <div key={m.manual_check_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                            {m.dataset.toUpperCase()}
                          </span>
                          <p className="font-semibold text-slate-800">{m.full_name}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${riskBadgeClass(m.risk_level)}`}>{m.risk_level.toUpperCase()}</span>
                      </div>
                      <p className="mt-1 text-slate-600">
                        Hits: {m.hits_count} · Score: {Number(m.risk_score || 0).toFixed(2)} · {new Date(m.created_at).toLocaleString('es-CO')}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.certificate_code ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-amber-200 bg-amber-50 text-amber-800'}`}>
                          Certificado {m.certificate_code ? 'Generado' : 'Pendiente'}
                        </span>
                        {m.certificate_code && (
                          <button
                            className="btn-corporate-muted px-2 py-0.5 text-[11px]"
                            disabled={previewCertificateMutation.isLoading || previewingCertificateId === m.manual_check_id}
                            onClick={() => previewCertificateMutation.mutate(m.manual_check_id)}
                          >
                            {previewingCertificateId === m.manual_check_id ? 'Abriendo...' : 'Previsualizar PDF'}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-2">
                        {(() => {
                          type CoverageKey = 'colombia' | 'ofac' | 'onu' | 'europea';
                          const badges: Array<{ key: CoverageKey; label: string; on: boolean; activeClass: string }> = [
                            { key: 'colombia', label: 'Colombia', on: Boolean(m.source_coverage?.colombia), activeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800' },
                            { key: 'ofac', label: 'OFAC', on: Boolean(m.source_coverage?.ofac), activeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800' },
                            { key: 'onu', label: 'ONU', on: Boolean(m.source_coverage?.onu), activeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800' },
                            { key: 'europea', label: 'Unión Europea', on: Boolean(m.source_coverage?.europea), activeClass: 'border border-indigo-200 bg-indigo-50 text-indigo-800' },
                          ];
                          const priority: Record<CoverageKey, number> = { colombia: 0, ofac: 1, onu: 2, europea: 3 };
                          const sortedBadges = badges.sort((a, b) => {
                            if (a.on !== b.on) return a.on ? -1 : 1;
                            return priority[a.key] - priority[b.key];
                          });
                          const positiveCount = sortedBadges.filter((b) => b.on).length;
                          return (
                            <>
                              <div className="mb-2 flex items-center justify-between">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Cobertura de listas
                                </p>
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                  {positiveCount}/4 con match
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {sortedBadges.map((badge) => (
                                  <span
                                    key={badge.key}
                                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                      badge.on ? badge.activeClass : 'border border-slate-200 bg-slate-50 text-slate-600'
                                    }`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        badge.on ? 'bg-current' : 'bg-slate-400'
                                      }`}
                                    />
                                    <span>{badge.label}</span>
                                    <span className="opacity-80">{badge.on ? 'Sí' : 'No'}</span>
                                  </span>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                  {expedienteData.manual_checks.length === 0 && <p className="text-xs text-slate-500">Sin consultas manuales.</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h4 className="text-sm font-semibold text-slate-900 mb-2">Alertas internas</h4>
                <div className="space-y-2">
                  {expedienteData.alerts.map((a) => (
                    <div key={a.alert_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-800">{(a.source_origin || 'caso').toUpperCase()} · {(a.rule_code || 'BASE')}</p>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700">{a.alert_level}</span>
                      </div>
                      <p className="mt-1 text-slate-600">{a.reason || 'Sin motivo específico.'}</p>
                      <p className="mt-1 text-slate-500">Decisión: {decisionStatusLabel(a.decision_status)} · {new Date(a.created_at).toLocaleString('es-CO')}</p>
                    </div>
                  ))}
                  {expedienteData.alerts.length === 0 && <p className="text-xs text-slate-500">Sin alertas internas.</p>}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-slate-900 mb-2">Documentos y evidencias</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Tipo</th>
                      <th className="py-2 pr-3">Título</th>
                      <th className="py-2 pr-3">Referencia</th>
                      <th className="py-2 pr-3">Evidencia</th>
                      <th className="py-2 pr-3">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expedienteData.documents.map((d, idx) => (
                      <tr key={`${d.kind}-${d.reference_id || idx}`} className="border-t border-slate-100">
                        <td className="py-2 pr-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            d.kind === 'certificado_manual'
                              ? 'border border-indigo-200 bg-indigo-50 text-indigo-800'
                              : 'border border-slate-200 bg-slate-50 text-slate-700'
                          }`}>
                            {d.kind === 'certificado_manual' ? 'Certificado manual' : d.kind === 'sirel_reporte' ? 'Reporte SIREL' : d.kind}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-slate-800">{d.title}</td>
                        <td className="py-2 pr-3">
                          <span className="font-mono text-[11px] text-slate-600">{d.reference_id || d.notes || '—'}</span>
                        </td>
                        <td className="py-2 pr-3 text-slate-700">
                          {d.kind === 'certificado_manual' && d.reference_id ? (
                            <button
                              className="btn-corporate-muted px-2 py-0.5 text-[11px]"
                              disabled={previewCertificateMutation.isLoading || previewingCertificateId === d.reference_id}
                              onClick={() => previewCertificateMutation.mutate(d.reference_id as string)}
                            >
                              {previewingCertificateId === d.reference_id ? 'Abriendo...' : 'Previsualizar PDF'}
                            </button>
                          ) : d.url ? (
                            <a className="text-indigo-700 underline" href={d.url} target="_blank" rel="noreferrer">
                              Abrir enlace
                            </a>
                          ) : (
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                              N/D
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-slate-500">{new Date(d.created_at).toLocaleString('es-CO')}</td>
                      </tr>
                    ))}
                    {expedienteData.documents.length === 0 && <tr><td className="py-2 text-slate-500" colSpan={5}>Sin documentos asociados.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
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
                  <th className="py-2 pr-3">Origen</th>
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
                    <td className="py-3 text-slate-500" colSpan={13}>
                      Cargando alertas internas...
                    </td>
                  </tr>
                )}
                {internalAlertsRowsPage.map((row: SarlaftInternalAlert) => (
                  <tr key={row.id} className={alertRowClass(row.alert_level)}>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${alertBadgeClass(row.alert_level)}`}>
                        {alertLevelLabel(row.alert_level)}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {sourceOriginLabel(row.source_origin)}
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
                    <td className="py-2 pr-3 sticky right-0 z-10 bg-white">
                      <div className="flex flex-col gap-1">
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!row.case_id}
                          onClick={() => {
                            if (!row.case_id) return;
                            setCaseIdLookup(row.case_id);
                            findMutation.mutate(row.case_id);
                          }}
                        >
                          Ver caso
                        </button>
                        {(row.source_origin || 'caso').toLowerCase() !== 'caso' && !row.case_id && (
                          <button
                            className="btn-corporate-muted px-2.5 py-1 text-xs disabled:opacity-50"
                            disabled={createCaseFromAlertMutation.isLoading}
                            onClick={() => createCaseFromAlertMutation.mutate(row.id)}
                          >
                            Crear caso
                          </button>
                        )}
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs disabled:opacity-50"
                          disabled={decideAlertMutation.isLoading || !row.case_id}
                          onClick={() => {
                            setDecisionModal({ alertId: row.id });
                            setDecisionNotes('');
                            setDecisionFundsSource('');
                            setDecisionEconomicSupport('');
                            setDecisionCustomerProfile('');
                            setDecisionOperationJustification('');
                            setDecisionRelationshipWithAssets('');
                            setDecisionActsOnBehalf('propia');
                            setDecisionPepStatus('no_informado');
                            setDecisionPaymentConsistency('no_aplica');
                            setDecisionCashierInterview('normal');
                            setDecisionUnusualSignals([]);
                            setDecisionSupportRefsRaw('');
                            setDecisionOfficialConclusion('');
                            setDecisionFollowUpRequired(false);
                            setDecisionFollowUpDate('');
                          }}
                        >
                          {row.case_id ? 'Evaluar alerta (DDI)' : 'Solo trazabilidad'}
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                ))}
                {internalAlertsQuery.isError && (
                  <tr>
                    <td className="py-3 text-red-600" colSpan={13}>
                      No fue posible cargar las alertas internas. Intenta actualizar.
                    </td>
                  </tr>
                )}
                {!internalAlertsQuery.isLoading && internalAlertsRows.length === 0 && (
                  <tr>
                    <td className="py-4" colSpan={13}>
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
          {internalAlertsRows.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Mostrando {(internalAlertsPage - 1) * internalAlertsPageSize + 1}
                {' - '}
                {Math.min(internalAlertsPage * internalAlertsPageSize, internalAlertsRows.length)}
                {' de '}
                {internalAlertsRows.length} alertas
              </p>
              <div className="flex items-center gap-2">
                <select
                  className="input-corporate h-8 w-[90px] py-0 text-xs"
                  value={internalAlertsPageSize}
                  onChange={(e) => {
                    const size = Number(e.target.value || 10);
                    setInternalAlertsPageSize(size);
                    setInternalAlertsPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <button
                  className="btn-corporate-muted px-2.5 py-1 text-xs disabled:opacity-50"
                  onClick={() => setInternalAlertsPage((p) => Math.max(1, p - 1))}
                  disabled={internalAlertsPage <= 1}
                >
                  Anterior
                </button>
                <span className="text-xs font-semibold text-slate-700">
                  Pagina {internalAlertsPage} / {internalAlertsTotalPages}
                </span>
                <button
                  className="btn-corporate-muted px-2.5 py-1 text-xs disabled:opacity-50"
                  onClick={() => setInternalAlertsPage((p) => Math.min(internalAlertsTotalPages, p + 1))}
                  disabled={internalAlertsPage >= internalAlertsTotalPages}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        {sarlaftSeccion === 'sirel' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Bandeja SIREL/UIAF (ROS)</h3>
              <p className="text-xs text-slate-500">
                Casos sospechosos para radicar en portal SIREL. El sistema genera pre-ROS y guarda evidencia de envío.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Flujo recomendado: copiar/descargar pre-ROS {'->'} radicar en SIREL {'->'} registrar radicado y URL de evidencia.
              </p>
            </div>
            <div className="flex gap-2">
              <select
                className="input-corporate"
                value={sirelStatusFilter}
                onChange={(e) => setSirelStatusFilter(e.target.value as 'all' | 'pending' | 'reported')}
              >
                <option value="pending">Pendientes</option>
                <option value="reported">Reportados</option>
                <option value="all">Todos</option>
              </select>
              <button
                className="btn-corporate-muted inline-flex items-center gap-2 px-3"
                onClick={() => sirelQueueQuery.refetch()}
                disabled={sirelQueueQuery.isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${sirelQueueQuery.isFetching ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Pendientes ROS</p>
              <p className="text-lg font-semibold text-slate-900">{sirelAgingKpi.pendientes}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-amber-700">Antigüedad {'>='} 3 días</p>
              <p className="text-lg font-semibold text-amber-800">{sirelAgingKpi.mayores3}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-rose-700">Antigüedad {'>='} 7 días</p>
              <p className="text-lg font-semibold text-rose-800">{sirelAgingKpi.mayores7}</p>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-indigo-700">Máxima antigüedad</p>
              <p className="text-lg font-semibold text-indigo-800">{sirelAgingKpi.maxAge} días</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-emerald-700">Promedio reporte</p>
              <p className="text-lg font-semibold text-emerald-800">
                {sirelAgingKpi.promedioReporteDias > 0 ? sirelAgingKpi.promedioReporteDias.toFixed(1) : '0.0'} días
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Operación</th>
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Clasificación</th>
                  <th className="py-2 pr-3">Estado caso</th>
                  <th className="py-2 pr-3">Estado SIREL</th>
                  <th className="py-2 pr-3">Radicado</th>
                  <th className="py-2 pr-3">Monto</th>
                  <th className="py-2 pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sirelQueueQuery.isLoading && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={9}>
                      Cargando bandeja SIREL...
                    </td>
                  </tr>
                )}
                {(sirelQueueQuery.data || []).map((row: SarlaftSirelQueueItem) => (
                  <tr key={row.case_id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.operacion_ref}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.cliente_full_name || '—'}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {((row.cliente_doc_type || '—') + ' ' + (row.cliente_doc_number || '')).trim()}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                        {operationClassLabel(row.operation_classification)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.status}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.sirel_status === 'reportado'
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border border-amber-200 bg-amber-50 text-amber-800'
                        }`}
                      >
                        {row.sirel_status === 'reportado' ? 'REPORTADO' : 'PENDIENTE'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">
                      {row.sirel_reference ? (
                        <div className="space-y-0.5">
                          <p className="font-medium">{row.sirel_reference}</p>
                          {row.sirel_sent_at && (
                            <p className="text-[11px] text-slate-500">
                              {new Date(row.sirel_sent_at).toLocaleString('es-CO')}
                              {row.sirel_sent_by_name ? ` · ${row.sirel_sent_by_name}` : ''}
                            </p>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{money(row.transaction_amount_cop)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs"
                          onClick={async () => {
                            const ok = await copyTextToClipboard(row.pre_ros_text || '');
                            setFeedback(ok ? 'Pre-ROS copiado al portapapeles.' : 'No fue posible copiar el Pre-ROS.');
                          }}
                        >
                          Copiar pre-ROS
                        </button>
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs"
                          disabled={downloadSirelPreRosMutation.isLoading}
                          onClick={() => downloadSirelPreRosMutation.mutate(row.case_id)}
                        >
                          Descargar TXT
                        </button>
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs"
                          disabled={downloadSirelExpedienteTemplateMutation.isLoading}
                          onClick={() => downloadSirelExpedienteTemplateMutation.mutate(row.case_id)}
                        >
                          Plantilla expediente
                        </button>
                        <button
                          className="btn-corporate-muted px-2.5 py-1 text-xs"
                          disabled={downloadSirelExpedienteTemplatePdfMutation.isLoading}
                          onClick={() => downloadSirelExpedienteTemplatePdfMutation.mutate(row.case_id)}
                        >
                          Plantilla PDF
                        </button>
                        {row.sirel_status !== 'reportado' && (
                          <button
                            className="btn-corporate-primary px-2.5 py-1 text-xs"
                            onClick={() => {
                              setSirelModal({
                                caseId: row.case_id,
                                operacionRef: row.operacion_ref,
                                preRosText: row.pre_ros_text || '',
                              });
                            }}
                          >
                            Marcar reportado
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!sirelQueueQuery.isLoading && (sirelQueueQuery.data || []).length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={9}>
                      Sin casos para el filtro seleccionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {(sarlaftSeccion === 'consultas' || sarlaftSeccion === 'lotes') && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {sarlaftSeccion === 'lotes' && (
          <>
          <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-indigo-900">Carga por lotes (CSV)</h4>
                <p className="text-xs text-indigo-800">
                  Para SARLAFT independiente: sube archivo, procesa lote y descarga resultado consolidado.
                </p>
              </div>
              <button
                className="btn-corporate-muted px-3 py-1.5 text-xs"
                onClick={() => downloadBatchTemplateMutation.mutate()}
                disabled={downloadBatchTemplateMutation.isLoading}
              >
                {downloadBatchTemplateMutation.isLoading ? 'Descargando...' : 'Descargar plantilla CSV'}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <select
                className="input-corporate"
                value={batchDataset}
                onChange={(e) => setBatchDataset(e.target.value as 'default' | 'sanctions')}
              >
                <option value="sanctions">sanctions (fuerte)</option>
                <option value="default">default (comun)</option>
              </select>
              <input
                className="input-corporate md:col-span-2"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setBatchFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn-corporate-primary px-3 py-1.5 text-xs"
                onClick={() => createBatchJobMutation.mutate()}
                disabled={!batchFile || createBatchJobMutation.isLoading}
              >
                {createBatchJobMutation.isLoading ? 'Procesando...' : 'Procesar lote'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-indigo-800">
              Maximo recomendado: 2000 registros por lote.
            </p>
          </div>

          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-900">Lotes recientes</h4>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Archivo</th>
                    <th className="py-2 pr-3">Dataset</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">Procesados</th>
                    <th className="py-2 pr-3">Verde/Amarillo/Rojo</th>
                    <th className="py-2 pr-3">Errores</th>
                    <th className="py-2 pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(batchJobsQuery.data || []).map((job: SarlaftBatchJob) => (
                    <tr
                      key={job.id}
                      className={`border-t border-slate-200 ${selectedBatchJobId === job.id ? 'bg-indigo-50/50' : ''}`}
                    >
                      <td className="py-2 pr-3 text-slate-700">{new Date(job.created_at).toLocaleString('es-CO')}</td>
                      <td className="py-2 pr-3 text-slate-700">{job.filename}</td>
                      <td className="py-2 pr-3 text-slate-700">{job.dataset}</td>
                      <td className="py-2 pr-3 text-slate-700">{batchJobStatusLabel(job.status)}</td>
                      <td className="py-2 pr-3 text-slate-700">{job.processed_records}/{job.total_records}</td>
                      <td className="py-2 pr-3 text-slate-700">{job.verde_records}/{job.amarillo_records}/{job.rojo_records}</td>
                      <td className="py-2 pr-3 text-slate-700">{job.error_records}</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <button
                            className="btn-corporate-muted px-2 py-1 text-[11px]"
                            onClick={() => {
                              setSelectedBatchJobId((prev) => (prev === job.id ? null : job.id));
                            }}
                          >
                            {selectedBatchJobId === job.id ? 'Ocultar detalle' : 'Ver detalle'}
                          </button>
                          <button
                            className="btn-corporate-muted px-2 py-1 text-[11px]"
                            onClick={() => downloadBatchRowsCsvMutation.mutate(job.id)}
                            disabled={downloadBatchRowsCsvMutation.isLoading}
                          >
                            Descargar CSV
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!batchJobsQuery.isLoading && (batchJobsQuery.data || []).length === 0 && (
                    <tr>
                      <td className="py-2 text-slate-500" colSpan={8}>Sin lotes ejecutados aun.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedBatchJobId && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="text-sm font-semibold text-slate-900">Detalle lote seleccionado</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">Documento</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Riesgo</th>
                      <th className="py-2 pr-3">Hits</th>
                      <th className="py-2 pr-3">Cobertura</th>
                      <th className="py-2 pr-3">Error</th>
                      <th className="py-2 pr-3">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batchRowsQuery.data || []).map((row: SarlaftBatchRow) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="py-2 pr-3 text-slate-700">{row.row_index}</td>
                        <td className="py-2 pr-3 text-slate-700">{row.full_name || '—'}</td>
                        <td className="py-2 pr-3 text-slate-700">{`${row.doc_type || ''} ${row.doc_number || ''}`.trim() || '—'}</td>
                        <td className="py-2 pr-3 text-slate-700">{batchRowStatusLabel(row.status)}</td>
                        <td className="py-2 pr-3 text-slate-700">{row.risk_level || '—'}</td>
                        <td className="py-2 pr-3 text-slate-700">{row.hits_count}</td>
                        <td className="py-2 pr-3 text-slate-700">
                          CO:{row.source_coverage?.colombia ? 'Si' : 'No'} · ONU:{row.source_coverage?.onu ? 'Si' : 'No'} · OFAC:{row.source_coverage?.ofac ? 'Si' : 'No'} · EU:{row.source_coverage?.europea ? 'Si' : 'No'}
                        </td>
                        <td className="py-2 pr-3 text-rose-700">{row.error_detail || 'Sin error'}</td>
                        <td className="py-2 pr-3">
                          {row.created_manual_check_id ? (
                            <button
                              className="btn-corporate-muted px-2 py-1 text-[11px]"
                              disabled={previewCertificateMutation.isLoading || previewingCertificateId === row.created_manual_check_id}
                              onClick={() => previewCertificateMutation.mutate(row.created_manual_check_id as string)}
                            >
                              {previewingCertificateId === row.created_manual_check_id ? 'Abriendo...' : 'Previsualizar PDF'}
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!batchRowsQuery.isLoading && (batchRowsQuery.data || []).length === 0 && (
                      <tr>
                        <td className="py-2 text-slate-500" colSpan={9}>Sin filas para este lote.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>
          )}

          {sarlaftSeccion === 'consultas' && (
          <>
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
                  <th className="py-2 pr-3">Cobertura fuentes</th>
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
                      <div className="min-w-[260px] rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-1.5">
                        {(() => {
                          type CoverageKey = 'colombia' | 'ofac' | 'onu' | 'europea';
                          const badges: Array<{ key: CoverageKey; label: string; on: boolean; activeClass: string }> = [
                            { key: 'colombia', label: 'Colombia', on: Boolean(row.source_coverage?.colombia), activeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800' },
                            { key: 'ofac', label: 'OFAC', on: Boolean(row.source_coverage?.ofac), activeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800' },
                            { key: 'onu', label: 'ONU', on: Boolean(row.source_coverage?.onu), activeClass: 'border border-emerald-200 bg-emerald-50 text-emerald-800' },
                            { key: 'europea', label: 'Unión Europea', on: Boolean(row.source_coverage?.europea), activeClass: 'border border-indigo-200 bg-indigo-50 text-indigo-800' },
                          ];
                          const priority: Record<CoverageKey, number> = { colombia: 0, ofac: 1, onu: 2, europea: 3 };
                          const sortedBadges = badges.sort((a, b) => {
                            if (a.on !== b.on) return a.on ? -1 : 1;
                            return priority[a.key] - priority[b.key];
                          });
                          const positiveCount = sortedBadges.filter((b) => b.on).length;
                          return (
                            <>
                              <div className="mb-1 flex items-center justify-between">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Listas</span>
                                <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                  {positiveCount}/4
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {sortedBadges.map((badge) => (
                                  <span
                                    key={badge.key}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      badge.on ? badge.activeClass : 'border border-slate-200 bg-slate-50 text-slate-600'
                                    }`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${badge.on ? 'bg-current' : 'bg-slate-400'}`} />
                                    <span>{badge.label}</span>
                                    <span className="opacity-80">{badge.on ? 'Sí' : 'No'}</span>
                                  </span>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </td>
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
                        disabled={previewCertificateMutation.isLoading || previewingCertificateId === row.id}
                        onClick={() => previewCertificateMutation.mutate(row.id)}
                      >
                        {previewingCertificateId === row.id
                          ? 'Abriendo...'
                          : hasCertificate
                            ? 'Previsualizar PDF'
                            : 'Generar y previsualizar'}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                    );
                  })()
                ))}
                {!manualChecksQuery.isLoading && (manualChecksQuery.data || []).length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={10}>
                      Sin consultas manuales registradas aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>
          )}
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
                <textarea
                  className="input-corporate min-h-[64px]"
                  placeholder="Perfil del cliente (ocupación/actividad/sector) *"
                  value={decisionCustomerProfile}
                  onChange={(e) => setDecisionCustomerProfile(e.target.value)}
                />
                <textarea
                  className="input-corporate min-h-[64px]"
                  placeholder="Justificación operativa declarada por el cliente *"
                  value={decisionOperationJustification}
                  onChange={(e) => setDecisionOperationJustification(e.target.value)}
                />
                <input
                  className="input-corporate"
                  placeholder="Relación con vehículos o activos involucrados *"
                  value={decisionRelationshipWithAssets}
                  onChange={(e) => setDecisionRelationshipWithAssets(e.target.value)}
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Actúa por *</label>
                    <select
                      className="input-corporate"
                      value={decisionActsOnBehalf}
                      onChange={(e) => setDecisionActsOnBehalf(e.target.value as 'propia' | 'tercero')}
                    >
                      <option value="propia">Cuenta propia</option>
                      <option value="tercero">Cuenta de tercero</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Condición PEP *</label>
                    <select
                      className="input-corporate"
                      value={decisionPepStatus}
                      onChange={(e) => setDecisionPepStatus(e.target.value as 'si' | 'no' | 'no_informado')}
                    >
                      <option value="no_informado">No informado</option>
                      <option value="no">No</option>
                      <option value="si">Sí</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Coherencia de pago *</label>
                    <select
                      className="input-corporate"
                      value={decisionPaymentConsistency}
                      onChange={(e) =>
                        setDecisionPaymentConsistency(e.target.value as 'coherente' | 'incoherente' | 'no_aplica')
                      }
                    >
                      <option value="no_aplica">No aplica</option>
                      <option value="coherente">Coherente</option>
                      <option value="incoherente">Incoherente</option>
                    </select>
                  </div>
                </div>
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-700">Señales observadas (opcional)</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-700">
                    {[
                      { id: 'urgencia', label: 'Urgencia injustificada' },
                      { id: 'inconsistencia_documental', label: 'Inconsistencia documental' },
                      { id: 'negativa_informacion', label: 'Negativa a informar' },
                      { id: 'patron_repetitivo', label: 'Patrón repetitivo' },
                      { id: 'otro', label: 'Otro' },
                    ].map((signal) => (
                      <label key={signal.id} className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={decisionUnusualSignals.includes(
                            signal.id as
                              | 'urgencia'
                              | 'inconsistencia_documental'
                              | 'negativa_informacion'
                              | 'patron_repetitivo'
                              | 'otro'
                          )}
                          onChange={(e) => {
                            const key = signal.id as
                              | 'urgencia'
                              | 'inconsistencia_documental'
                              | 'negativa_informacion'
                              | 'patron_repetitivo'
                              | 'otro';
                            setDecisionUnusualSignals((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, key])) : prev.filter((x) => x !== key)
                            );
                          }}
                        />
                        <span>{signal.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <textarea
                  className="input-corporate min-h-[88px]"
                  placeholder="Referencias de soportes (una por línea) *"
                  value={decisionSupportRefsRaw}
                  onChange={(e) => setDecisionSupportRefsRaw(e.target.value)}
                />
                <textarea
                  className="input-corporate min-h-[88px]"
                  placeholder="Conclusión técnica del oficial (mínimo 10 caracteres) *"
                  value={decisionOfficialConclusion}
                  onChange={(e) => setDecisionOfficialConclusion(e.target.value)}
                />
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={decisionFollowUpRequired}
                      onChange={(e) => setDecisionFollowUpRequired(e.target.checked)}
                    />
                    Requiere monitoreo reforzado
                  </label>
                  {decisionFollowUpRequired && (
                    <div className="mt-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Fecha próxima revisión *</label>
                      <input
                        type="date"
                        className="input-corporate"
                        value={decisionFollowUpDate}
                        onChange={(e) => setDecisionFollowUpDate(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <textarea
                  className="input-corporate min-h-[72px]"
                  placeholder="Nota del oficial (opcional)"
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                />
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <p className="mr-auto text-[11px] text-slate-500">
                  Para marcar como sospechosa se requieren mínimo 2 referencias de soporte.
                </p>
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
                      customer_profile: decisionCustomerProfile.trim(),
                      operation_justification: decisionOperationJustification.trim(),
                      relationship_with_assets: decisionRelationshipWithAssets.trim(),
                      acts_on_behalf: decisionActsOnBehalf,
                      pep_status: decisionPepStatus,
                      payment_profile_consistency: decisionPaymentConsistency,
                      cashier_interview: decisionCashierInterview,
                      unusual_signals: decisionUnusualSignals,
                      support_refs: decisionSupportRefs,
                      official_conclusion: decisionOfficialConclusion.trim(),
                      follow_up_required: decisionFollowUpRequired,
                      follow_up_date: decisionFollowUpDate || null,
                    })
                  }
                >
                  {decideAlertMutation.isLoading ? 'Guardando...' : 'Guardar como justificada'}
                </button>
                <button
                  className="rounded-xl border border-rose-200 bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                  disabled={!decisionFormSospechosaValid || decideAlertMutation.isLoading}
                  onClick={() =>
                    decideAlertMutation.mutate({
                      alertId: decisionModal.alertId,
                      decision: 'sospechosa',
                      notes: decisionNotes || null,
                      funds_source_declaration: decisionFundsSource.trim(),
                      economic_activity_support: decisionEconomicSupport.trim(),
                      customer_profile: decisionCustomerProfile.trim(),
                      operation_justification: decisionOperationJustification.trim(),
                      relationship_with_assets: decisionRelationshipWithAssets.trim(),
                      acts_on_behalf: decisionActsOnBehalf,
                      pep_status: decisionPepStatus,
                      payment_profile_consistency: decisionPaymentConsistency,
                      cashier_interview: decisionCashierInterview,
                      unusual_signals: decisionUnusualSignals,
                      support_refs: decisionSupportRefs,
                      official_conclusion: decisionOfficialConclusion.trim(),
                      follow_up_required: decisionFollowUpRequired,
                      follow_up_date: decisionFollowUpDate || null,
                    })
                  }
                >
                  {decideAlertMutation.isLoading ? 'Guardando...' : 'Guardar como sospechosa'}
                </button>
              </div>
            </div>
          </div>
        )}

        {sirelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="modal-panel glass-card max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-slate-200/80 p-5">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reporte SIREL/UIAF</p>
                  <h3 className="text-base font-semibold text-slate-900">{sirelModal.operacionRef}</h3>
                </div>
                <button className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" onClick={closeSirelModal}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-3">
                <textarea
                  className="input-corporate min-h-[180px] font-mono text-xs"
                  value={sirelModal.preRosText}
                  readOnly
                />
                <p className="text-[11px] text-slate-500">
                  Este texto es un pre-llenado operativo. La declaración oficial se finaliza en SIREL/UIAF.
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    className={`input-corporate ${sirelReferenceNormalized && !sirelReferenceValid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
                    placeholder="Radicado/Código SIREL *"
                    value={sirelReference}
                    onChange={(e) => setSirelReference(e.target.value.toUpperCase())}
                  />
                  <input
                    className={`input-corporate ${sirelEvidenceNormalized && !sirelEvidenceValid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
                    placeholder="URL evidencia (obligatoria) *"
                    value={sirelEvidenceUrl}
                    onChange={(e) => setSirelEvidenceUrl(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <p className={`text-[11px] ${sirelReferenceNormalized && !sirelReferenceValid ? 'text-rose-700' : 'text-slate-500'}`}>
                    Formato radicado: letras/numeros y simbolos - _ /, minimo 6 caracteres.
                  </p>
                  <p className={`text-[11px] ${sirelEvidenceNormalized && !sirelEvidenceValid ? 'text-rose-700' : 'text-slate-500'}`}>
                    Evidencia: enlace del soporte (drive, gestor documental, ticket), inicia con http:// o https://
                  </p>
                </div>
                <textarea
                  className="input-corporate min-h-[72px]"
                  placeholder="Observaciones de envío (opcional)"
                  value={sirelNotes}
                  onChange={(e) => setSirelNotes(e.target.value)}
                />
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  className="btn-corporate-muted px-4"
                  onClick={async () => {
                    const ok = await copyTextToClipboard(sirelModal.preRosText || '');
                    setFeedback(ok ? 'Pre-ROS copiado al portapapeles.' : 'No fue posible copiar el Pre-ROS.');
                  }}
                >
                  Copiar pre-ROS
                </button>
                <div className="flex items-center gap-2">
                  <button className="btn-corporate-muted px-4" onClick={closeSirelModal}>
                    Cancelar
                  </button>
                  <button
                    className="btn-corporate-primary px-4 disabled:opacity-50"
                    disabled={
                      !sirelReferenceNormalized ||
                      !sirelEvidenceNormalized ||
                      !sirelReferenceValid ||
                      !sirelEvidenceValid ||
                      markSirelReportedMutation.isLoading
                    }
                    onClick={() =>
                      markSirelReportedMutation.mutate({
                        caseId: sirelModal.caseId,
                        sirel_reference: sirelReferenceNormalized,
                        notes: sirelNotes.trim() || null,
                        evidence_url: sirelEvidenceNormalized,
                      })
                    }
                  >
                    {markSirelReportedMutation.isLoading ? 'Guardando...' : 'Confirmar reportado'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {manualModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="modal-panel glass-card h-[90vh] w-full max-w-5xl overflow-hidden border border-slate-200/80 p-0">
              <div className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ayuda oficial</p>
                  <h3 className="text-base font-semibold text-slate-900">Manual de uso del modulo SARLAFT</h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    <button
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                        manualViewMode === 'operativo'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      onClick={() => setManualViewMode('operativo')}
                    >
                      Manual corto
                    </button>
                    <button
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                        manualViewMode === 'completo'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      onClick={() => setManualViewMode('completo')}
                    >
                      Manual completo
                    </button>
                  </div>
                  <a
                    className="btn-corporate-muted px-3 py-1.5 text-xs"
                    href={manualDocPath}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir en nueva pestaña
                  </a>
                  <button
                    className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                    onClick={closeManualModal}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <iframe
                title="Manual de uso SARLAFT"
                src={manualDocPath}
                className="h-[calc(90vh-64px)] w-full bg-white"
              />
            </div>
          </div>
        )}

        {certificatePreviewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="modal-panel glass-card h-[90vh] w-full max-w-5xl overflow-hidden border border-slate-200/80 p-0">
              <div className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Certificado SARLAFT</p>
                  <h3 className="text-base font-semibold text-slate-900">Previsualización de certificado PDF</h3>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    className="btn-corporate-muted px-3 py-1.5 text-xs"
                    href={certificatePreviewModal.url}
                    download={certificatePreviewModal.filename}
                  >
                    Descargar
                  </a>
                  <button
                    className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                    onClick={closeCertificatePreviewModal}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <iframe
                title="Previsualización certificado SARLAFT"
                src={certificatePreviewModal.url}
                className="h-[calc(90vh-64px)] w-full bg-white"
              />
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
