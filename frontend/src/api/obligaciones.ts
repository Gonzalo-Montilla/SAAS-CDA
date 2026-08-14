import apiClient from './client';

export type EstadoObligacion = 'abierta' | 'parcial' | 'pagada' | 'anulada';

export interface ObligacionProveedor {
  id: string;
  sucursal_id?: string | null;
  proveedor_catalogo_id?: string | null;
  proveedor_nombre: string;
  proveedor_documento: string;
  proveedor_tipo_documento?: string | null;
  numero_documento: string;
  fecha_emision: string;
  fecha_vencimiento?: string | null;
  concepto: string;
  notas?: string | null;
  valor_total: number;
  saldo_pendiente: number;
  estado: EstadoObligacion | string;
  created_at: string;
  updated_at?: string | null;
  dias_vencida: number;
  tramo_vencimiento: string;
}

export interface ObligacionesListResponse {
  resumen: {
    total_items: number;
    saldo_pendiente_total: number;
    vencidas_count: number;
    vencidas_saldo: number;
    abiertas: number;
    parciales: number;
    pagadas: number;
  };
  items: ObligacionProveedor[];
}

export interface ObligacionCreatePayload {
  proveedor_catalogo_id?: string | null;
  proveedor_nombre: string;
  proveedor_documento: string;
  proveedor_tipo_documento?: string | null;
  numero_documento: string;
  fecha_emision: string;
  fecha_vencimiento?: string | null;
  concepto: string;
  notas?: string | null;
  valor_total: number;
  sucursal_id?: string | null;
}

export interface ObligacionPagoPayload {
  monto: number;
  fecha_pago?: string | null;
  notas?: string | null;
  movimiento_tesoreria_id?: string | null;
}

export const obligacionesApi = {
  listar: async (params?: {
    estado?: string;
    q?: string;
    soloPendientes?: boolean;
    limit?: number;
  }): Promise<ObligacionesListResponse> => {
    const qp = new URLSearchParams();
    if (params?.estado) qp.set('estado', params.estado);
    if (params?.q) qp.set('q', params.q);
    if (params?.soloPendientes) qp.set('solo_pendientes', 'true');
    if (params?.limit) qp.set('limit', String(params.limit));
    const suffix = qp.toString();
    const response = await apiClient.get<ObligacionesListResponse>(
      `/obligaciones${suffix ? `?${suffix}` : ''}`,
    );
    return response.data;
  },

  crear: async (payload: ObligacionCreatePayload): Promise<ObligacionProveedor> => {
    const response = await apiClient.post<ObligacionProveedor>('/obligaciones', payload);
    return response.data;
  },

  actualizar: async (
    id: string,
    payload: Partial<ObligacionCreatePayload> & { estado?: EstadoObligacion },
  ): Promise<ObligacionProveedor> => {
    const response = await apiClient.patch<ObligacionProveedor>(`/obligaciones/${id}`, payload);
    return response.data;
  },

  registrarPago: async (id: string, payload: ObligacionPagoPayload): Promise<ObligacionProveedor> => {
    const response = await apiClient.post<ObligacionProveedor>(`/obligaciones/${id}/pagos`, payload);
    return response.data;
  },
};
