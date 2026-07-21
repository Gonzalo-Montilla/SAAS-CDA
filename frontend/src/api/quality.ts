import apiClient from './client';
import type {
  QualityInviteDetail,
  QualityInviteListResponse,
  QualityPublicSurveyInfo,
  QualityTenantLogoSettings,
  RTMReminderItem,
  RTMReminderSummary,
  QualitySummary,
} from '../types';

export interface QualitySurveySubmitPayload {
  facilidad_agendar_cita: number;
  tiempo_espera_revision: number;
  amabilidad_recepcion_caja: number;
  limpieza_instalaciones: number;
  amenidades_cda: number;
  claridad_resultados_revision: number;
  confianza_diagnostico_tecnico: number;
  recomendar_cda: number;
  experiencia_global: number;
  comentario?: string;
}

export interface RTMReminderUpdatePayload {
  commercial_status: string;
  commercial_notes?: string;
  assigned_to_name?: string;
  next_contact_at?: string;
}

export interface MarkCertificateDeliveredResponse {
  success: boolean;
  vehiculo_id: string;
  resultado: 'aprobado' | 'rechazado';
  certificado_entregado_at?: string | null;
  certificado_entregado_por?: string | null;
  observacion?: string | null;
  message: string;
}

export interface MarkCertificateDeliveredPayload {
  resultado: 'aprobado' | 'rechazado';
  observacion?: string;
}

export interface CorrectInspectionResultPayload {
  motivo: string;
  sincronizar_reintento_pendiente?: boolean;
}

export interface CorrectInspectionResultResponse {
  success: boolean;
  vehiculo_id: string;
  placa: string;
  resultado_anterior: string;
  resultado_nuevo: 'aprobado' | 'rechazado';
  reintento_sincronizado: boolean;
  reintento_vehiculo_id?: string | null;
  message: string;
}

export interface QualityLogoUpdatePayload {
  logoUrl?: string;
  logoFile?: File | null;
  formatoPrerevisionVersion?: string;
}

