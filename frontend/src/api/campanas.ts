import apiClient from './client';

export type CampanaTipo = 'por_vencer' | 'inactivos' | 'excel' | 'temporada';

export interface CampanaExcelFila {
  nombre: string;
  celular: string;
  correo?: string | null;
  autorizo_habeas: string;
}

export interface CampanaFiltros {
  tipo: CampanaTipo;
  sucursal_id?: string | null;
  tipo_vehiculo?: string | null;
  dias_desde?: number;
  dias_hasta?: number;
  meses_inactivo?: number;
  etiqueta?: string | null;
  filas_excel?: CampanaExcelFila[];
  email_asunto?: string | null;
  email_cuerpo?: string | null;
}

export interface CampanaDestinatario {
  id?: string | null;
  vehiculo_id?: string | null;
  destino_e164: string;
  cliente_nombre: string;
  placa?: string | null;
  cliente_email?: string | null;
  opt_in_tipo: string;
  motivo: string;
  estado: string;
  error?: string | null;
  estado_whatsapp?: string | null;
  estado_correo?: string | null;
  error_whatsapp?: string | null;
  error_correo?: string | null;
}

export interface CampanaPreview {
  tipo: CampanaTipo;
  categoria_meta: string;
  plantilla: string;
  plantilla_cuerpo?: string | null;
  total: number;
  omitidos: number;
  tope: number;
  destinatarios: CampanaDestinatario[];
  ventana_ok: boolean;
  ventana_motivo?: string | null;
  canal_listo: boolean;
  canal_motivo?: string | null;
  con_correo?: number;
  whatsapp_hoy?: number;
  whatsapp_preview?: string | null;
  email_asunto?: string | null;
  email_html?: string | null;
  email_cuerpo?: string | null;
}

export interface CampanaItem {
  id: string;
  nombre: string;
  tipo: string;
  etiqueta?: string | null;
  estado: string;
  plantilla: string;
  categoria_meta: string;
  total_destinatarios: number;
  enviados_ok: number;
  enviados_fail: number;
  error?: string | null;
  created_at: string;
  sent_at?: string | null;
  finished_at?: string | null;
}

export interface CampanaDetalle extends CampanaItem {
  filtros_json?: Record<string, unknown> | null;
  texto_propuesto?: string | null;
  error?: string | null;
  destinatarios: CampanaDestinatario[];
}

export const campanasApi = {
  preview: async (payload: CampanaFiltros): Promise<CampanaPreview> => {
    const { data } = await apiClient.post<CampanaPreview>('/campanas/preview', payload);
    return data;
  },
  list: async (): Promise<CampanaItem[]> => {
    const { data } = await apiClient.get<CampanaItem[]>('/campanas');
    return data;
  },
  get: async (id: string): Promise<CampanaDetalle> => {
    const { data } = await apiClient.get<CampanaDetalle>(`/campanas/${id}`);
    return data;
  },
  crear: async (payload: CampanaFiltros & { nombre: string }): Promise<CampanaDetalle> => {
    const { data } = await apiClient.post<CampanaDetalle>('/campanas', payload);
    return data;
  },
  enviar: async (id: string): Promise<{ id: string; estado: string; total_destinatarios: number; message: string }> => {
    const { data } = await apiClient.post(`/campanas/${id}/enviar`);
    return data;
  },
  previewCorreo: async (payload: {
    tipo: CampanaTipo;
    etiqueta?: string | null;
    email_asunto?: string | null;
    email_cuerpo: string;
    nombre_muestra?: string | null;
    placa_muestra?: string | null;
    motivo_muestra?: string | null;
  }): Promise<{ email_asunto: string; email_html: string; email_cuerpo: string }> => {
    const { data } = await apiClient.post('/campanas/preview-correo', payload);
    return data;
  },
  grokCorreo: async (payload: {
    tipo: CampanaTipo;
    etiqueta?: string | null;
    notas?: string | null;
    cuerpo_actual?: string | null;
  }): Promise<{ asunto: string; cuerpo: string; origen: string }> => {
    const { data } = await apiClient.post('/campanas/grok-correo', payload);
    return data;
  },
};
