import apiClient from './client';

export interface TenantDocumento {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  grupo_id: string;
  version_seq: number;
  es_version_actual: boolean;
  titulo: string;
  categoria: string | null;
  nombre_archivo_original: string;
  mime_type: string;
  tamano_bytes: number;
  preview_pdf_relpath?: string | null;
  created_at: string;
  created_by: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export type AlcanceSedeFiltro = 'todas' | 'contexto' | 'solo_sede';

export interface ListarDocumentosParams {
  skip?: number;
  limit?: number;
  q?: string;
  categoria?: string;
  /** UUID sede; se usa junto con alcanceSede */
  sucursalId?: string | null;
  alcanceSede?: AlcanceSedeFiltro;
  /** Por defecto solo la versión vigente de cada documento */
  soloActuales?: boolean;
}

export interface DocumentoMetadataPatch {
  titulo?: string;
  categoria?: string | null;
  sucursal_id?: string | null;
}

/** Respuesta GET /documentos/auditoria (solo administrador). */
export interface DocumentoAuditoriaItem {
  id: string;
  tenant_id: string;
  documento_id: string | null;
  usuario_id: string | null;
  /** Nombre completo del usuario (si existe en BD). */
  usuario_nombre?: string | null;
  usuario_email?: string | null;
  accion: string;
  detalle: string | null;
  created_at: string;
}

function buildListParams(p: ListarDocumentosParams): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    skip: p.skip ?? 0,
    limit: p.limit ?? 100,
    solo_actuales: p.soloActuales ?? true,
  };
  if (p.q?.trim()) params.q = p.q.trim();
  if (p.categoria?.trim()) params.categoria = p.categoria.trim();

  const alcance = p.alcanceSede ?? 'todas';
  const sid = p.sucursalId?.trim() || null;
  if (alcance === 'todas' || !sid) {
    return params;
  }
  params.sucursal_id = sid;
  params.solo_esta_sede = alcance === 'solo_sede';
  return params;
}

export const documentosApi = {
  listarCategorias: async (): Promise<string[]> => {
    const response = await apiClient.get<string[]>('/documentos/categorias');
    return response.data;
  },

  listarAuditoria: async (skip = 0, limit = 100): Promise<DocumentoAuditoriaItem[]> => {
    const response = await apiClient.get<DocumentoAuditoriaItem[]>('/documentos/auditoria', {
      params: { skip, limit },
    });
    return response.data;
  },

  listar: async (p: ListarDocumentosParams = {}): Promise<TenantDocumento[]> => {
    const response = await apiClient.get<TenantDocumento[]>('/documentos/', {
      params: buildListParams(p),
    });
    return response.data;
  },

  subir: async (
    file: File,
    opts?: {
      titulo?: string;
      categoria?: string;
      sucursal_id?: string | null;
      /** ID de cualquier versión del mismo documento (cadena de versiones) */
      sustituye_a_id?: string | null;
    }
  ): Promise<TenantDocumento> => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.titulo?.trim()) {
      form.append('titulo', opts.titulo.trim());
    }
    if (opts?.categoria?.trim()) {
      form.append('categoria', opts.categoria.trim());
    }
    if (opts?.sucursal_id?.trim()) {
      form.append('sucursal_id', opts.sucursal_id.trim());
    }
    if (opts?.sustituye_a_id?.trim()) {
      form.append('sustituye_a_id', opts.sustituye_a_id.trim());
    }
    const response = await apiClient.post<TenantDocumento>('/documentos/', form);
    return response.data;
  },

  listarVersiones: async (documentoId: string): Promise<TenantDocumento[]> => {
    const response = await apiClient.get<TenantDocumento[]>(`/documentos/${documentoId}/versiones`);
    return response.data;
  },

  actualizarMetadata: async (id: string, body: DocumentoMetadataPatch): Promise<TenantDocumento> => {
    const response = await apiClient.patch<TenantDocumento>(`/documentos/${id}`, body);
    return response.data;
  },

  descargarBlob: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/documentos/${id}/download`, { responseType: 'blob' });
    return response.data;
  },

  /** PDF generado en servidor (Office → PDF); 404 si aún no existe. */
  obtenerVistaPreviaPdf: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/documentos/${id}/preview`, { responseType: 'blob' });
    return response.data;
  },

  eliminar: async (id: string): Promise<void> => {
    await apiClient.delete(`/documentos/${id}`);
  },
};