export const qualityApi = {
  getSummary: async (params?: { sucursal_id?: string }): Promise<QualitySummary> => {
    const response = await apiClient.get<QualitySummary>('/quality/summary', {
      params: params?.sucursal_id ? { sucursal_id: params.sucursal_id } : undefined,
    });
    return response.data;
  },

  getTenantLogoCalidad: async (): Promise<QualityTenantLogoSettings> => {
    const response = await apiClient.get<QualityTenantLogoSettings>('/quality/logo-calidad');
    return response.data;
  },

  upsertTenantLogoCalidad: async (payload: QualityLogoUpdatePayload): Promise<QualityTenantLogoSettings> => {
    const form = new FormData();
    const hasVersionPayload = payload.formatoPrerevisionVersion !== undefined;
    if (payload.logoFile) {
      form.append('logo_file', payload.logoFile);
    } else if (payload.logoUrl?.trim()) {
      form.append('logo_url', payload.logoUrl.trim());
    } else if (!hasVersionPayload) {
      throw new Error('Debes indicar URL del logo, subir un archivo o actualizar la versión del formato');
    }
    if (hasVersionPayload) {
      form.append('formato_prerevision_version', payload.formatoPrerevisionVersion || '');
    }
    const response = await apiClient.put<QualityTenantLogoSettings>('/quality/logo-calidad', form);
    return response.data;
  },

  updateFormatoPrerevisionVersion: async (version: string): Promise<QualityTenantLogoSettings> => {
    return qualityApi.upsertTenantLogoCalidad({ formatoPrerevisionVersion: version });
  },

  clearTenantLogoCalidad: async (): Promise<QualityTenantLogoSettings> => {
    const response = await apiClient.delete<QualityTenantLogoSettings>('/quality/logo-calidad');
    return response.data;
  },

  listInvites: async (opts?: {
    statusFilter?: string;
    sucursal_id?: string;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<QualityInviteListResponse> => {
    const params: Record<string, string | number> = {};
    if (opts?.statusFilter) params.status_filter = opts.statusFilter;
    if (opts?.sucursal_id) params.sucursal_id = opts.sucursal_id;
    if (opts?.search) params.search = opts.search;
    if (opts?.skip != null) params.skip = opts.skip;
    if (opts?.limit != null) params.limit = opts.limit;
    const response = await apiClient.get<QualityInviteListResponse>('/quality/invites', {
      params: Object.keys(params).length ? params : undefined,
    });
    return response.data;
  },

  getInviteDetail: async (inviteId: string): Promise<QualityInviteDetail> => {
    const response = await apiClient.get<QualityInviteDetail>(`/quality/invites/${inviteId}`);
    return response.data;
  },

  submitInPersonSurvey: async (
    inviteId: string,
    payload: QualitySurveySubmitPayload
  ): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post<{ success: boolean; message: string }>(
      `/quality/invites/${inviteId}/submit-in-person`,
      payload
    );
    return response.data;
  },

  markCertificateDelivered: async (
    inviteId: string,
    payload: MarkCertificateDeliveredPayload
  ): Promise<MarkCertificateDeliveredResponse> => {
    const response = await apiClient.post<MarkCertificateDeliveredResponse>(
      `/quality/invites/${inviteId}/mark-certificate-delivered`,
      payload
    );
    return response.data;
  },

  correctInspectionResult: async (
    inviteId: string,
    payload: CorrectInspectionResultPayload
  ): Promise<CorrectInspectionResultResponse> => {
    const response = await apiClient.post<CorrectInspectionResultResponse>(
      `/quality/invites/${inviteId}/corregir-cierre-resultado`,
      payload
    );
    return response.data;
  },

  processPending: async (): Promise<{ processed: number }> => {
    const response = await apiClient.post<{ processed: number }>('/quality/process-pending');
    return response.data;
  },

  getRTMSummary: async (): Promise<RTMReminderSummary> => {
    const response = await apiClient.get<RTMReminderSummary>('/quality/rtm-reminders/summary');
    return response.data;
  },

  listRTMReminders: async (params?: {
    days_window?: 8 | 15 | 30;
    commercial_status?: string;
    search?: string;
  }): Promise<RTMReminderItem[]> => {
    const response = await apiClient.get<RTMReminderItem[]>('/quality/rtm-reminders', { params });
    return response.data;
  },

  updateRTMReminder: async (reminderId: string, payload: RTMReminderUpdatePayload): Promise<RTMReminderItem> => {
    const response = await apiClient.patch<RTMReminderItem>(`/quality/rtm-reminders/${reminderId}`, payload);
    return response.data;
  },

  sendRTMReminderNow: async (reminderId: string): Promise<{ sent: boolean; message: string }> => {
    const response = await apiClient.post<{ sent: boolean; message: string }>(`/quality/rtm-reminders/${reminderId}/send-now`);
    return response.data;
  },

  processRTMReminders: async (): Promise<{ processed: number }> => {
    const response = await apiClient.post<{ processed: number }>('/quality/rtm-reminders/process');
    return response.data;
  },

  touchRTMManagement: async (
    reminderId: string,
    payload: { channel: string; auto_status?: string }
  ): Promise<RTMReminderItem> => {
    const response = await apiClient.post<RTMReminderItem>(`/quality/rtm-reminders/${reminderId}/touch-management`, payload);
    return response.data;
  },

  getPublicSurveyInfo: async (token: string): Promise<QualityPublicSurveyInfo> => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/quality/public/${token}`);
    if (!response.ok) {
      throw new Error('No fue posible cargar la encuesta');
    }
    return response.json();
  },

  submitPublicSurvey: async (token: string, payload: QualitySurveySubmitPayload): Promise<{ success: boolean; message: string }> => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/quality/public/${token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail || 'No fue posible enviar la encuesta');
    }
    return data;
  },
};

