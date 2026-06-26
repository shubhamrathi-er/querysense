import type { ColumnSummary, IndexSummary } from '../types';

export interface GrantInfo {
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  create: boolean;
}

export interface FkDetail {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

export interface DuplicateProbe {
  count: number;
  sample: string[];
  sampled: boolean;
}

/**
 * Strategy interface abstracting all database-specific operations the
 * validators need. Implement one per engine (MySQL today; PostgreSQL,
 * SQL Server, Oracle in future).
 */
export interface DialectAdapter {
  readonly dialect: string;

  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;

  databaseExists(): Promise<boolean>;
  tableExists(table: string): Promise<boolean>;
  isView(table: string): Promise<boolean>;

  getColumns(table: string): Promise<ColumnSummary[]>;
  getPrimaryKey(table: string): Promise<string[]>;
  getUniqueKeys(table: string): Promise<string[][]>;
  /** Secondary indexes (excludes the primary key). */
  getIndexes(table: string): Promise<IndexSummary[]>;
  getForeignKeys(): Promise<FkDetail[]>;

  getRowCount(table: string): Promise<number>;
  getTableSizeBytes(table: string): Promise<number>;

  getTriggers(table: string): Promise<string[]>;
  getPartitions(table: string): Promise<string[]>;
  getRoutinesReferencing(table: string): Promise<string[]>;
  getEventsReferencing(table: string): Promise<string[]>;
  getViewsReferencing(table: string): Promise<string[]>;

  getGrants(): Promise<GrantInfo>;

  // ── data probes ──
  maxCharLength(table: string, column: string): Promise<number | null>;
  maxNumeric(table: string, column: string): Promise<bigint | null>;
  nullCount(table: string, column: string): Promise<number>;
  checksum(table: string): Promise<string | null>;

  /** Sample source PK tuples, then check how many already exist in `this` (target). */
  probeDuplicates(
    table: string,
    pkCols: string[],
    sourceKeySample: unknown[][],
  ): Promise<DuplicateProbe>;

  /** Fetch up to `limit` PK tuples from this table (for the source side). */
  sampleKeys(table: string, pkCols: string[], limit: number): Promise<unknown[][]>;

  /** Fetch up to `limit` full rows from this table (read-only data preview). */
  sampleRows(table: string, limit: number): Promise<Array<Record<string, unknown>>>;
}
