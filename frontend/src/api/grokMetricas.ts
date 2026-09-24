import apiClient from './client';

export interface GrokMetricasTenantRow {
  tenant_slug: string;
  tenant_nombre: string;
  usos: number;
  fotos: number;
  whatsapp: number;
  leidas: number;
  no_leidas: number;
  errores: number;
  costo_estimado_cop: number;
  costo_estimado_usd: number;
}

export interface GrokMetricasOrigenRow {
  origen: string;
  usos: number;
  exito: number;
  vacios: number;
  errores: number;
  costo_estimado_cop: number;
  costo_estimado_usd: number;
}

export interface GrokMetricasSummary {
  periodo_dias: number | null;
  from_date?: string;
  to_date?: string;
  origen_filter?: string | null;
  total_usos: number;
  total_fotos: number;
  whatsapp_count: number;
  leidas_count: number;
  no_leidas_count: number;
  error_count: number;
  billed_count: number;
  leidas_pct: number;
  costo_estimado_total_cop: number;
  costo_estimado_total_usd: number;
  costo_promedio_cop: number;
  costo_promedio_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  fx_rate_avg_usd_cop: number;
  tenant_id_filter?: string | null;
  by_origen: GrokMetricasOrigenRow[];
  by_tenant: GrokMetricasTenantRow[];
  generated_at: string;
  nota?: string;
}

export interface WhatsappEnviosEventoRow {
  evento: string;
  label: string;
  enviados_ok: number;
  fallidos: number;
}

export interface WhatsappEnviosTenantRow {
  tenant_slug: string;
  tenant_nombre: string;
  enviados_ok: number;
  fallidos: number;
  asistente: number;
  total_enviados: number;
}

export interface WhatsappEnviosSummary {
  periodo_dias: number | null;
  from_date?: string;
  to_date?: string;
  enviados_ok: number;
  fallidos: number;
  asistente: number;
  total_enviados: number;
  tenant_id_filter?: string | null;
  by_evento: WhatsappEnviosEventoRow[];
  by_tenant: WhatsappEnviosTenantRow[];
  generated_at: string;
  nota?: string;
}

export const grokMetricasApi = {
  getSummary: async (
    days: number = 30,
    tenantId?: string,
    range?: { fromDateIso?: string; toDateIso?: string },
    origen?: string
  ): Promise<GrokMetricasSummary> => {
    const response = await apiClient.get<GrokMetricasSummary>('/grok-metricas/summary', {
      params: {
        days,
        tenant_id: tenantId || undefined,
        from_date: range?.fromDateIso || undefined,
        to_date: range?.toDateIso || undefined,
        origen: origen || undefined,
      },
    });
    return response.data;
  },
  getWhatsappEnvios: async (
    days: number = 30,
    tenantId?: string,
    range?: { fromDateIso?: string; toDateIso?: string }
  ): Promise<WhatsappEnviosSummary> => {
    const response = await apiClient.get<WhatsappEnviosSummary>('/grok-metricas/whatsapp-envios', {
      params: {
        days,
        tenant_id: tenantId || undefined,
        from_date: range?.fromDateIso || undefined,
        to_date: range?.toDateIso || undefined,
      },
    });
    return response.data;
  },
};
