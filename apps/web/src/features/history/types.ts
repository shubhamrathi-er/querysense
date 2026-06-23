export type QueryStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT';

export interface QueryHistoryItem {
  id: string;
  sql: string;
  executedAt: string;
  executionTimeMs: number;
  rowCount: number;
  status: QueryStatus;
  errorMessage: string | null;
  connectionId: string;
  connectionName: string;
  conversationId: string | null;
}

export interface QueryHistoryPage {
  items: QueryHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QueryHistoryStats {
  total: number;
  success: number;
  error: number;
  timeout: number;
  avgMs: number;
}

export interface HistoryFilters {
  page?: number;
  pageSize?: number;
  connectionId?: string;
  status?: QueryStatus;
  search?: string;
}
