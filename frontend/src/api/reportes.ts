import apiClient from './client';

export interface AgendamientoMetricasResponse {
  periodo: string;
  fecha_generacion: string;
  total_citas: number;
  por_estado: {
    scheduled: number;
    confirmed: number;
    checked_in: number;
    cancelled: number;
    no_show: number;
  };
  por_origen: {
    public_link: number;
    manual: number;
    otros: number;
  };
  citas_con_email: number;
  citas_sin_email: number;
  recordatorios_enviados: number;
  recordatorios_pendientes: number;
  recordatorios_fallidos: number;
  recordatorios_omitidos: number;
  tasa_check_in_pct: number;
  serie_diaria: Array<{
    fecha: string;
    total: number;
    checked_in: number;
    canceladas: number;
    no_show: number;
  }>;
}

/** Cierres de caja para auditoría (GET /reportes/cierres-caja). */
export interface CierreCajaReporteItem {
  id: string;
  cajero_nombre: string;
  sucursal_nombre?: string | null;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  turno: string;
  monto_inicial: number;
  monto_final_sistema?: number | null;
  monto_final_fisico?: number | null;
  diferencia?: number | null;
  observaciones_cierre?: string | null;
}

export interface DashboardOperativoResponse {
  periodo: string;
  resumen_operativo: {
    ingresados_periodo: number;
    pagados_periodo: number;
    terminados_periodo: number;
    pendientes_caja: number;
    pendientes_pista: number;
    en_pista: number;
    max_espera_caja_min: number;
  };
  sla: {
    objetivo_minutos: number;
    promedio_minutos: number;
    p50_minutos: number;
    p90_minutos: number;
    cumplimiento_objetivo_pct: number;
    muestra: number;
  };
  casos_en_riesgo: Array<{
    id: string;
    placa: string;
    cliente: string;
    estado: string;
    minutos_espera: number;
  }>;
  fecha_generacion: string;
}

export const reportesApi = {
  getAgendamientoMetricas: async (queryParams: string): Promise<AgendamientoMetricasResponse> => {
    const response = await apiClient.get<AgendamientoMetricasResponse>(
      `/reportes/agendamiento-metricas?${queryParams}`,
    );
    return response.data;
  },

  getDashboardOperativo: async (params: {
    modoVista: 'dia' | 'rango';
    fechaSeleccionada: string;
    fechaInicio: string;
    fechaFin: string;
    /** e.g. `&consolidar_todas=true` or `&sucursal_id=uuid` */
    sedeQuerySuffix?: string;
  }): Promise<DashboardOperativoResponse> => {
    const query =
      params.modoVista === 'rango'
        ? `fecha_inicio=${params.fechaInicio}&fecha_fin=${params.fechaFin}`
        : `fecha=${params.fechaSeleccionada}`;
    const suffix = params.sedeQuerySuffix ?? '';
    const response = await apiClient.get<DashboardOperativoResponse>(
      `/reportes/dashboard-operativo?${query}${suffix}`,
    );
    return response.data;
  },

  getCierresCaja: async (queryString: string): Promise<CierreCajaReporteItem[]> => {
    const response = await apiClient.get<CierreCajaReporteItem[]>(`/reportes/cierres-caja?${queryString}`);
    return response.data;
  },
};

