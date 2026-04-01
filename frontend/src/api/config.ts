import apiClient from './client';
import type { URLsExternas } from '../types';

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
};
