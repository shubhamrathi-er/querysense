// ── Migration Validation Engine — shared types ───────────────

export enum Severity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  BLOCKER = 'BLOCKER',
}

export const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.INFO]: 0,
  [Severity.WARNING]: 1,
  [Severity.ERROR]: 2,
  [Severity.BLOCKER]: 3,
};

/** A machine-readable validation finding. */
export interface Issue {
  phase: string;
  code: string;
  severity: Severity;
  message: string;
  table?: string;
  column?: string;
  detail?: Record<string, unknown>;
}

export interface ColumnSummary {
  name: string;
  dataType: string; // e.g. 'varchar'
  columnType: string; // e.g. 'varchar(255)'
  length: number | null; // char length
  precision: number | null; // numeric precision
  scale: number | null;
  nullable: boolean;
  defaultValue: string | null;
  charset: string | null;
  collation: string | null;
  autoIncrement: boolean;
  unsigned: boolean;
  generated: boolean;
  isBlob: boolean;
  isText: boolean;
  isEnum: boolean;
  enumValues: string[];
}

export interface ForeignKeyRef {
  column: string;
  refTable: string;
  refColumn: string;
}

// ── Phase 1 ──
export interface SourceTableValidation {
  tableName: string;
  exists: boolean;
  isView: boolean;
  rowCount: number;
  sizeBytes: number;
  primaryKey: string[];
  compositePrimaryKey: boolean;
  foreignKeys: ForeignKeyRef[];
  triggers: string[];
  partitioned: boolean;
  generatedColumns: string[];
  autoIncrementColumns: string[];
  blobTextColumns: string[];
  warnings: Issue[];
}

export interface SourceValidation {
  connectionActive: boolean;
  databaseExists: boolean;
  selectPermission: boolean;
  tables: SourceTableValidation[];
  issues: Issue[];
}

// ── Phase 2 ──
export interface TargetPermissions {
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  create: boolean;
}

export interface TargetTableValidation {
  tableName: string;
  tableExists: boolean;
  schemaExists: boolean;
}

export interface TargetValidation {
  connectionActive: boolean;
  databaseExists: boolean;
  permissions: TargetPermissions;
  tables: TargetTableValidation[];
  issues: Issue[];
}

// ── Phase 3 ──
export interface ColumnComparison {
  column: string;
  source: ColumnSummary | null;
  target: ColumnSummary | null;
  changes: Issue[];
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
  indexes: IndexComparison[];
  issues: Issue[];
}

export interface SchemaComparison {
  tables: TableSchemaComparison[];
  issues: Issue[];
}

// ── Phase 4 + 5 ──
export interface NullabilityFinding {
  table: string;
  column: string;
  nullCount: number;
  severity: Severity;
}

export interface DataValidation {
  issues: Issue[];
  nullability: NullabilityFinding[];
}

// ── Phase 6 ──
export type DuplicateRecommendation = 'SKIP' | 'UPDATE' | 'UPSERT' | 'ABORT';

export interface DuplicateTableFinding {
  tableName: string;
  duplicateCount: number;
  sampled: boolean;
  sampleKeys: string[];
  recommendation: DuplicateRecommendation;
}

export interface DuplicateValidation {
  tables: DuplicateTableFinding[];
  issues: Issue[];
}

// ── Phase 7 ──
export interface DependencyAnalysis {
  order: string[];
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
  circular: string[][];
  selfReferencing: string[];
}

// ── Phase 9 ──
export type VolumeClass = 'SMALL' | 'MEDIUM' | 'LARGE' | 'VERY_LARGE';
export type MigrationStrategy =
  | 'SINGLE_TRANSACTION'
  | 'BATCH'
  | 'CHUNKED'
  | 'PARALLEL';

export interface VolumeAssessment {
  totalRows: number;
  totalBytes: number;
  estimatedTransferBytes: number;
  estimatedDurationSeconds: number;
  classification: VolumeClass;
  recommendedStrategy: MigrationStrategy;
}

// ── Phase 10 ──
export type ReadinessStatus = 'READY' | 'READY_WITH_WARNINGS' | 'NOT_READY';

export interface ReadinessScore {
  score: number;
  status: ReadinessStatus;
  blockers: Issue[];
  warnings: Issue[];
  breakdown: Record<string, number>;
}

// ── Phase 11 ──
export interface ExecutionStep {
  step: number;
  action: string;
  tables?: string[];
}

// ── Phase 12 ──
export interface TableVerification {
  table: string;
  sourceRowCount: number;
  targetRowCount: number;
  rowCountMatch: boolean;
  sourceChecksum: string | null;
  targetChecksum: string | null;
  checksumMatch: boolean | null;
  status: 'OK' | 'MISMATCH';
}

export interface VerificationReport {
  tables: TableVerification[];
  status: 'OK' | 'MISMATCH';
}

// ── Final report ──
export interface RiskAssessment extends VolumeAssessment {
  edgeCases: Issue[];
}

export interface FinalRecommendation {
  proceed: boolean;
  status: ReadinessStatus;
  summary: string;
  blockers: Issue[];
  warnings: Issue[];
}

export interface ValidationReport {
  sourceValidation: SourceValidation;
  targetValidation: TargetValidation;
  schemaComparison: SchemaComparison;
  dataValidation: DataValidation;
  duplicateValidation: DuplicateValidation;
  dependencyAnalysis: DependencyAnalysis;
  executionPlan: ExecutionStep[];
  riskAssessment: RiskAssessment;
  migrationReadinessScore: ReadinessScore;
  finalRecommendation: FinalRecommendation;
  allIssues: Issue[];
}

export interface ValidationConfig {
  allowViews: boolean;
  overwriteMode: boolean; // truncate/overwrite → needs DELETE
  mode: 'append' | 'overwrite';
}
