import apiClient from './client';
import type { TenantBillingInfo } from '../types';

export type TenantPlanItem = {
  code: string;
  label: string;
  duration_days: number;
  base_price: number;
  additional_branch_price: number;
  included_branches: number;
  iva_rate: number;
  is_prepay: boolean;
};

export type TenantQuote = {
  plan_code: string;
  plan_label: string;
  sedes_totales: number;
  included_branches: number;
  chargeable_additional_branches: number;
  subtotal: number;
  iva: number;
  total: number;
  period_days: number;
};

export type InitPaymentOut = {
  session_id: string;
  total_cop: number;
  mode: 'widget' | 'redirect' | 'unconfigured' | 'mock';
  redirect_url?: string | null;
  wompi_reference?: string | null;
  wompi_public_key?: string | null;
  wompi_amount_in_cents?: number | null;
  wompi_currency?: string | null;
  wompi_signature_integrity?: string | null;
  wompi_redirect_url?: string | null;
  wompi_customer_email?: string | null;
  wompi_customer_full_name?: string | null;
  message?: string | null;
};

export async function fetchTenantBillingGate(): Promise<TenantBillingInfo> {
  const { data } = await apiClient.get<TenantBillingInfo>('/tenant/billing/gate');
  return data;
}

export async function listTenantPlans(): Promise<TenantPlanItem[]> {
  const { data } = await apiClient.get<TenantPlanItem[]>('/tenant/billing/plans');
  return data;
}

export async function quoteTenantPlan(planCode: string, sedesTotales: number): Promise<TenantQuote> {
  const { data } = await apiClient.post<TenantQuote>('/tenant/billing/quote', {
    plan_code: planCode,
    sedes_totales: sedesTotales,
  });
  return data;
}

export async function initTenantPayment(
  planCode: string,
  sedesTotales: number
): Promise<InitPaymentOut> {
  const { data } = await apiClient.post<InitPaymentOut>('/tenant/billing/init-payment', {
    plan_code: planCode,
    sedes_totales: sedesTotales,
  });
  return data;
}

export type ConfirmCheckoutReturnResult = {
  ok: boolean;
  duplicate?: boolean;
  reason?: string;
};

/** Tras el redirect Wompi: reenvía session + transaction_id de la query. */
export async function confirmTenantCheckoutReturn(body: {
  session_id: string;
  transaction_id?: string;
}): Promise<ConfirmCheckoutReturnResult> {
  const { data } = await apiClient.post<ConfirmCheckoutReturnResult>('/tenant/billing/confirm-return', body);
  return data;
}

export async function completeTenantCheckoutMock(sessionId: string): Promise<void> {
  await apiClient.post('/tenant/billing/complete-mock', {}, { params: { session_id: sessionId } });
}

export type SaasFeLatest = {
  session_id: string | null;
  plan_code: string | null;
  total_cop: number | null;
  saas_fe_status: string | null;
  saas_fe_error: string | null;
  saas_fe_error_category: string | null;
  saas_fe_reference_code: string | null;
  numero_documento: string | null;
  cufe: string | null;
  public_url: string | null;
};

export async function fetchLatestSaasFe(): Promise<SaasFeLatest> {
  const { data } = await apiClient.get<SaasFeLatest>('/tenant/billing/saas-fe/latest');
  return data;
}

export async function retrySaasFactusEmission(sessionId: string): Promise<SaasFeLatest> {
  const { data } = await apiClient.post<SaasFeLatest>(
    `/tenant/billing/sessions/${encodeURIComponent(sessionId)}/retry-saas-factus`
  );
  return data;
}
