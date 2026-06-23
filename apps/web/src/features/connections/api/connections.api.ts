import { apiClient } from '@/lib/api-client';
import type {
  Connection,
  ConnectionWithSchema,
  SchemaTable,
  SchemaModule,
  AuditReport,
  TestConnectionResult,
  SshConnectionInput,
} from '../types';

interface ApiResponse<T> {
  data: T;
}

interface ConnectionInput extends SshConnectionInput {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslEnabled?: boolean;
}

export const connectionsApi = {
  getAll: async (workspaceId: string): Promise<Connection[]> => {
    const res = await apiClient.get(`/workspaces/${workspaceId}/connections`) as ApiResponse<Connection[]>;
    return res.data;
  },

  getOne: async (
    workspaceId: string,
    connectionId: string,
  ): Promise<ConnectionWithSchema> => {
    const res = (await apiClient.get(
      `/workspaces/${workspaceId}/connections/${connectionId}`,
    )) as ApiResponse<ConnectionWithSchema>;
    return res.data;
  },

  create: async (workspaceId: string, data: ConnectionInput & { name: string }): Promise<Connection> => {
    const res = await apiClient.post(`/workspaces/${workspaceId}/connections`, data) as ApiResponse<Connection>;
    return res.data;
  },

  delete: async (workspaceId: string, connectionId: string): Promise<void> => {
    await apiClient.delete(`/workspaces/${workspaceId}/connections/${connectionId}`);
  },

  testNew: async (workspaceId: string, data: ConnectionInput): Promise<TestConnectionResult> => {
    const res = await apiClient.post(`/workspaces/${workspaceId}/connections/test`, data) as ApiResponse<TestConnectionResult>;
    return res.data;
  },

  testExisting: async (workspaceId: string, connectionId: string): Promise<TestConnectionResult> => {
    const res = await apiClient.post(`/workspaces/${workspaceId}/connections/${connectionId}/test`) as ApiResponse<TestConnectionResult>;
    return res.data;
  },

  sync: async (workspaceId: string, connectionId: string): Promise<{ tablesDiscovered: number; syncedAt: string }> => {
    const res = await apiClient.post(`/workspaces/${workspaceId}/connections/${connectionId}/sync`) as ApiResponse<{ tablesDiscovered: number; syncedAt: string }>;
    return res.data;
  },

  describeTable: async (
    workspaceId: string,
    connectionId: string,
    tableName: string,
  ): Promise<SchemaTable> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/describe`,
    )) as ApiResponse<SchemaTable>;
    return res.data;
  },

  updateTableDescription: async (
    workspaceId: string,
    connectionId: string,
    tableName: string,
    description: string,
  ): Promise<SchemaTable> => {
    const res = (await apiClient.patch(
      `/workspaces/${workspaceId}/connections/${connectionId}/tables/${encodeURIComponent(tableName)}`,
      { description },
    )) as ApiResponse<SchemaTable>;
    return res.data;
  },

  updateColumnDescription: async (
    workspaceId: string,
    connectionId: string,
    tableName: string,
    columnName: string,
    description: string,
  ): Promise<SchemaTable> => {
    const res = (await apiClient.patch(
      `/workspaces/${workspaceId}/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/columns/${encodeURIComponent(columnName)}`,
      { description },
    )) as ApiResponse<SchemaTable>;
    return res.data;
  },

  audit: async (
    workspaceId: string,
    connectionId: string,
  ): Promise<AuditReport> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/connections/${connectionId}/audit`,
    )) as ApiResponse<AuditReport>;
    return res.data;
  },

  // ── Modules ──
  suggestModules: async (
    workspaceId: string,
    connectionId: string,
  ): Promise<SchemaModule[]> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/connections/${connectionId}/modules/suggest`,
    )) as ApiResponse<SchemaModule[]>;
    return res.data;
  },

  createModule: async (
    workspaceId: string,
    connectionId: string,
    name: string,
  ): Promise<SchemaModule[]> => {
    const res = (await apiClient.post(
      `/workspaces/${workspaceId}/connections/${connectionId}/modules`,
      { name },
    )) as ApiResponse<SchemaModule[]>;
    return res.data;
  },

  updateModule: async (
    workspaceId: string,
    connectionId: string,
    moduleId: string,
    data: { name?: string; description?: string },
  ): Promise<SchemaModule[]> => {
    const res = (await apiClient.patch(
      `/workspaces/${workspaceId}/connections/${connectionId}/modules/${moduleId}`,
      data,
    )) as ApiResponse<SchemaModule[]>;
    return res.data;
  },

  deleteModule: async (
    workspaceId: string,
    connectionId: string,
    moduleId: string,
  ): Promise<SchemaModule[]> => {
    const res = (await apiClient.delete(
      `/workspaces/${workspaceId}/connections/${connectionId}/modules/${moduleId}`,
    )) as ApiResponse<SchemaModule[]>;
    return res.data;
  },

  assignTableModule: async (
    workspaceId: string,
    connectionId: string,
    tableName: string,
    moduleId: string | null,
  ): Promise<SchemaModule[]> => {
    const res = (await apiClient.patch(
      `/workspaces/${workspaceId}/connections/${connectionId}/tables/${encodeURIComponent(tableName)}/module`,
      { moduleId },
    )) as ApiResponse<SchemaModule[]>;
    return res.data;
  },
};