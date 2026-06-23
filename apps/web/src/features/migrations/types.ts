export type Conflict = 'skip' | 'truncate' | 'upsert';

export interface PlanTable {
  tableName: string;
  sourceRows: number;
  existsOnTarget: boolean;
  targetRows: number | null;
}

export interface MigrationPlan {
  source: { id: string; name: string; database: string };
  target: { id: string; name: string; database: string };
  order: string[];
  tables: PlanTable[];
}

export interface ScriptResult {
  sql: string;
  truncated: boolean;
  rowsIncluded: number;
}

export interface RunReportRow {
  table: string;
  copied: number;
  sourceRows: number;
  targetRows: number;
  status: string;
  error?: string;
}

// ── Validation engine ──
export type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKER';

export interface ValidationIssue {
  phase: string;
  code: string;
  severity: Severity;
  message: string;
  table?: string;
  column?: string;
  detail?: Record<string, unknown>;
}

export interface ReadinessScore {
  score: number;
  status: 'READY' | 'READY_WITH_WARNINGS' | 'NOT_READY';
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  breakdown: Record<string, number>;
}

export interface ExecutionStep {
  step: number;
  action: string;
  tables?: string[];
}

export interface RiskAssessment {
  totalRows: number;
  totalBytes: number;
  estimatedDurationSeconds: number;
  classification: string;
  recommendedStrategy: string;
  edgeCases: ValidationIssue[];
}

export interface FinalRecommendation {
  proceed: boolean;
  status: ReadinessScore['status'];
  summary: string;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationReport {
  executionPlan: ExecutionStep[];
  riskAssessment: RiskAssessment;
  migrationReadinessScore: ReadinessScore;
  finalRecommendation: FinalRecommendation;
  allIssues: ValidationIssue[];
}

export interface TableState {
  status: 'pending' | 'start' | 'created' | 'done' | 'error';
  copied: number;
  total: number;
  sourceRows?: number;
  targetRows?: number;
  error?: string;
}
