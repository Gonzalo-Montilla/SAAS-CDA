import apiClient from './client';
import type { Tarifa, ComisionSOAT } from '../types';

interface TarifasPorAnoResponse {
  ano: number;
  tarifas: Tarifa[];
}

export const tarifasApi = {
  // Obtener tarifas vigentes
  obtenerVigentes: async (): Promise<Tarifa[]> => {
    const response = await apiClient.get<Tarifa[]>('/tarifas/vigentes');
    return response.data;
  },

  // Obtener tarifas de un año específico
  obtenerPorAno: async (ano: number): Promise<TarifasPorAnoResponse> => {
    const response = await apiClient.get<TarifasPorAnoResponse>(`/tarifas/por-ano/${ano}`);
    return response.data;
  },

  // Obtener comisiones SOAT vigentes
  obtenerComisionesSOAT: async (): Promise<ComisionSOAT[]> => {
    const response = await apiClient.get<ComisionSOAT[]>('/tarifas/comisiones-soat');
    return response.data;
  },

  // Crear nueva tarifa (solo admin)
  crear: async (data: Partial<Tarifa>): Promise<Tarifa> => {
    const response = await apiClient.post<Tarifa>('/tarifas/', data);
    return response.data;
  },

  // Actualizar tarifa (solo admin)
  actualizar: async (id: string, data: Partial<Tarifa>): Promise<Tarifa> => {
    const response = await apiClient.put<Tarifa>(`/tarifas/${id}`, data);
    return response.data;
  },

  // Listar todas las tarifas (solo admin)
  listar: async (): Promise<Tarifa[]> => {
    const response = await apiClient.get<Tarifa[]>('/tarifas/');
    return response.data;
  },

  // Crear comisión SOAT (solo admin)
  crearComisionSOAT: async (data: Partial<ComisionSOAT>): Promise<ComisionSOAT> => {
    const response = await apiClient.post<ComisionSOAT>('/tarifas/comisiones-soat', data);
    return response.data;
  },

  // Actualizar comisión SOAT (solo admin)
  actualizarComisionSOAT: async (id: string, data: Partial<ComisionSOAT>): Promise<ComisionSOAT> => {
    const response = await apiClient.put<ComisionSOAT>(`/tarifas/comisiones-soat/${id}`, data);
    return response.data;
  },

  // Eliminar comisión SOAT (solo admin)
  eliminarComisionSOAT: async (id: string): Promise<void> => {
    const response = await apiClient.delete(`/tarifas/comisiones-soat/${id}`);
    return response.data;
  },
};
