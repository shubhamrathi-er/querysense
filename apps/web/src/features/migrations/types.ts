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

// ── Schema diff (subset of the backend report used by the diff viewer) ──
export interface ColumnSummary {
  name: string;
  dataType: string;
  columnType: string;
  length: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  defaultValue: string | null;
  autoIncrement: boolean;
}

export interface ColumnComparison {
  column: string;
  source: ColumnSummary | null;
  target: ColumnSummary | null;
  changes: ValidationIssue[];
}

export interface IndexSummary {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface IndexComparison {
  name: string;
  source: IndexSummary | null;
  target: IndexSummary | null;
  status: 'match' | 'changed' | 'source-only' | 'target-only';
}

export interface TableSchemaComparison {
  tableName: string;
  targetExists: boolean;
  columns: ColumnComparison[];
  indexes?: IndexComparison[];
  issues: ValidationIssue[];
}

export interface SchemaComparison {
  tables: TableSchemaComparison[];
  issues: ValidationIssue[];
}

export interface ForeignKeyRef {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface SourceTableValidation {
  tableName: string;
  primaryKey: string[];
  foreignKeys: ForeignKeyRef[];
  rowCount: number;
}

export interface SourceValidation {
  tables: SourceTableValidation[];
}

export interface ValidationReport {
  executionPlan: ExecutionStep[];
  riskAssessment: RiskAssessment;
  migrationReadinessScore: ReadinessScore;
  finalRecommendation: FinalRecommendation;
  allIssues: ValidationIssue[];
  // Present in the backend payload; optional here so existing code is unaffected.
  schemaComparison?: SchemaComparison;
  sourceValidation?: SourceValidation;
}

export interface TableState {
  status: 'pending' | 'start' | 'created' | 'done' | 'error';
  copied: number;
  total: number;
  sourceRows?: number;
  targetRows?: number;
  error?: string;
}
