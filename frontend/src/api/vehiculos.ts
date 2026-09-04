import apiClient from './client';
import type { Vehiculo, VehiculoRegistro, VehiculoCobro, VehiculoConsultaRunt, ReinspeccionElegibilidad } from '../types';

export interface VentaSOAT {
  placa: string;
  tipo_vehiculo: 'moto' | 'carro';
  valor_soat_comercial: number;
  cliente_nombre: string;
  cliente_documento: string;
  metodo_pago: string;
}

export interface TarifaCalculada {
  valor_rtm: number;
  valor_terceros: number;
  valor_total: number;
  descripcion_antiguedad: string;
}

interface VehiculosPendientesResponse {
  vehiculos: Vehiculo[];
  total: number;
}

interface NotificacionPasoCajaResponse {
  sent: boolean;
  has_email: boolean;
  message: string;
}

interface EnvioReciboResponse {
  sent: boolean;
  has_email: boolean;
  message: string;
  /** Incluye enlace y/o adjunto de factura electrónica (Factus/DIAN) si existía registro. */
  factura_incluida?: boolean;
  factura_adjunto_pdf?: boolean;
}

interface VehiculoPdfDownload {
  blob: Blob;
  filename: string;
}

export interface CorregirFacturaEmitidaPayload {
  motivo: 'placa' | 'documento' | 'nombre' | 'identificacion' | 'valor';
  nueva_placa?: string;
  cliente_nombre?: string;
  cliente_documento?: string;
  cliente_email?: string;
  cliente_telefono?: string;
  cliente_direccion?: string;
  valor_preventiva_nuevo?: number;
  observacion?: string;
}

export interface CorregirFacturaEmitidaResponse {
  success: boolean;
  vehiculo_id: string;
  factura_original?: string | null;
  nota_credito?: string | null;
  factura_nueva?: string | null;
  message: string;
}

export interface FacturaCorreccionHistorialItem {
  id: string;
  estado: string;
  motivo: string;
  error_detalle?: string | null;
  factura_original?: string | null;
  nota_credito?: string | null;
  factura_nueva?: string | null;
  ejecutado_por_usuario_id?: string | null;
  created_at: string;
}

export interface VehiculoFotoResponse {
  vehiculo_id: string;
  placa: string;
  total_fotos: number;
  index: number;
  foto?: string | null;
}

export interface HistorialClienteSugerencia {
  encontrado: boolean;
  fuente?: string | null;
  vehiculo_id?: string | null;
  placa?: string | null;
  cliente_nombre?: string | null;
  cliente_tipo_documento?: string | null;
  cliente_documento?: string | null;
  cliente_telefono?: string | null;
  cliente_email?: string | null;
  cliente_direccion?: string | null;
  cliente_factus_municipality_id?: number | null;
  fecha_ultima_atencion?: string | null;
}

