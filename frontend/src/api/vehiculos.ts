import apiClient from './client';
import type { Vehiculo, VehiculoRegistro, VehiculoCobro } from '../types';

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

  // Cambiar método de pago de un vehículo ya cobrado
  cambiarMetodoPago: async (vehiculoId: string, nuevoMetodo: string, motivo: string): Promise<{
    success: boolean;
    message: string;
    metodo_anterior: string;
    metodo_nuevo: string;
  }> => {
    const response = await apiClient.put(`/vehiculos/${vehiculoId}/cambiar-metodo-pago`, null, {
      params: { nuevo_metodo: nuevoMetodo, motivo }
    });
    return response.data;
  },
};
