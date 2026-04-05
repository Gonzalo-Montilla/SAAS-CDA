import apiClient, { apiBaseUrl } from './client';

export interface MovimientoTesoreria {
  id: string;
  tipo: 'ingreso' | 'egreso';
  categoria_ingreso?: string;
  categoria_egreso?: string;
  monto: number;
  concepto: string;
  metodo_pago: string;
  origen_caja_id?: string;
  numero_comprobante?: string;
  fecha_movimiento: string;
  created_at: string;
  created_by: string;
}

export interface ResumenTesoreria {
  saldo_actual: number;
  total_ingresos: number;
  total_egresos: number;
  cantidad_movimientos: number;
  ingresos_por_categoria: Record<string, number>;
  egresos_por_categoria: Record<string, number>;
  saldo_bajo_umbral: boolean;
  umbral_minimo: number;
}

export interface DesgloseSaldo {
  desglose: Record<string, number>;
  total: number;
  fecha_calculo: string;
}

export interface ConfiguracionTesoreria {
  id: string;
  saldo_minimo_alerta: number;
  notificar_saldo_bajo: boolean;
  email_notificacion?: string;
  updated_at: string;
}

export interface Categoria {
  value: string;
  label: string;
}

export interface CategoriasResponse {
  ingresos: Categoria[];
  egresos: Categoria[];
  metodos_pago: Categoria[];
}

export const tesoreriaApi = {
  // Movimientos
  crearMovimiento: async (data: any): Promise<MovimientoTesoreria> => {
    const response = await apiClient.post<MovimientoTesoreria>('/tesoreria/movimientos', data);
    return response.data;
  },

  listarMovimientos: async (params?: {
    tipo?: string;
    categoria?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
    metodo_pago?: string;
    limit?: number;
    consolidar_todas?: boolean;
  }): Promise<MovimientoTesoreria[]> => {
    const response = await apiClient.get<MovimientoTesoreria[]>('/tesoreria/movimientos', { params });
    return response.data;
  },

  obtenerMovimiento: async (id: string): Promise<MovimientoTesoreria> => {
    const response = await apiClient.get<MovimientoTesoreria>(`/tesoreria/movimientos/${id}`);
    return response.data;
  },

  // Saldo y resumen
  obtenerSaldoActual: async (params?: { consolidar_todas?: boolean }): Promise<{
    saldo_actual: number;
    fecha_calculo: string;
  }> => {
    const response = await apiClient.get('/tesoreria/saldo-actual', { params });
    return response.data;
  },

  obtenerResumen: async (params?: {
    fecha_desde?: string;
    fecha_hasta?: string;
    consolidar_todas?: boolean;
  }): Promise<ResumenTesoreria> => {
    const response = await apiClient.get<ResumenTesoreria>('/tesoreria/resumen', { params });
    return response.data;
  },

  // Desglose de saldo
  obtenerDesgloseSaldo: async (params?: { consolidar_todas?: boolean }): Promise<DesgloseSaldo> => {
    const response = await apiClient.get<DesgloseSaldo>('/tesoreria/desglose-saldo', { params });
    return response.data;
  },

  obtenerDesgloseEfectivo: async (params?: { consolidar_todas?: boolean }): Promise<any> => {
    const response = await apiClient.get('/tesoreria/desglose-efectivo', { params });
    return response.data;
  },

  // Configuración
  obtenerConfiguracion: async (): Promise<ConfiguracionTesoreria> => {
    const response = await apiClient.get<ConfiguracionTesoreria>('/tesoreria/configuracion');
    return response.data;
  },

  actualizarConfiguracion: async (data: Partial<ConfiguracionTesoreria>): Promise<ConfiguracionTesoreria> => {
    const response = await apiClient.put<ConfiguracionTesoreria>('/tesoreria/configuracion', data);
    return response.data;
  },

  // Categorías
  obtenerCategorias: async (): Promise<CategoriasResponse> => {
    const response = await apiClient.get<CategoriasResponse>('/tesoreria/categorias');
    return response.data;
  },

  // Comprobantes
  descargarComprobanteEgreso: async (movimientoId: string): Promise<void> => {
    // Obtener token del localStorage
    const token = localStorage.getItem('access_token');
    if (!token) {
      throw new Error('No hay token de autenticación');
    }
    
    // Usar fetch en lugar de axios para mejor manejo de blobs
    const response = await fetch(
      `${apiBaseUrl}/tesoreria/movimientos/${movimientoId}/comprobante`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Error al descargar comprobante: ${response.status}`);
    }
    
    // Obtener blob y crear URL
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Obtener nombre del archivo del header Content-Disposition si existe
    const contentDisposition = response.headers.get('content-disposition');
    let filename = `Comprobante_Egreso_${movimientoId}.pdf`;
    
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
    }
    
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
