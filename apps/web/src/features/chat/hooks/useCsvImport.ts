import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { csvImportApi, type CsvImportPayload } from '../api/csv-import.api';
import { useWorkspaceStore } from '@/stores/workspace.store';

export const useImportTargets = (connectionId: string, enabled: boolean) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useQuery({
    queryKey: ['import-targets', workspaceId, connectionId],
    queryFn: () => csvImportApi.getImportTargets(workspaceId, connectionId),
    enabled: enabled && !!workspaceId && !!connectionId,
    staleTime: 30_000,
  });
};

export const useInterpretFilter = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (body: {
      columns: string[];
      sampleRows: Record<string, string | null>[];
      instruction: string;
    }) => csvImportApi.interpretFilter(workspaceId, body),
  });
};

export const useGoogleSheetImport = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (url: string) =>
      csvImportApi.fetchGoogleSheet(workspaceId, url),
  });
};

export const useCsvImport = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (payload: CsvImportPayload) =>
      csvImportApi.importCsv(workspaceId, payload.connectionId, payload),
    onSuccess: (_result, payload) => {
      // Schema changed on the server (re-synced after import) — refresh caches.
      void queryClient.invalidateQueries({
        queryKey: ['connections', workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['import-targets', workspaceId, payload.connectionId],
      });
    },
  });
};
