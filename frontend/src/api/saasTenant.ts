import { apiClient } from './client';
import type { SaaSSucursalResumen } from '../types';

export interface SaaSTenantLogoUpdateResponse {
  logo_url: string | null;
}

export async function patchSaasTenantLogo(
  tenantId: string,
  opts: { logoUrl?: string; logoFile?: File | null },
): Promise<SaaSTenantLogoUpdateResponse> {
  const form = new FormData();
  if (opts.logoFile) {
    form.append('logo_file', opts.logoFile);
  } else if (opts.logoUrl?.trim()) {
    form.append('logo_url', opts.logoUrl.trim());
  } else {
    throw new Error('Debes indicar URL del logo o un archivo');
  }
  const r = await apiClient.patch<SaaSTenantLogoUpdateResponse>(
    `/saas/auth/tenants/${tenantId}/logo`,
    form,
  );
  return r.data;
}

export async function patchSaasSucursalUbicacion(
  tenantId: string,
  sucursalId: string,
  body: { ciudad?: string | null; direccion?: string | null; factus_municipality_id?: number | null },
): Promise<SaaSSucursalResumen> {
  const r = await apiClient.patch<SaaSSucursalResumen>(
    `/saas/auth/tenants/${tenantId}/sucursales/${sucursalId}`,
    body,
  );
  return r.data;
}
