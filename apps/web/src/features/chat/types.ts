export type MessageStatus =
  | 'idle'
  | 'sql_ready'
  | 'executing'
  | 'done'
  | 'error'
  | 'clarification'
  | 'cannot_answer';

export interface Interpretation {
  label: string;
  sql: string;
}

export interface Clarification {
  clarify: string;
  options: Interpretation[];
}

export interface QueryMeta {
  confidence: number | null;
  tables: string[];
  columns: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  generatedSql: string | null;
  sqlExplanation: string | null;
  chartConfig: ChartConfig | null;
  clarification: Clarification | null;
  queryMeta?: QueryMeta | null;
  insightText: string | null;
  tokensUsed: number | null;
  modelUsed: string | null;
  latencyMs: number | null;
  createdAt: string;
  // Client-side only fields
  status?: MessageStatus;
  queryResult?: QueryResult | null;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: Array<{ name: string; type: number }>;
  rowCount: number;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  executionTimeMs: number;
  insightText?: string;
  chartConfig?: ChartConfig | null;
  /** True when the original SQL failed and the AI auto-corrected it. */
  repaired?: boolean;
  repairedSql?: string | null;
  truncated: React.ReactNode
}

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter';
  xKey: string;
  yKey: string;
  title: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
  messages?: Message[];
}

export interface ProgressStep {
  step: string;
  label: string;
  status: 'waiting' | 'active' | 'done' | 'error';
}

export const QUERY_STEPS: ProgressStep[] = [
  { step: 'saving', label: 'Saving your question', status: 'waiting' },
  { step: 'schema', label: 'Retrieving schema context', status: 'waiting' },
  { step: 'context', label: 'Loading conversation history', status: 'waiting' },
  { step: 'generating', label: 'Generating SQL query', status: 'waiting' },
  { step: 'validating', label: 'Validating query safety', status: 'waiting' },
  { step: 'ready', label: 'Query ready for review', status: 'waiting' },
];