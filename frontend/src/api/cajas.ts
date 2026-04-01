import apiClient from './client';
import type { Caja, CajaApertura, CajaCierre, CajaResumen, MovimientoCaja } from '../types';

export const cajasApi = {
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  // Abrir caja (inicio de turno)
  abrir: async (data: CajaApertura): Promise<Caja> => {
    const response = await apiClient.post<Caja>('/cajas/abrir', data);
    return response.data;
  },

  // Obtener caja activa del usuario actual
  obtenerActiva: async (): Promise<Caja | null> => {
    try {
      const response = await apiClient.get<Caja>('/cajas/activa');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null; // No hay caja activa
      }
      throw error;
    }
  },

  // Obtener resumen de caja activa (pre-cierre)
  obtenerResumen: async (): Promise<CajaResumen | null> => {
    try {
      const response = await apiClient.get<CajaResumen>('/cajas/activa/resumen');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null; // No hay caja activa/resumen disponible
      }
      throw error;
    }
  },

  // Cerrar caja (fin de turno con arqueo)
  cerrar: async (data: CajaCierre): Promise<Caja> => {
    const response = await apiClient.post<Caja>('/cajas/cerrar', data);
    return response.data;
  },

  // Crear movimiento manual (ingreso/egreso)
  crearMovimiento: async (data: Partial<MovimientoCaja>): Promise<MovimientoCaja> => {
    const response = await apiClient.post<MovimientoCaja>('/cajas/movimientos', data);
    return response.data;
  },

  // Listar movimientos de caja activa
  listarMovimientos: async (): Promise<MovimientoCaja[]> => {
    try {
      const response = await apiClient.get<MovimientoCaja[]>('/cajas/movimientos');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  },

  // Obtener historial de cajas
  obtenerHistorial: async (): Promise<Caja[]> => {
    const response = await apiClient.get<Caja[]>('/cajas/historial');
    return response.data;
  },

  // Obtener detalle de una caja específica
  obtenerDetalle: async (cajaId: string): Promise<Caja> => {
    const response = await apiClient.get<Caja>(`/cajas/${cajaId}/detalle`);
    return response.data;
  },

  // Obtener vehículos agrupados por método de pago
  obtenerVehiculosPorMetodo: async (): Promise<Record<string, Array<{
    placa: string;
    cliente_nombre: string;
    total_cobrado: number;
    fecha_cobro: string;
  }>>> => {
    try {
      const response = await apiClient.get('/cajas/vehiculos-por-metodo');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return {};
      }
      throw error;
    }
  },

  // Obtener resumen de la última caja cerrada
  obtenerUltimaCerrada: async (): Promise<{
    caja_id?: string;
    fecha_cierre: string;
    turno: string;
    vehiculos_cobrados: number;
    total_ingresos: number;
    diferencia: number;
  } | null> => {
    const response = await apiClient.get('/cajas/ultima-cerrada');
    return response.data;
  },

  // Descargar comprobante PDF de cierre
  descargarComprobanteCierre: async (cajaId: string): Promise<Blob> => {
    let lastError: any = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await apiClient.get(`/cajas/${cajaId}/comprobante-cierre`, {
          responseType: 'blob',
        });
        return response.data as Blob;
      } catch (error: any) {
        lastError = error;
        if (attempt === 0 && error?.response?.status === 404) {
          await cajasApi.sleep(400);
          continue;
        }
        break;
      }
    }
    throw lastError;
  },
};
