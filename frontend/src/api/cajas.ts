import apiClient, { apiBaseUrl } from './client';
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

  // Obtener historial de cajas (últimas N por defecto, sin filtro de fecha)
  obtenerHistorial: async (limit = 10): Promise<Caja[]> => {
    const response = await apiClient.get<Caja[]>('/cajas/historial', {
      params: { limit },
    });
    return response.data;
  },

  /** Por día de cierre (calendario Colombia en servidor). Solo cajas cerradas en ese rango. */
  obtenerHistorialPorFechaCierre: async (
    fechaCierreDesde: string,
    fechaCierreHasta: string,
    limit = 200,
  ): Promise<Caja[]> => {
    const response = await apiClient.get<Caja[]>('/cajas/historial', {
      params: {
        fecha_cierre_desde: fechaCierreDesde,
        fecha_cierre_hasta: fechaCierreHasta,
        limit,
      },
    });
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

  /** Comprobante PDF de egreso de caja (gasto / devolución / ajuste). Mismo alcance de sede que reportes. */
  descargarComprobanteEgresoCaja: async (
    movimientoId: string,
    opts?: { consolidarTodas?: boolean; sucursalId?: string },
  ): Promise<string> => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      throw new Error('No hay token de autenticación');
    }
    const params = new URLSearchParams();
    if (opts?.consolidarTodas) params.set('consolidar_todas', 'true');
    if (opts?.sucursalId?.trim()) params.set('sucursal_id', opts.sucursalId.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';

    const response = await fetch(
      `${apiBaseUrl}/cajas/movimientos/${movimientoId}/comprobante-egreso${qs}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      throw new Error(`Error al descargar comprobante: ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const contentDisposition = response.headers.get('content-disposition');
    let filename = `comprobante_egreso_caja_${movimientoId.slice(0, 8)}.pdf`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (filenameMatch?.[1]) {
        filename = filenameMatch[1].trim();
      }
    }
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return filename;
  },
};
