import { apiClient } from '@/lib/api-client';
import type {
  MigrationPlan,
  ScriptResult,
  Conflict,
  RunReportRow,
  ValidationReport,
} from '../types';

interface ApiResponse<T> {
  data: T;
}

export interface TableMapping {
  source: string;
  target: string;
}

export interface ColumnMapping {
  source: string;
  target: string;
}

export interface TableColumnMapping {
  table: string;
  columns: ColumnMapping[];
}

export interface TableAddColumns {
  table: string;
  columns: string[];
}

export interface RowFilter {
  table: string;
  where: string;
}

export interface Incremental {
  table: string;
  column: string;
}

export type TransformOp =
  | 'trim'
  | 'upper'
  | 'lower'
  | 'nullify_empty'
  | 'default'
  | 'prefix'
  | 'suffix';

export interface TableTransforms {
  table: string;
  columns: Array<{ column: string; op: TransformOp; value?: string }>;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface SuggestColumnsResult {
  source: ColumnInfo[];
  target: ColumnInfo[];
  mapping: Array<{ source: string; target: string | null }>;
  aiUsed: boolean;
}

export interface PreviewResult {
  columns: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows: Array<Record<string, unknown>>;
}

export interface MigrationRunSummary {
  id: string;
  sourceConnectionId: string;
  targetConnectionId: string;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  conflict: string;
  tables: string[];
  totalCopied: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface MigrationRunDetail extends MigrationRunSummary {
  createTables: boolean;
  config: Record<string, unknown>;
  report: Array<{
    table: string;
    target?: string;
    created?: boolean;
    copied: number;
    sourceRows: number;
    targetRows: number;
    status: string;
    error?: string;
  }> | null;
}

export interface IntegrityResult {
  status: 'OK' | 'MISMATCH';
  filteredTables: string[];
  tables: Array<{
    table: string;
    sourceRowCount: number;
    targetRowCount: number;
    rowCountMatch: boolean;
    checksumMatch: boolean | null;
    status: string;
  }>;
}

export interface RunPayload {
  sourceConnectionId: string;
  targetConnectionId: string;
  tables: string[];
  createTables: boolean;
  conflict: Conflict;
  skipValidation?: boolean;
  createMissingColumns?: boolean;
  tableMappings?: TableMapping[];
  columnMappings?: TableColumnMapping[];
  addColumns?: TableAddColumns[];
  rowFilters?: RowFilter[];
  incremental?: Incremental[];
  transforms?: TableTransforms[];
}

export const migrationsApi = {
  plan: async (
    workspaceId: string,
    sourceConnectionId: string,
    targetConnectionId: string,
  ): Promise<MigrationPlan> => {
    const res = (await apiClient.post(`/workspaces/${workspaceId}/migrations/plan`, {
      sourceConnectionId,
      targetConnectionId,
    })) as ApiResponse<MigrationPlan>;
    return res.data;
  },

  history: async (workspaceId: string): Promise<MigrationRunSummary[]> => {
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/migrations/history`,
    )) as ApiResponse<MigrationRunSummary[]>;
    return res.data;
  },

  historyDetail: async (workspaceId: string, id: string): Promise<MigrationRunDetail> => {
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/migrations/history/${id}`,
    )) as ApiResponse<MigrationRunDetail>;
    return res.data;
  },

  integrity: async (workspaceId: string, id: string): Promise<IntegrityResult> => {
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/migrations/history/${id}/integrity`,
    )) as ApiResponse<IntegrityResult>;
    return res.data;
  },

  rollback: async (
    workspaceId: string,
    id: string,
  ): Promise<{ dropped: string[]; skipped: string[] }> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/migrations/history/${id}/rollback`,
      {},
    )) as ApiResponse<{ dropped: string[]; skipped: string[] }>;
    return res.data;
  },

  assist: async (
    workspaceId: string,
    payload: { question: string; context?: string },
  ): Promise<{ answer: string }> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/migrations/assistant`,
      payload,
    )) as ApiResponse<{ answer: string }>;
    return res.data;
  },

  preview: async (
    workspaceId: string,
    payload: { sourceConnectionId: string; table: string; limit?: number },
  ): Promise<PreviewResult> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/migrations/preview`,
      payload,
    )) as ApiResponse<PreviewResult>;
    return res.data;
  },

  suggestColumns: async (
    workspaceId: string,
    payload: {
      sourceConnectionId: string;
      targetConnectionId: string;
      sourceTable: string;
      targetTable?: string;
    },
  ): Promise<SuggestColumnsResult> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/migrations/suggest-columns`,
      payload,
    )) as ApiResponse<SuggestColumnsResult>;
    return res.data;
  },

  validate: async (
    workspaceId: string,
    payload: {
      sourceConnectionId: string;
      targetConnectionId: string;
      tables: string[];
      mode?: 'append' | 'overwrite';
      allowViews?: boolean;
      tableMappings?: TableMapping[];
    },
  ): Promise<ValidationReport> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/migrations/validate`,
      payload,
    )) as ApiResponse<ValidationReport>;
    return res.data;
  },

  generateScript: async (
    workspaceId: string,
    payload: RunPayload,
  ): Promise<ScriptResult> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/migrations/script`,
      payload,
    )) as ApiResponse<ScriptResult>;
    return res.data;
  },

  // SSE — streams per-table progress events.
  run: (
    workspaceId: string,
    payload: RunPayload,
    handlers: {
      onTable: (e: Record<string, unknown>) => void;
      onProgress: (table: string, copied: number, total: number) => void;
      onDone: (report: RunReportRow[]) => void;
      onError: (message: string) => void;
    },
  ): (() => void) => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const controller = new AbortController();

    fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/migrations/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? ''}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          handlers.onError(`Request failed: ${res.statusText}`);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          handlers.onError('No response stream');
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          let event = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
                if (event === 'table') handlers.onTable(data);
                else if (event === 'progress')
                  handlers.onProgress(
                    String(data['table']),
                    Number(data['copied']),
                    Number(data['total']),
                  );
                else if (event === 'done')
                  handlers.onDone((data['report'] as RunReportRow[]) ?? []);
                else if (event === 'error')
                  handlers.onError(String(data['message']));
              } catch {
                /* ignore parse errors */
              }
            }
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') {
          handlers.onError(err.message);
        }
      });

    return () => controller.abort();
  },

  rerun: (
    workspaceId: string,
    id: string,
    mode: 'resume' | 'retry',
    handlers: {
      onProgress?: (table: string, copied: number, total: number) => void;
      onDone: (report: RunReportRow[]) => void;
      onError: (message: string) => void;
    },
  ): (() => void) => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const controller = new AbortController();

    fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/migrations/history/${id}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ mode }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          handlers.onError(`Request failed: ${res.statusText}`);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          handlers.onError('No response stream');
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          let event = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
                if (event === 'progress')
                  handlers.onProgress?.(
                    String(data['table']),
                    Number(data['copied']),
                    Number(data['total']),
                  );
                else if (event === 'done')
                  handlers.onDone((data['report'] as RunReportRow[]) ?? []);
                else if (event === 'error') handlers.onError(String(data['message']));
              } catch {
                /* ignore parse errors */
              }
            }
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') handlers.onError(err.message);
      });

    return () => controller.abort();
  },
};
