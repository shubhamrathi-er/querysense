import { apiClient } from '@/lib/api-client';
import type { FilterSpec } from '../lib/data-import';

interface ApiResponse<T> {
  data: T;
}

export interface ImportTargetColumn {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isAutoIncrement: boolean;
  hasDefault: boolean;
  isRequired: boolean;
}

export interface ImportTargetTable {
  tableName: string;
  columns: ImportTargetColumn[];
}

export interface CsvColumnMapping {
  csvColumn: string;
  dbColumn: string;
  dbType?: string;
}

export interface CsvImportPayload {
  connectionId: string;
  mode: 'existing' | 'new';
  tableName: string;
  columns: CsvColumnMapping[];
  /** DB columns forming the unique key; matching rows are skipped (existing tables). */
  uniqueKeys?: string[];
  rows: Record<string, string | null>[];
}

export interface CsvImportResult {
  tableName: string;
  mode: 'existing' | 'new';
  tableCreated: boolean;
  columnsAdded: string[];
  rowsInserted: number;
  rowsSkipped: number;
  rowsFailed: number;
  errors: string[];
}

export const csvImportApi = {
  interpretFilter: async (
    workspaceId: string,
    body: {
      columns: string[];
      sampleRows: Record<string, string | null>[];
      instruction: string;
    },
  ): Promise<FilterSpec> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/import/interpret-filter`,
      body,
    )) as ApiResponse<FilterSpec>;
    return res.data;
  },

  fetchGoogleSheet: async (
    workspaceId: string,
    url: string,
  ): Promise<{ csv: string }> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/import/google-sheet`,
      { url },
    )) as ApiResponse<{ csv: string }>;
    return res.data;
  },

  getImportTargets: async (
    workspaceId: string,
    connectionId: string,
  ): Promise<ImportTargetTable[]> => {
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/connections/${connectionId}/import/targets`,
    )) as ApiResponse<ImportTargetTable[]>;
    return res.data;
  },

  importCsv: async (
    workspaceId: string,
    connectionId: string,
    payload: Omit<CsvImportPayload, 'connectionId'> & { connectionId: string },
  ): Promise<CsvImportResult> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/connections/${connectionId}/import/csv`,
      payload,
    )) as ApiResponse<CsvImportResult>;
    return res.data;
  },
};
