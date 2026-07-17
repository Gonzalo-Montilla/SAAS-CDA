import { apiClient } from './client';
import type {
  SarlaftCase,
  SarlaftCasePartyInput,
  SarlaftCaseSummary,
  SarlaftInternalAlert,
  SarlaftManualCheck,
  SarlaftProfile,
  SarlaftSirelQueueItem,
  SarlaftBatchJob,
  SarlaftBatchRow,
  SarlaftSubjectExpediente,
} from '../types';

export const sarlaftApi = {
  getProfile: async (): Promise<SarlaftProfile> => {
    const response = await apiClient.get<SarlaftProfile>('/sarlaft/profile');
    return response.data;
  },

  patchProfile: async (payload: Partial<SarlaftProfile>): Promise<SarlaftProfile> => {
    const response = await apiClient.patch<SarlaftProfile>('/sarlaft/profile', payload);
    return response.data;
  },

  createCase: async (payload: {
    operacion_ref?: string | null;
    sede_id?: string | null;
    transaction_amount_cop: number;
    cash_amount_cop: number;
    payment_method: 'efectivo' | 'mixto' | 'transferencia' | 'otro';
    parties: SarlaftCasePartyInput[];
  }): Promise<SarlaftCase> => {
    const response = await apiClient.post<SarlaftCase>('/sarlaft/cases', payload);
    return response.data;
  },

  getCase: async (caseId: string): Promise<SarlaftCase> => {
    const response = await apiClient.get<SarlaftCase>(`/sarlaft/cases/${caseId}`);
    return response.data;
  },

  listCases: async (params?: {
    risk_level?: 'verde' | 'amarillo' | 'rojo';
    status?: string;
    sede_id?: string;
    limit?: number;
  }): Promise<SarlaftCaseSummary[]> => {
    const response = await apiClient.get<SarlaftCaseSummary[]>('/sarlaft/cases', { params });
    return response.data;
  },

  screeningOpenSanctions: async (payload: {
    schema: 'Person' | 'Company' | 'LegalEntity';
    full_name: string;
    document_number?: string | null;
    birth_date?: string | null;
    nationality?: string | null;
    dataset?: string | null;
    algorithm?: string | null;
    limit?: number | null;
    case_id?: string | null;
    persist_in_case?: boolean;
  }): Promise<{
    provider: string;
    dataset: string;
    algorithm: string;
    threshold: number;
    hits: Array<{
      entity_id?: string;
      caption?: string;
      schema?: string;
      score?: number;
      topics: string[];
      first_seen?: string;
      last_seen?: string;
      source_url?: string;
    }>;
    alert: boolean;
    raw_count: number;
    risk_level: 'verde' | 'amarillo' | 'rojo';
    recommended_action: string;
    source_labels: string[];
    source_coverage: {
      colombia?: boolean;
      onu?: boolean;
      ofac?: boolean;
      europea?: boolean;
      otras?: boolean;
    };
    case_id?: string | null;
  }> => {
    const response = await apiClient.post('/sarlaft/screening/opensanctions', payload);
    return response.data;
  },

  createManualCheck: async (payload: {
    subject_type: 'natural' | 'juridica';
    full_name: string;
    doc_type?: string | null;
    doc_number?: string | null;
    email?: string | null;
    phone?: string | null;
    economic_activity?: string | null;
    legal_representative?: string | null;
    dataset?: 'default' | 'sanctions';
    algorithm?: string;
    limit?: number;
    nationality?: string | null;
    birth_date?: string | null;
    notes?: string | null;
  }): Promise<SarlaftManualCheck> => {
    const response = await apiClient.post<SarlaftManualCheck>('/sarlaft/manual-checks', payload);
    return response.data;
  },

  listManualChecks: async (params?: {
    subject_type?: 'natural' | 'juridica';
    risk_level?: 'verde' | 'amarillo' | 'rojo';
    sede_id?: string;
    limit?: number;
  }): Promise<SarlaftManualCheck[]> => {
    const response = await apiClient.get<SarlaftManualCheck[]>('/sarlaft/manual-checks', { params });
    return response.data;
  },

  getSubjectExpediente: async (params: {
    doc_number: string;
    doc_type?: string | null;
    sede_id?: string | null;
  }): Promise<SarlaftSubjectExpediente> => {
    const response = await apiClient.get<SarlaftSubjectExpediente>('/sarlaft/subjects/expediente', { params });
    return response.data;
  },

  listInternalAlerts: async (params?: {
    alert_level?: 'critica' | 'alta' | 'media' | 'baja';
    case_id?: string;
    sede_id?: string;
    limit?: number;
  }): Promise<SarlaftInternalAlert[]> => {
    const response = await apiClient.get<SarlaftInternalAlert[]>('/sarlaft/alerts/internal', { params });
    return response.data;
  },

  decideInternalAlert: async (
    alertId: string,
    payload: {
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
    }
  ): Promise<SarlaftInternalAlert> => {
    const response = await apiClient.post<SarlaftInternalAlert>(`/sarlaft/alerts/internal/${alertId}/decision`, payload);
    return response.data;
  },

  createCaseFromInternalAlert: async (alertId: string): Promise<SarlaftCase> => {
    const response = await apiClient.post<SarlaftCase>(`/sarlaft/alerts/internal/${alertId}/create-case`);
    return response.data;
  },

  listSirelQueue: async (params?: {
    status?: 'all' | 'pending' | 'reported';
    sede_id?: string;
    limit?: number;
  }): Promise<SarlaftSirelQueueItem[]> => {
    const response = await apiClient.get<SarlaftSirelQueueItem[]>('/sarlaft/sirel/queue', { params });
    return response.data;
  },

  markSirelReported: async (
    caseId: string,
    payload: {
      sirel_reference: string;
      sent_at?: string | null;
      notes?: string | null;
      evidence_url: string;
    }
  ): Promise<SarlaftSirelQueueItem> => {
    const response = await apiClient.post<SarlaftSirelQueueItem>(`/sarlaft/sirel/queue/${caseId}/mark-reported`, payload);
    return response.data;
  },

  downloadSirelPreRosTxt: async (caseId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/sarlaft/sirel/queue/${caseId}/pre-ros.txt`, {
      responseType: 'blob',
    });
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `pre_ros_${caseId}.txt`;
    if (contentDisposition) {
      const m = /filename="([^"]+)"/.exec(contentDisposition) ?? /filename=([^;\s]+)/.exec(contentDisposition);
      if (m?.[1]) filename = m[1].trim().replace(/^"|"$/g, '');
    }
    return {
      blob: response.data as Blob,
      filename,
    };
  },

  downloadSirelExpedienteTemplateTxt: async (caseId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/sarlaft/sirel/queue/${caseId}/expediente-template.txt`, {
      responseType: 'blob',
    });
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `expediente_ros_template_${caseId}.txt`;
    if (contentDisposition) {
      const m = /filename="([^"]+)"/.exec(contentDisposition) ?? /filename=([^;\s]+)/.exec(contentDisposition);
      if (m?.[1]) filename = m[1].trim().replace(/^"|"$/g, '');
    }
    return {
      blob: response.data as Blob,
      filename,
    };
  },

  downloadSirelExpedienteTemplatePdf: async (caseId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/sarlaft/sirel/queue/${caseId}/expediente-template.pdf`, {
      responseType: 'blob',
    });
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `expediente_ros_template_${caseId}.pdf`;
    if (contentDisposition) {
      const m = /filename="([^"]+)"/.exec(contentDisposition) ?? /filename=([^;\s]+)/.exec(contentDisposition);
      if (m?.[1]) filename = m[1].trim().replace(/^"|"$/g, '');
    }
    return {
      blob: response.data as Blob,
      filename,
    };
  },

  downloadBatchTemplateCsv: async (): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get('/sarlaft/batch/template.csv', { responseType: 'blob' });
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = 'sarlaft_lote_template.csv';
    if (contentDisposition) {
      const m = /filename="([^"]+)"/.exec(contentDisposition) ?? /filename=([^;\s]+)/.exec(contentDisposition);
      if (m?.[1]) filename = m[1].trim().replace(/^"|"$/g, '');
    }
    return { blob: response.data as Blob, filename };
  },

  createBatchJob: async (params: { file: File; dataset: 'default' | 'sanctions' }): Promise<SarlaftBatchJob> => {
    const formData = new FormData();
    formData.append('file', params.file);
    formData.append('dataset', params.dataset);
    const response = await apiClient.post<SarlaftBatchJob>('/sarlaft/batch/jobs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  listBatchJobs: async (params?: { sede_id?: string; limit?: number }): Promise<SarlaftBatchJob[]> => {
    const response = await apiClient.get<SarlaftBatchJob[]>('/sarlaft/batch/jobs', { params });
    return response.data;
  },

  listBatchRows: async (jobId: string, params?: { sede_id?: string; limit?: number }): Promise<SarlaftBatchRow[]> => {
    const response = await apiClient.get<SarlaftBatchRow[]>(`/sarlaft/batch/jobs/${jobId}/rows`, { params });
    return response.data;
  },

  downloadBatchRowsCsv: async (jobId: string, params?: { sede_id?: string }): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get(`/sarlaft/batch/jobs/${jobId}/rows.csv`, {
      params,
      responseType: 'blob',
    });
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `sarlaft_lote_resultado_${jobId}.csv`;
    if (contentDisposition) {
      const m = /filename="([^"]+)"/.exec(contentDisposition) ?? /filename=([^;\s]+)/.exec(contentDisposition);
      if (m?.[1]) filename = m[1].trim().replace(/^"|"$/g, '');
    }
    return { blob: response.data as Blob, filename };
  },

  downloadManualCheckCertificate: async (
    manualCheckId: string
  ): Promise<{ blob: Blob; filename: string; certificateCode: string | null }> => {
    const response = await apiClient.get(`/sarlaft/manual-checks/${manualCheckId}/certificate`, {
      responseType: 'blob',
      // Primera emisión del certificado genera y firma PDF; puede tardar.
      timeout: 210000,
    });
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `sarlaft_certificado_${manualCheckId}.pdf`;
    if (contentDisposition) {
      const m = /filename="([^"]+)"/.exec(contentDisposition) ?? /filename=([^;\s]+)/.exec(contentDisposition);
      if (m?.[1]) filename = m[1].trim().replace(/^"|"$/g, '');
    }
    const rawCode = response.headers['x-sarlaft-certificate-code'];
    const certificateCode = typeof rawCode === 'string' && rawCode.trim() ? rawCode.trim() : null;
    return {
      blob: response.data as Blob,
      filename,
      certificateCode,
    };
  },
};
