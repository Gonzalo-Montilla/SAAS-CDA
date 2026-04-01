import apiClient from './client';
import type { AppointmentItem, AppointmentSlot } from '../types';

export interface AppointmentCreatePayload {
  cliente_nombre: string;
  cliente_email?: string;
  cliente_celular?: string;
  placa: string;
  tipo_vehiculo: string;
  fecha: string;
  hora: string;
  notes?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const appointmentsApi = {
  listByDate: async (fecha: string, statusFilter?: string): Promise<AppointmentItem[]> => {
    const response = await apiClient.get<AppointmentItem[]>('/appointments', {
      params: { fecha, ...(statusFilter ? { status_filter: statusFilter } : {}) },
    });
    return response.data;
  },

  createInternal: async (payload: AppointmentCreatePayload): Promise<AppointmentItem> => {
    const response = await apiClient.post<AppointmentItem>('/appointments/internal', payload);
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
      throw new Error(data?.detail || 'No fue posible crear la cita');
    }
    return data as AppointmentItem;
  },
};

