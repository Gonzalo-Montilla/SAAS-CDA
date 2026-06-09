import apiClient from './client';

export interface RuntMetricasProviderRow {
  provider: string;
  consultas: number;
  costo_estimado_cop: number;
  costo_estimado_usd: number;
  costo_resuelto_cop: number;
  costo_resuelto_usd: number;
}

export interface RuntMetricasSummary {
  periodo_dias: number;
  total_consultas: number;
  success_count: number;
  empty_count: number;
  error_count: number;
  fallback_count: number;
  success_rate_pct: number;
  fallback_rate_pct: number;
  costo_estimado_total_cop: number;
  costo_estimado_total_usd: number;
  costo_resuelto_total_cop: number;
  costo_resuelto_total_usd: number;
  costo_promedio_cop: number;
  costo_promedio_usd: number;
  fx_rate_avg_usd_cop: number;
  tenant_id_filter?: string | null;
  generated_by?: string | null;
  by_provider: RuntMetricasProviderRow[];
  by_tenant: Array<{
    tenant_slug: string;
    tenant_nombre: string;
    consultas: number;
    resueltas: number;
    no_resueltas: number;
    empty_count: number;
    error_count: number;
    costo_estimado_cop: number;
    costo_estimado_usd: number;
    costo_resuelto_cop: number;
    costo_resuelto_usd: number;
    placaapi_resueltas: number;
    placaapi_costo_resuelto_cop: number;
    placaapi_costo_resuelto_usd: number;
    verifik_resueltas: number;
    verifik_costo_resuelto_cop: number;
    verifik_costo_resuelto_usd: number;
  }>;
  generated_at: string;
}

export const runtMetricasApi = {
  getSummary: async (days: number = 30, tenantId?: string): Promise<RuntMetricasSummary> => {
    const response = await apiClient.get<RuntMetricasSummary>('/runt-metricas/summary', {
      params: { days, tenant_id: tenantId || undefined },
    });
    return response.data;
  },
};

