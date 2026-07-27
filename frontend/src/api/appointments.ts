import apiClient from './client';
import type { AppointmentItem, AppointmentSlot } from '../types';

export interface AppointmentCreatePayload {
  cliente_nombre: string;
  cliente_tipo_documento?: 'CC' | 'CE' | 'PA' | 'NIT';
  cliente_documento?: string;
  cliente_email: string;
  cliente_celular?: string;
  placa: string;
  tipo_vehiculo: string;
  ano_modelo?: string;
  fecha: string;
  hora: string;
  notes?: string;
}

export interface AppointmentEstimatedRtm {
  disponible: boolean;
  tipo_vehiculo: string;
  ano_modelo: number;
  valor_rtm?: number | null;
  valor_terceros?: number | null;
  valor_total?: number | null;
  descripcion_antiguedad?: string | null;
  mensaje: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

function normalizeApiErrorDetail(detail: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as any;
    if (typeof first?.msg === 'string' && first.msg.trim()) return first.msg;
  }
  return 'No fue posible completar la solicitud';
}

export const appointmentsApi = {
  listByDate: async (fecha: string, statusFilter?: string): Promise<AppointmentItem[]> => {
    // Barra final obligatoria: sin ella FastAPI responde 307 y el redirect puede perder el header Authorization → 401.
    const response = await apiClient.get<AppointmentItem[]>('/appointments/', {
      params: { fecha, ...(statusFilter ? { status_filter: statusFilter } : {}) },
    });
    return response.data;
  },

  createInternal: async (payload: AppointmentCreatePayload): Promise<AppointmentItem> => {
    try {
      const response = await apiClient.post<AppointmentItem>('/appointments/internal', payload);
      return response.data;
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      throw new Error(normalizeApiErrorDetail(detail) || 'No fue posible crear la cita');
    }
  },

  updateStatus: async (
    appointmentId: string,
    status: 'confirmed' | 'cancelled' | 'no_show'
  ): Promise<AppointmentItem> => {
    const response = await apiClient.patch<AppointmentItem>(`/appointments/${appointmentId}/status`, {
      status,
    });
    return response.data;
  },

  markCheckIn: async (
    appointmentId: string,
  ): Promise<{
    success: boolean;
    message: string;
    prefill?: {
      placa?: string;
      tipo_vehiculo?: string;
      cliente_nombre?: string;
      cliente_tipo_documento?: 'CC' | 'CE' | 'PA' | 'NIT';
      cliente_documento?: string;
      cliente_telefono?: string;
      cliente_email?: string;
    };
  }> => {
    const response = await apiClient.post<{
      success: boolean;
      message: string;
      prefill?: {
        placa?: string;
        tipo_vehiculo?: string;
        cliente_nombre?: string;
        cliente_tipo_documento?: 'CC' | 'CE' | 'PA' | 'NIT';
        cliente_documento?: string;
        cliente_telefono?: string;
        cliente_email?: string;
      };
    }>(
      `/appointments/${appointmentId}/check-in`,
    );
    return response.data;
  },

  getPublicAvailability: async (tenantSlug: string, fecha: string): Promise<AppointmentSlot[]> => {
    const response = await fetch(
      `${API_URL}/appointments/public/${encodeURIComponent(tenantSlug)}/availability?fecha=${encodeURIComponent(fecha)}`,
    );
    if (!response.ok) {
      throw new Error('No fue posible cargar disponibilidad');
    }
    return response.json();
  },

  createPublic: async (tenantSlug: string, payload: AppointmentCreatePayload): Promise<AppointmentItem> => {
    const response = await fetch(`${API_URL}/appointments/public/${encodeURIComponent(tenantSlug)}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(normalizeApiErrorDetail(data?.detail) || 'No fue posible crear la cita');
    }
    return data as AppointmentItem;
  },

  getPublicEstimatedRtm: async (
    tenantSlug: string,
    anoModelo: number,
    tipoVehiculo: string
  ): Promise<AppointmentEstimatedRtm> => {
    const response = await fetch(
      `${API_URL}/appointments/public/${encodeURIComponent(tenantSlug)}/estimated-rtm?ano_modelo=${encodeURIComponent(
        String(anoModelo)
      )}&tipo_vehiculo=${encodeURIComponent(tipoVehiculo)}`
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(normalizeApiErrorDetail(data?.detail) || 'No fue posible estimar la tarifa');
    }
    return data as AppointmentEstimatedRtm;
  },

  getInternalEstimatedRtm: async (
    anoModelo: number,
    tipoVehiculo: string
  ): Promise<AppointmentEstimatedRtm> => {
    const response = await apiClient.get<AppointmentEstimatedRtm>('/appointments/estimated-rtm', {
      params: { ano_modelo: anoModelo, tipo_vehiculo: tipoVehiculo },
    });
    return response.data;
  },
};

