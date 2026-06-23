import { useMutation } from '@tanstack/react-query';
import { migrationsApi, type RunPayload } from '../api/migrations.api';
import { useWorkspaceStore } from '@/stores/workspace.store';

export const usePlanMigration = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (v: { source: string; target: string }) =>
      migrationsApi.plan(workspaceId, v.source, v.target),
  });
};

export const useGenerateScript = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (payload: RunPayload) =>
      migrationsApi.generateScript(workspaceId, payload),
  });
};

export const useValidateMigration = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id ?? '';
  return useMutation({
    mutationFn: (payload: {
      sourceConnectionId: string;
      targetConnectionId: string;
      tables: string[];
      mode?: 'append' | 'overwrite';
    }) => migrationsApi.validate(workspaceId, payload),
  });
};
