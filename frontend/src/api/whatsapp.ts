import apiClient from './client';

export type WhatsAppProveedor = 'cloud_api' | 'dialog360';

export interface WhatsAppSettings {
  proveedor: WhatsAppProveedor;
  habilitado: boolean;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token_configured: boolean;
  access_token_hint: string | null;
  dialog360_api_key_configured: boolean;
  dialog360_api_key_hint: string | null;
  display_phone_e164: string | null;
  avisos_calidad: boolean;
  plantilla_calidad: string | null;
  plantilla_calidad_lang: string;
  avisos_operativos: boolean;
  plantilla_bienvenida: string | null;
  plantilla_caja: string | null;
  plantilla_recibo: string | null;
  avisos_citas: boolean;
  plantilla_cita: string | null;
  plantilla_cita_recordatorio: string | null;
  avisos_vencimientos: boolean;
  plantilla_rtm: string | null;
  plantilla_preventiva: string | null;
  plantilla_reinspeccion: string | null;
  plantilla_aprobacion: string | null;
  asistente_habilitado: boolean;
  listo_para_enviar: boolean;
  webhook_url: string | null;
  last_error: string | null;
  last_ok_at: string | null;
}

export interface WhatsAppSettingsUpdatePayload {
  proveedor: WhatsAppProveedor;
  habilitado: boolean;
  phone_number_id?: string | null;
  waba_id?: string | null;
  access_token?: string | null;
  dialog360_api_key?: string | null;
  display_phone_e164?: string | null;
  avisos_calidad: boolean;
  plantilla_calidad?: string | null;
  plantilla_calidad_lang?: string | null;
  avisos_operativos: boolean;
  plantilla_bienvenida?: string | null;
  plantilla_caja?: string | null;
  plantilla_recibo?: string | null;
  avisos_citas: boolean;
  plantilla_cita?: string | null;
  plantilla_cita_recordatorio?: string | null;
  avisos_vencimientos: boolean;
  plantilla_rtm?: string | null;
  plantilla_preventiva?: string | null;
  plantilla_reinspeccion?: string | null;
  plantilla_aprobacion?: string | null;
  asistente_habilitado?: boolean;
}

export interface WhatsAppTestConnectionResult {
  ok: boolean;
  message: string;
  display_phone?: string | null;
  verified_name?: string | null;
  quality_rating?: string | null;
}

export type WhatsAppEventoPrueba =
  | 'calidad'
  | 'bienvenida'
  | 'caja'
  | 'recibo'
  | 'cita'
  | 'cita_recordatorio'
  | 'rtm'
  | 'preventiva'
  | 'reinspeccion'
  | 'aprobado';

export interface WhatsAppPackItem {
  evento: WhatsAppEventoPrueba;
  nombre: string;
  grupo: string;
  variables: number;
  ejemplos: string[];
  cuerpo: string;
}

export interface WhatsAppTestSendResult {
  ok: boolean;
  message: string;
  destino_e164?: string | null;
  message_id?: string | null;
}

export const whatsappApi = {
  getSettings: async (): Promise<WhatsAppSettings> => {
    const { data } = await apiClient.get<WhatsAppSettings>('/whatsapp/settings');
    return data;
  },
  putSettings: async (payload: WhatsAppSettingsUpdatePayload): Promise<WhatsAppSettings> => {
    const { data } = await apiClient.put<WhatsAppSettings>('/whatsapp/settings', payload);
    return data;
  },
  testConnection: async (): Promise<WhatsAppTestConnectionResult> => {
    const { data } = await apiClient.post<WhatsAppTestConnectionResult>('/whatsapp/test-connection');
    return data;
  },
  getPack: async (): Promise<WhatsAppPackItem[]> => {
    const { data } = await apiClient.get<WhatsAppPackItem[]>('/whatsapp/pack');
    return data;
  },
  testSend: async (celular: string, evento: WhatsAppEventoPrueba = 'calidad'): Promise<WhatsAppTestSendResult> => {
    const { data } = await apiClient.post<WhatsAppTestSendResult>('/whatsapp/test-send', { celular, evento });
    return data;
  },
};
