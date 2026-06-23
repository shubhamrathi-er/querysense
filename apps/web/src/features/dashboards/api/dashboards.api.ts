import { apiClient } from '@/lib/api-client';
import type { Dashboard, Widget, WidgetData } from '../types';

interface ApiResponse<T> { data: T }

export const dashboardsApi = {
  getAll: async (workspaceId: string): Promise<Dashboard[]> => {
    const res = await apiClient.get(
      `/workspaces/${workspaceId}/dashboards`,
    ) as ApiResponse<Dashboard[]>;
    return res.data;
  },

  getOne: async (workspaceId: string, dashboardId: string): Promise<Dashboard> => {
    const res = await apiClient.get(
      `/workspaces/${workspaceId}/dashboards/${dashboardId}`,
    ) as ApiResponse<Dashboard>;
    return res.data;
  },

  create: async (workspaceId: string, data: {
    name: string;
    description?: string;
  }): Promise<Dashboard> => {
    const res = await apiClient.post(
      `/workspaces/${workspaceId}/dashboards`,
      data,
    ) as ApiResponse<Dashboard>;
    return res.data;
  },

  delete: async (workspaceId: string, dashboardId: string): Promise<void> => {
    await apiClient.delete(
      `/workspaces/${workspaceId}/dashboards/${dashboardId}`,
    );
  },

  createWidget: async (
    workspaceId: string,
    dashboardId: string,
    data: {
      title: string;
      widgetType: string;
      sql: string;
      chartConfig?: Record<string, unknown>;
      position: Record<string, number>;
      connectionId: string;
    },
  ): Promise<Widget> => {
    const res = await apiClient.post(
      `/workspaces/${workspaceId}/dashboards/${dashboardId}/widgets`,
      data,
    ) as ApiResponse<Widget>;
    return res.data;
  },

  deleteWidget: async (
    workspaceId: string,
    dashboardId: string,
    widgetId: string,
  ): Promise<void> => {
    await apiClient.delete(
      `/workspaces/${workspaceId}/dashboards/${dashboardId}/widgets/${widgetId}`,
    );
  },

  refreshWidget: async (
    workspaceId: string,
    dashboardId: string,
    widgetId: string,
    connectionId: string,
  ): Promise<WidgetData> => {
    const res = await apiClient.post(
      `/workspaces/${workspaceId}/dashboards/${dashboardId}/widgets/${widgetId}/refresh?connectionId=${connectionId}`,
    ) as ApiResponse<WidgetData>;
    return res.data;
  },
};