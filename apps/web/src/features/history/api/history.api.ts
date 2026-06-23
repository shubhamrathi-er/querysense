import { apiClient } from '@/lib/api-client';
import type {
  QueryHistoryPage,
  QueryHistoryStats,
  HistoryFilters,
} from '../types';

interface ApiResponse<T> {
  data: T;
}

export const historyApi = {
  list: async (
    workspaceId: string,
    filters: HistoryFilters,
  ): Promise<QueryHistoryPage> => {
    const params: Record<string, string | number> = {};
    if (filters.page) params.page = filters.page;
    if (filters.pageSize) params.pageSize = filters.pageSize;
    if (filters.connectionId) params.connectionId = filters.connectionId;
    if (filters.status) params.status = filters.status;
    if (filters.search) params.search = filters.search;
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/query-history`,
      { params },
    )) as ApiResponse<QueryHistoryPage>;
    return res.data;
  },

  stats: async (workspaceId: string): Promise<QueryHistoryStats> => {
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/query-history/stats`,
    )) as ApiResponse<QueryHistoryStats>;
    return res.data;
  },
};
