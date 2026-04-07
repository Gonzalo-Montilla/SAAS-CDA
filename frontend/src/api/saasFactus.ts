import { apiClient } from './client';
import type {
  FactusNumberingRangeItem,
  FactusSettings,
  FactusSettingsUpdatePayload,
  FactusTestConnectionResult,
} from './factus';

export const saasFactusApi = {
  getSettings: async (tenantId: string): Promise<FactusSettings> => {
    const response = await apiClient.get<FactusSettings>(
      `/saas/auth/tenants/${tenantId}/factus-settings`,
    );
    return response.data;
  },

  updateSettings: async (
    tenantId: string,
    body: FactusSettingsUpdatePayload,
  ): Promise<FactusSettings> => {
    const response = await apiClient.put<FactusSettings>(
      `/saas/auth/tenants/${tenantId}/factus-settings`,
      body,
    );
    return response.data;
  },

  testConnection: async (tenantId: string): Promise<FactusTestConnectionResult> => {
    const response = await apiClient.post<FactusTestConnectionResult>(
      `/saas/auth/tenants/${tenantId}/factus-test-connection`,
    );
    return response.data;
  },

  listNumberingRanges: async (tenantId: string): Promise<FactusNumberingRangeItem[]> => {
    const response = await apiClient.get<FactusNumberingRangeItem[]>(
      `/saas/auth/tenants/${tenantId}/factus-numbering-ranges`,
    );
    return response.data;
  },
};