export const vehiculosApi = {
  // Registrar un nuevo vehículo (Recepción)
  registrar: async (data: VehiculoRegistro): Promise<Vehiculo> => {
    const response = await apiClient.post<Vehiculo>('/vehiculos/registrar', data);
    return response.data;
  },

  // Editar un vehículo registrado (Recepción)
  editar: async (vehiculoId: string, data: VehiculoRegistro): Promise<Vehiculo> => {
    const response = await apiClient.put<Vehiculo>(`/vehiculos/${vehiculoId}`, data);
    return response.data;
  },

  // Consultar datos RUNT por placa (vía integración backend)
  consultarRuntPorPlaca: async (
    placa: string,
    opts?: { documentType?: string; documentNumber?: string }
  ): Promise<VehiculoConsultaRunt> => {
    const cleaned = (placa || '').trim().toUpperCase();
    const response = await apiClient.get<VehiculoConsultaRunt>(
      `/vehiculos/consulta-runt/${encodeURIComponent(cleaned)}`,
      {
        params: {
          documentType: opts?.documentType,
          documentNumber: opts?.documentNumber,
        },
      }
    );
    return response.data;
  },

  // Consultar si la placa puede reingresar por rechazo inicial
  consultarElegibilidadReinspeccion: async (
    placa: string,
    excluirVehiculoId?: string | null,
  ): Promise<ReinspeccionElegibilidad> => {
    const cleaned = (placa || '').trim().toUpperCase();
    const response = await apiClient.get<ReinspeccionElegibilidad>(
      `/vehiculos/reinspeccion/elegibilidad/${encodeURIComponent(cleaned)}`,
      excluirVehiculoId
        ? { params: { excluir_vehiculo_id: excluirVehiculoId } }
        : undefined,
    );
    return response.data;
  },

  obtenerHistorialClienteSugerencia: async (params: {
    placa?: string;
    clienteTipoDocumento?: string;
    clienteDocumento?: string;
  }): Promise<HistorialClienteSugerencia> => {
    const qp = new URLSearchParams();
    if (params.placa) qp.set('placa', (params.placa || '').trim().toUpperCase());
    if (params.clienteTipoDocumento) qp.set('cliente_tipo_documento', params.clienteTipoDocumento);
    if (params.clienteDocumento) qp.set('cliente_documento', params.clienteDocumento);
    const suffix = qp.toString();
    const response = await apiClient.get<HistorialClienteSugerencia>(
      `/vehiculos/historial-cliente-sugerencia${suffix ? `?${suffix}` : ''}`
    );
    return response.data;
  },

  // Calcular tarifa según año del modelo y tipo de vehículo
  calcularTarifa: async (anoModelo: number, tipoVehiculo: string = 'moto'): Promise<TarifaCalculada> => {
    const response = await apiClient.get<TarifaCalculada>(
      `/vehiculos/calcular-tarifa/${anoModelo}`,
      { params: { tipo_vehiculo: tipoVehiculo } }
    );
    return response.data;
  },

  // Obtener vehículos pendientes de pago (Caja)
  obtenerPendientes: async (): Promise<Vehiculo[]> => {
    const response = await apiClient.get<VehiculosPendientesResponse>('/vehiculos/pendientes');
    return Array.isArray(response.data?.vehiculos) ? response.data.vehiculos : [];
  },

  // Cobrar un vehículo (Caja)
  cobrar: async (data: VehiculoCobro): Promise<Vehiculo> => {
    const response = await apiClient.post<Vehiculo>('/vehiculos/cobrar', data);
    return response.data;
  },

  // Notificar al cliente que debe pasar a caja
  notificarPasoCaja: async (vehiculoId: string): Promise<NotificacionPasoCajaResponse> => {
    const response = await apiClient.post<NotificacionPasoCajaResponse>(`/vehiculos/${vehiculoId}/notificar-paso-caja`);
    return response.data;
  },

  // Enviar por email el mismo recibo generado en caja
  enviarReciboPagoEmail: async (vehiculoId: string, pdfFile: File): Promise<EnvioReciboResponse> => {
    const formData = new FormData();
    formData.append('receipt_file', pdfFile);
    const response = await apiClient.post<EnvioReciboResponse>(`/vehiculos/${vehiculoId}/enviar-recibo-email`, formData);
    return response.data;
  },

  descargarFormatoRecepcionPdf: async (vehiculoId: string): Promise<VehiculoPdfDownload> => {
    const response = await apiClient.get(`/vehiculos/${vehiculoId}/recepcion-formato-pdf`, {
      responseType: 'blob',
    });
    const blob = response.data as Blob;
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `recepcion_formato_${vehiculoId}.pdf`;
    if (contentDisposition) {
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
      const simpleMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
      const rawName = utf8Match?.[1] || simpleMatch?.[1];
      if (rawName) {
        filename = decodeURIComponent(rawName).replace(/[\\/:*?"<>|]/g, '_');
      }
    }
    return { blob, filename };
  },

  obtenerFotoVehiculo: async (vehiculoId: string, index: number = 0): Promise<VehiculoFotoResponse> => {
    const response = await apiClient.get<VehiculoFotoResponse>(`/vehiculos/${vehiculoId}/foto`, {
      params: { index },
      // Las fotos viajan en base64 y pueden tardar más en redes lentas.
      // Damos un margen mayor sin impactar el resto de endpoints.
      timeout: 120000,
    });
    return response.data;
  },

  // Venta solo de comisión SOAT (sin revisión)
  ventaSoat: async (data: VentaSOAT): Promise<Vehiculo> => {
    const response = await apiClient.post<Vehiculo>('/vehiculos/venta-soat', data);
    return response.data;
  },

  // Obtener detalle de un vehículo
  obtenerPorId: async (id: string): Promise<Vehiculo> => {
    const response = await apiClient.get<Vehiculo>(`/vehiculos/${id}`);
    return response.data;
  },

  // Listar vehículos con filtros y paginación
  listar: async (params?: { 
    buscar?: string;
    estado?: string; 
    fecha_desde?: string; 
    fecha_hasta?: string;
    include_formato_extra?: boolean;
    include_observaciones?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<Vehiculo[]> => {
    const response = await apiClient.get<Vehiculo[]>('/vehiculos/', { params });
    return response.data;
  },

  // Contar total de vehículos con filtros
  contarTotal: async (params?: {
    buscar?: string;
    estado?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
  }): Promise<number> => {
    const response = await apiClient.get<{ total: number }>('/vehiculos/count/total', { params });
    return response.data.total;
  },

  // Obtener vehículos cobrados hoy (Caja)
  obtenerCobradosHoy: async (): Promise<Vehiculo[]> => {
    const response = await apiClient.get<Vehiculo[]>('/vehiculos/cobrados-hoy');
    return response.data;
  },

  // Obtener vehículos cobrados en ventana reciente (Caja)
  obtenerCobradosRecientes: async (dias: number = 30): Promise<Vehiculo[]> => {
    const response = await apiClient.get<Vehiculo[]>('/vehiculos/cobrados-recientes', {
      params: { dias },
    });
    return response.data;
  },

  // Cambiar método de pago de un vehículo ya cobrado
  cambiarMetodoPago: async (
    vehiculoId: string,
    nuevoMetodo: string,
    motivo: string,
    desgloseMixto?: Record<string, number>
  ): Promise<{
    success: boolean;
    message: string;
    metodo_anterior: string;
    metodo_nuevo: string;
  }> => {
    const response = await apiClient.put(`/vehiculos/${vehiculoId}/cambiar-metodo-pago`, {
      nuevo_metodo: nuevoMetodo,
      motivo,
      desglose_mixto: nuevoMetodo === 'mixto' ? desgloseMixto : undefined,
    });
    return response.data;
  },

  corregirFacturaEmitida: async (
    vehiculoId: string,
    payload: CorregirFacturaEmitidaPayload
  ): Promise<CorregirFacturaEmitidaResponse> => {
    const response = await apiClient.post<CorregirFacturaEmitidaResponse>(
      `/vehiculos/${vehiculoId}/corregir-factura-emitida`,
      payload
    );
    return response.data;
  },

  listarCorreccionesFacturaEmitida: async (vehiculoId: string): Promise<FacturaCorreccionHistorialItem[]> => {
    const response = await apiClient.get<FacturaCorreccionHistorialItem[]>(
      `/vehiculos/${vehiculoId}/factura-correcciones`
    );
    return response.data;
  },
};
