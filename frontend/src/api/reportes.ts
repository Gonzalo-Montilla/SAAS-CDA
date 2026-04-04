import apiClient from './client';

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
};

