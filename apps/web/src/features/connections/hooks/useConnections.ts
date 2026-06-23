import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { connectionsApi } from '../api/connections.api';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ConnectionWithSchema, SchemaTable } from '../types';

/** Replace one table in the cached connection (avoids a full refetch). */
function patchCachedTable(
  queryClient: QueryClient,
  workspaceId: string,
  connectionId: string,
  updated: SchemaTable,
) {
  queryClient.setQueryData<ConnectionWithSchema>(
    ['connection', workspaceId, connectionId],
    (old) =>
      old
        ? {
            ...old,
            schemaMetadata: old.schemaMetadata.map((t) =>
              t.tableName === updated.tableName ? updated : t,
            ),
          }
        : old,
  );
}

export const useConnections = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useQuery({
    queryKey: ['connections', workspaceId],
    queryFn: () => connectionsApi.getAll(workspaceId),
    enabled: !!workspaceId,
  });
};

export const useAudit = (connectionId: string) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: () => connectionsApi.audit(workspaceId, connectionId),
  });
};

export const useConnection = (connectionId: string) => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useQuery({
    queryKey: ['connection', workspaceId, connectionId],
    queryFn: () => connectionsApi.getOne(workspaceId, connectionId),
    enabled: !!workspaceId && !!connectionId,
  });
};

export const useDescribeTable = (connectionId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (tableName: string) =>
      connectionsApi.describeTable(workspaceId, connectionId, tableName),
    onSuccess: (updated) =>
      patchCachedTable(queryClient, workspaceId, connectionId, updated),
  });
};

export const useUpdateTableDescription = (connectionId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: ({ tableName, description }: { tableName: string; description: string }) =>
      connectionsApi.updateTableDescription(
        workspaceId,
        connectionId,
        tableName,
        description,
      ),
    onSuccess: (updated) =>
      patchCachedTable(queryClient, workspaceId, connectionId, updated),
  });
};

export const useUpdateColumnDescription = (connectionId: string) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: ({
      tableName,
      columnName,
      description,
    }: {
      tableName: string;
      columnName: string;
      description: string;
    }) =>
      connectionsApi.updateColumnDescription(
        workspaceId,
        connectionId,
        tableName,
        columnName,
        description,
      ),
    onSuccess: (updated) =>
      patchCachedTable(queryClient, workspaceId, connectionId, updated),
  });
};

// ── Modules ──
const useModuleMutation = <TVars>(
  connectionId: string,
  fn: (workspaceId: string, vars: TVars) => Promise<unknown>,
) => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (vars: TVars) => fn(workspaceId, vars),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['connection', workspaceId, connectionId],
      }),
  });
};

export const useSuggestModules = (connectionId: string) =>
  useModuleMutation<void>(connectionId, (ws) =>
    connectionsApi.suggestModules(ws, connectionId),
  );

export const useCreateModule = (connectionId: string) =>
  useModuleMutation<string>(connectionId, (ws, name) =>
    connectionsApi.createModule(ws, connectionId, name),
  );

export const useUpdateModule = (connectionId: string) =>
  useModuleMutation<{ moduleId: string; name?: string; description?: string }>(
    connectionId,
    (ws, { moduleId, ...data }) =>
      connectionsApi.updateModule(ws, connectionId, moduleId, data),
  );

export const useDeleteModule = (connectionId: string) =>
  useModuleMutation<string>(connectionId, (ws, moduleId) =>
    connectionsApi.deleteModule(ws, connectionId, moduleId),
  );

export const useAssignTableModule = (connectionId: string) =>
  useModuleMutation<{ tableName: string; moduleId: string | null }>(
    connectionId,
    (ws, { tableName, moduleId }) =>
      connectionsApi.assignTableModule(ws, connectionId, tableName, moduleId),
  );

export const useCreateConnection = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (data: Parameters<typeof connectionsApi.create>[1]) =>
      connectionsApi.create(workspaceId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections', workspaceId] });
    },
  });
};

export const useDeleteConnection = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (connectionId: string) =>
      connectionsApi.delete(workspaceId, connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections', workspaceId] });
    },
  });
};

export const useSyncSchema = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (connectionId: string) =>
      connectionsApi.sync(workspaceId, connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['connection'] });
    },
  });
};

export const useTestExistingConnection = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';

  return useMutation({
    mutationFn: (connectionId: string) =>
      connectionsApi.testExisting(workspaceId, connectionId),
  });
};