import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { historyApi } from '../api/history.api';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { HistoryFilters } from '../types';

export const useQueryHistory = (filters: HistoryFilters) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useQuery({
    queryKey: ['query-history', workspaceId, filters],
    queryFn: () => historyApi.list(workspaceId, filters),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  });
};

export const useQueryHistoryStats = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useQuery({
    queryKey: ['query-history-stats', workspaceId],
    queryFn: () => historyApi.stats(workspaceId),
    enabled: !!workspaceId,
  });
};
