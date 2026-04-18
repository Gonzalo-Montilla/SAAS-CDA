import apiClient from './client';

export interface ProveedorCatalogo {
  id: string;
  tenant_id: string;
  alias: string | null;
  razon_social_rut: string;
  tipo_identificacion: string;
  numero_identificacion: string;
  direccion: string;
  email: string;
  telefono: string;
  factus_municipality_id: number;
  activo: boolean;
  tiene_documento_rut: boolean;
  created_at: string;
  updated_at: string | null;
}

export type ProveedorCatalogoCreate = {
  alias?: string | null;
  razon_social_rut: string;
  tipo_identificacion: string;
  numero_identificacion: string;
  direccion: string;
  email: string;
  telefono: string;
  factus_municipality_id: number;
  activo?: boolean;
};

export type ProveedorCatalogoUpdate = Partial<ProveedorCatalogoCreate>;

export const proveedoresCatalogoApi = {
  listar: async (soloActivos = true): Promise<ProveedorCatalogo[]> => {
    const { data } = await apiClient.get<ProveedorCatalogo[]>('/proveedores-catalogo', {
      params: { solo_activos: soloActivos },
    });
    return data;
  },

  crear: async (body: ProveedorCatalogoCreate): Promise<ProveedorCatalogo> => {
    const { data } = await apiClient.post<ProveedorCatalogo>('/proveedores-catalogo', body);
    return data;
  },

  actualizar: async (id: string, body: ProveedorCatalogoUpdate): Promise<ProveedorCatalogo> => {
    const { data } = await apiClient.patch<ProveedorCatalogo>(`/proveedores-catalogo/${id}`, body);
    return data;
  },

  /** PDF certificación RUT (DIAN); no cédula. */
  descargarDocumentoRutBlob: async (id: string): Promise<Blob> => {
    const pid = id.trim();
    const { data } = await apiClient.get<Blob>(`/proveedores-catalogo/${pid}/documento-rut`, {
      responseType: 'blob',
      params: { _: Date.now() },
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    return data;
  },

  subirDocumentoRut: async (id: string, file: File): Promise<ProveedorCatalogo> => {
    const pid = id.trim();
    const fd = new FormData();
    fd.append('file', file, file.name || 'rut.pdf');
    const { data } = await apiClient.post<ProveedorCatalogo>(
      `/proveedores-catalogo/${pid}/documento-rut`,
      fd,
    );
    return data;
  },

  eliminarDocumentoRut: async (id: string): Promise<ProveedorCatalogo> => {
    const pid = id.trim();
    const { data } = await apiClient.delete<ProveedorCatalogo>(
      `/proveedores-catalogo/${pid}/documento-rut`,
    );
    return data;
  },
};
