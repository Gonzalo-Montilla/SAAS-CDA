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
};
