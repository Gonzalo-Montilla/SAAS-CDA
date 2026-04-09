import apiClient from './client';
import type {
  QualityInviteDetail,
  QualityInviteListResponse,
  QualityPublicSurveyInfo,
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

export const qualityApi = {
  getSummary: async (params?: { sucursal_id?: string }): Promise<QualitySummary> => {
    const response = await apiClient.get<QualitySummary>('/quality/summary', {
      params: params?.sucursal_id ? { sucursal_id: params.sucursal_id } : undefined,
    });
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

