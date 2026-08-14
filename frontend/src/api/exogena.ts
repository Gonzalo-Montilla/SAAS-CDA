import apiClient from './client';

type ExogenaFormato = '1001' | '1007';

export interface ExogenaMapeo {
  id: string;
  formato: string;
  cuenta_contable: string;
  concepto: string;
  categoria: string;
  saldo_a_reportar: string;
  activo: string;
  source_rule?: string | null;
}

export interface ExogenaConfigResponse {
  anio: string;
  uvt_anual: number;
  topes_por_formato_json?: Record<string, unknown>;
  version_normativa?: string | null;
  mapeos: ExogenaMapeo[];
}

export interface ExogenaSaveConfigPayload {
  anio: string;
  uvt_anual: number;
  topes_por_formato_json: Record<string, unknown>;
  version_normativa?: string | null;
  mapeos: Array<{
    formato: string;
    cuenta_contable: string;
    concepto: string;
    categoria: string;
    saldo_a_reportar: string;
    source_rule?: string | null;
    activo: string;
  }>;
}

export interface ExogenaClonarConfigPayload {
  anio_origen: string;
  anio_destino: string;
  reemplazar_destino?: boolean;
}

export interface ExogenaValidacionResumenItem {
  id?: string;
  codigo: string;
  severidad: string;
  mensaje: string;
  formato?: string;
  referencia_origen?: string | null;
}

export interface ExogenaValidarResponse {
  anio?: string;
  formatos?: string[];
  total?: number;
  total_errors: number;
  total_warnings: number;
  items?: ExogenaValidacionResumenItem[];
}

export interface ExogenaExportarPayload {
  anio: string;
  formato: ExogenaFormato;
  include_warnings?: boolean;
  modo_exportacion?: 'consolidado' | 'detalle';
}

export interface ExogenaExportarResponse {
  ok: boolean;
  formato: string;
  total_rows: number;
  omitidos_rows?: number;
  error_message?: string | null;
}

export interface ExogenaFuenteResumenItem {
  fuente: string;
  rows: number;
}

export interface ExogenaEjecucion {
  id: string;
  anio: string;
  formato: string;
  status: string;
  total_rows: number;
  total_errors: number;
  omitidos_rows?: number;
  archivo_relpath?: string | null;
  fuente_resumen_json?: ExogenaFuenteResumenItem[];
  created_at: string;
}

export interface ExogenaValidacionItem {
  id: string;
  codigo: string;
  severidad: string;
  mensaje: string;
  referencia_origen?: string | null;
}

interface BlobDownload {
  blob: Blob;
  filename: string;
}

function getFilenameFromContentDisposition(value?: string): string | null {
  if (!value) return null;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const simpleMatch = value.match(/filename="?([^"]+)"?/i);
  return simpleMatch?.[1] || null;
}

async function downloadBlob(url: string, fallback: string): Promise<BlobDownload> {
  const response = await apiClient.get(url, { responseType: 'blob' });
  const blob = response.data as Blob;
  const rawCd = response.headers['content-disposition'] as string | undefined;
  const filename = getFilenameFromContentDisposition(rawCd) || fallback;
  return { blob, filename };
}

export const exogenaApi = {
  getConfig: async (anio: string): Promise<ExogenaConfigResponse> => {
    const response = await apiClient.get<ExogenaConfigResponse>('/exogena/config', {
      params: { anio },
    });
    return response.data;
  },

  saveConfig: async (payload: ExogenaSaveConfigPayload): Promise<ExogenaConfigResponse> => {
    const response = await apiClient.put<ExogenaConfigResponse>('/exogena/config', payload);
    return response.data;
  },

  clonarConfig: async (payload: ExogenaClonarConfigPayload): Promise<ExogenaConfigResponse> => {
    const response = await apiClient.post<ExogenaConfigResponse>('/exogena/config/clonar', payload);
    return response.data;
  },

  validar: async (payload: { anio: string; formatos: ExogenaFormato[] }): Promise<ExogenaValidarResponse> => {
    const response = await apiClient.post<ExogenaValidarResponse>('/exogena/validar', payload);
    return response.data;
  },

  exportar: async (payload: ExogenaExportarPayload): Promise<ExogenaExportarResponse> => {
    const response = await apiClient.post<ExogenaExportarResponse>('/exogena/exportar', payload);
    return response.data;
  },

  listarEjecuciones: async (anio: string): Promise<ExogenaEjecucion[]> => {
    const response = await apiClient.get<ExogenaEjecucion[]>('/exogena/ejecuciones', {
      params: { anio },
    });
    return response.data;
  },

  listarValidacionesEjecucion: async (ejecucionId: string): Promise<ExogenaValidacionItem[]> => {
    const response = await apiClient.get<ExogenaValidacionItem[]>(`/exogena/ejecuciones/${ejecucionId}/validaciones`);
    return response.data;
  },

  descargarArchivoEjecucion: async (ejecucionId: string): Promise<BlobDownload> => {
    return downloadBlob(`/exogena/ejecuciones/${ejecucionId}/archivo`, `exogena_${ejecucionId}.csv`);
  },

  descargarOmitidosEjecucion: async (ejecucionId: string): Promise<BlobDownload> => {
    return downloadBlob(`/exogena/ejecuciones/${ejecucionId}/omitidos`, `exogena_omitidos_${ejecucionId}.csv`);
  },
};
