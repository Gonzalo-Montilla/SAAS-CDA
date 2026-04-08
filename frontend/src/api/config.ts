import apiClient from './client';
import type { TenantFacturacionUbicacion, URLsExternas } from '../types';

export const configApi = {
  // Obtener URLs de sistemas externos (RUNT, SICOV, INDRA)
  obtenerURLsExternas: async (): Promise<URLsExternas> => {
    const response = await apiClient.get<URLsExternas>('/config/urls-externas');
    return response.data;
  },

  obtenerTenantLogoBlob: async (): Promise<Blob> => {
    const response = await apiClient.get('/config/tenant-logo', {
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  obtenerFacturacionUbicacion: async (): Promise<TenantFacturacionUbicacion> => {
    const response = await apiClient.get<TenantFacturacionUbicacion>('/config/facturacion-ubicacion');
    return response.data;
  },

  actualizarFacturacionUbicacion: async (
    payload: Partial<Pick<TenantFacturacionUbicacion, 'factus_municipality_id' | 'direccion_facturacion'>>
  ): Promise<TenantFacturacionUbicacion> => {
    const response = await apiClient.patch<TenantFacturacionUbicacion>('/config/facturacion-ubicacion', payload);
    return response.data;
  },
};
