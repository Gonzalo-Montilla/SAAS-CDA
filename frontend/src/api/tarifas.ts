import apiClient from './client';
import type { Tarifa, ComisionSOAT } from '../types';

interface TarifasPorAnoResponse {
  ano: number;
  tarifas: Tarifa[];
}

function sucursalParams(sucursalId?: string | null) {
  return sucursalId ? { sucursal_id: sucursalId } : {};
}

export const tarifasApi = {
  // Obtener tarifas vigentes
  obtenerVigentes: async (sucursalId?: string | null): Promise<Tarifa[]> => {
    const response = await apiClient.get<Tarifa[]>('/tarifas/vigentes', {
      params: sucursalParams(sucursalId),
    });
    return response.data;
  },

  // Obtener tarifas de un año específico
  obtenerPorAno: async (ano: number, sucursalId?: string | null): Promise<TarifasPorAnoResponse> => {
    const response = await apiClient.get<TarifasPorAnoResponse>(`/tarifas/por-ano/${ano}`, {
      params: sucursalParams(sucursalId),
    });
    return response.data;
  },

  // Obtener comisiones SOAT vigentes
  obtenerComisionesSOAT: async (sucursalId?: string | null): Promise<ComisionSOAT[]> => {
    const response = await apiClient.get<ComisionSOAT[]>('/tarifas/comisiones-soat', {
      params: sucursalParams(sucursalId),
    });
    return response.data;
  },

  /** Catálogo + override de la sede activa (igual que cobra el backend). */
  obtenerComisionesSOATResueltas: async (sucursalId?: string | null): Promise<ComisionSOAT[]> => {
    const catalogo = await tarifasApi.obtenerComisionesSOAT();
    if (!sucursalId) return catalogo;
    const override = await tarifasApi.obtenerComisionesSOAT(sucursalId);
    if (!override.length) return catalogo;
    const byTipo = new Map(catalogo.map((c) => [c.tipo_vehiculo, c]));
    for (const row of override) byTipo.set(row.tipo_vehiculo, row);
    return Array.from(byTipo.values());
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
  listar: async (sucursalId?: string | null): Promise<Tarifa[]> => {
    const response = await apiClient.get<Tarifa[]>('/tarifas/', {
      params: sucursalParams(sucursalId),
    });
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
