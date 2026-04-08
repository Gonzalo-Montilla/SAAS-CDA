import { apiClient } from './client';
import type { SaaSSucursalResumen } from '../types';

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
