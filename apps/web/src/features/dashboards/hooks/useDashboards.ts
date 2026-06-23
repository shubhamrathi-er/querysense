import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardsApi } from '../api/dashboards.api';
import { useWorkspaceStore } from '@/stores/workspace.store';

export const useDashboards = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useQuery({
    queryKey: ['dashboards', workspaceId],
    queryFn: () => dashboardsApi.getAll(workspaceId),
    enabled: !!workspaceId,
  });
};

export const useDashboard = (dashboardId: string) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => dashboardsApi.getOne(workspaceId, dashboardId),
    enabled: !!workspaceId && !!dashboardId,
  });
};

export const useCreateDashboard = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      dashboardsApi.create(workspaceId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['dashboards', workspaceId],
      });
    },
  });
};

export const useDeleteDashboard = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (dashboardId: string) =>
      dashboardsApi.delete(workspaceId, dashboardId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['dashboards', workspaceId],
      });
    },
  });
};

export const useCreateWidget = (dashboardId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (data: Parameters<typeof dashboardsApi.createWidget>[2]) =>
      dashboardsApi.createWidget(workspaceId, dashboardId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['dashboard', dashboardId],
      });
    },
  });
};

export const useDeleteWidget = (dashboardId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (widgetId: string) =>
      dashboardsApi.deleteWidget(workspaceId, dashboardId, widgetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['dashboard', dashboardId],
      });
    },
  });
};

export const useRefreshWidget = (dashboardId: string) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: ({
      widgetId,
      connectionId,
    }: {
      widgetId: string;
      connectionId: string;
    }) =>
      dashboardsApi.refreshWidget(workspaceId, dashboardId, widgetId, connectionId),
  });
};