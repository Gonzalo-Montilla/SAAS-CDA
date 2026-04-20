import apiClient from './client';

export interface FactusEnvCredentials {
  client_id_configured: boolean;
  client_id_hint: string | null;
  client_secret_configured: boolean;
  api_username: string | null;
  api_password_configured: boolean;
  base_url: string;
}

export interface FactusSettings {
  modo: 'manual' | 'factus';
  use_sandbox: boolean;
  sandbox: FactusEnvCredentials;
  production: FactusEnvCredentials;
  client_id_configured: boolean;
  client_id_hint: string | null;
  client_secret_configured: boolean;
  api_username: string | null;
  api_password_configured: boolean;
  default_numbering_range_id: number | null;
  /** Rango Factus para documento soporte (DIAN tipo 24); distinto del de factura 01. */
  documento_soporte_numbering_range_id: number | null;
  base_url_effective: string;
  /** Pedir a Factus enviar PDF/enlace al correo del proveedor al validar documento soporte. */
  documento_soporte_notificar_proveedor_factus: boolean;
  /** Copia interna al correo del CDA (SMTP CDASOFT) tras emitir documento soporte. */
  documento_soporte_correo_notificacion_cda: string | null;
  /** Conceptos de retención que el CDA usa en documento soporte (subconjunto del motor futuro). */
  dse_retencion_usar_compras: boolean;
  dse_retencion_usar_servicios: boolean;
  dse_retencion_usar_arrendamiento: boolean;
  dse_retencion_usar_honorarios: boolean;
}

/** PATCH /factus/settings/modo — solo admin del tenant. */
export interface FactusModoPatch {
  modo: 'manual' | 'factus';
}

/** Cuerpo de PUT factus-settings SaaS — secretos vacíos no sobrescriben lo guardado. */
export interface FactusSettingsUpdatePayload {
  modo: 'manual' | 'factus';
  use_sandbox: boolean;
  client_id?: string | null;
  client_secret?: string | null;
  api_username?: string | null;
  api_password?: string | null;
  production_client_id?: string | null;
  production_client_secret?: string | null;
  production_api_username?: string | null;
  production_api_password?: string | null;
  default_numbering_range_id?: number | null;
  documento_soporte_numbering_range_id?: number | null;
  documento_soporte_notificar_proveedor_factus?: boolean | null;
  documento_soporte_correo_notificacion_cda?: string | null;
}

export interface FactusDocumentoSoporteNotificacionesPatch {
  documento_soporte_notificar_proveedor_factus: boolean;
  documento_soporte_correo_notificacion_cda?: string | null;
}

/** PATCH /factus/settings/documento-soporte-entorno-retenciones — solo admin. */
export interface FactusDseEntornoRetencionesPatch {
  dse_retencion_usar_compras: boolean;
  dse_retencion_usar_servicios: boolean;
  dse_retencion_usar_arrendamiento: boolean;
  dse_retencion_usar_honorarios: boolean;
}

export interface FactusTestConnectionResult {
  ok: boolean;
  message: string;
  expires_in?: number | null;
  token_type?: string | null;
  environment: 'sandbox' | 'production';
}

/** Rango GET /saas/auth/tenants/.../factus-numbering-ranges — el `id` es el que va en ID rango de numeración. */
export interface FactusNumberingRangeItem {
  id: number;
  document?: string | null;
  prefix?: string | null;
  resolution_number?: string | null;
  is_expired?: boolean | null;
  is_active?: number | null;
  current?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}

/** GET /factus/municipalities — el `id` es el que guarda Factus en factus_municipality_id (no el `code` DIAN). */
export interface FactusMunicipalityItem {
  id: number;
  code?: string | null;
  name?: string | null;
  department?: string | null;
}

export const factusApi = {
  /** Modo manual vs Factus (lectura). Credenciales las configura el backoffice SaaS. */
  getSettings: async (): Promise<FactusSettings> => {
    const response = await apiClient.get<FactusSettings>('/factus/settings');
    return response.data;
  },

  /** Conmutar manual ↔ Factus en emergencia (solo administrador del CDA). */
  patchModo: async (payload: FactusModoPatch): Promise<FactusSettings> => {
    const response = await apiClient.patch<FactusSettings>('/factus/settings/modo', payload);
    return response.data;
  },

  patchDocumentoSoporteNotificaciones: async (
    payload: FactusDocumentoSoporteNotificacionesPatch,
  ): Promise<FactusSettings> => {
    const response = await apiClient.patch<FactusSettings>(
      '/factus/settings/documento-soporte-notificaciones',
      payload,
    );
    return response.data;
  },

  patchDocumentoSoporteEntornoRetenciones: async (
    payload: FactusDseEntornoRetencionesPatch,
  ): Promise<FactusSettings> => {
    const response = await apiClient.patch<FactusSettings>(
      '/factus/settings/documento-soporte-entorno-retenciones',
      payload,
    );
    return response.data;
  },

  /** Prueba de token OAuth Factus (solo admin; requiere modo factus y credenciales). */
  testConnection: async (): Promise<FactusTestConnectionResult> => {
    const response = await apiClient.post<FactusTestConnectionResult>('/factus/test-connection');
    return response.data;
  },

  /** Rangos numeración Factus (solo admin; ambiente y credenciales activos en backoffice). */
  listNumberingRanges: async (): Promise<FactusNumberingRangeItem[]> => {
    const response = await apiClient.get<FactusNumberingRangeItem[]>('/factus/numbering-ranges');
    return response.data;
  },

  /** Búsqueda municipios Factus (admin CDA; mín. 2 caracteres). */
  searchMunicipalities: async (name: string): Promise<FactusMunicipalityItem[]> => {
    const response = await apiClient.get<FactusMunicipalityItem[]>('/factus/municipalities', {
      params: { name },
    });
    return response.data;
  },
};
