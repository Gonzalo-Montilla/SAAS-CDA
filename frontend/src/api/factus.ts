import apiClient from './client';

export interface FactusSettings {
  modo: 'manual' | 'factus';
  use_sandbox: boolean;
  client_id_configured: boolean;
  client_id_hint: string | null;
  client_secret_configured: boolean;
  api_username: string | null;
  api_password_configured: boolean;
  default_numbering_range_id: number | null;
  base_url_effective: string;
}

/** Cuerpo de PUT /factus/settings — secretos vacíos no sobrescriben lo guardado. */
export interface FactusSettingsUpdatePayload {
  modo: 'manual' | 'factus';
  use_sandbox: boolean;
  client_id?: string | null;
  client_secret?: string | null;
  api_username?: string | null;
  api_password?: string | null;
  default_numbering_range_id?: number | null;
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

export const factusApi = {
  /** Solo lectura (modo manual vs Factus). La edición la hace el backoffice SaaS. */
  getSettings: async (): Promise<FactusSettings> => {
    const response = await apiClient.get<FactusSettings>('/factus/settings');
    return response.data;
  },
};
