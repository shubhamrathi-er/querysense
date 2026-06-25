import { DbEngine } from '../../common/db/engine';
import type { SshConfig } from '../../common/db/mysql-pool';

export type Conflict = 'skip' | 'truncate' | 'upsert';

export interface BaseTable {
  name: string;
  rows: number;
}

/** Resolved (decrypted) connection details a driver needs to open pools. */
export interface MigrationConn {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslEnabled: boolean;
  ssh?: SshConfig;
}

/** Rows read/inserted per batch during a direct copy. */
export const BATCH = 2000;
/** Hard cap on rows embedded per table in a generated SQL script. */
export const SCRIPT_ROW_CAP = 100_000;

/** Explicit source→target column mapping for one table. */
export interface ColumnMapping {
  source: string;
  target: string;
}

/**
 * Per-table copy options (extensible). When `columns` is set, ONLY those source
 * columns are copied — each into its mapped target column — and any source
 * column not listed is ignored. When omitted, all insertable columns are copied
 * by name (the default). Future options (row filters, transforms) extend here.
 */
export interface CopyOptions {
  columns?: ColumnMapping[];
}

/**
 * Engine strategy for data migration between two same-engine connections. Owns
 * the source (read) pool and the target (write) session; the service handles
 * engine-agnostic orchestration (topological ordering, SSE streaming, the
 * validation gate).
 */
export interface MigrationDriver {
  readonly engine: DbEngine;

  /** Open the source read pool. */
  openSource(): Promise<void>;
  /** Open the target pool + a dedicated write session with FK checks relaxed. */
  openTarget(): Promise<void>;
  close(): Promise<void>;

  // ── introspection ──
  sourceBaseTables(): Promise<BaseTable[]>;
  targetBaseTables(): Promise<BaseTable[]>;
  sourceForeignKeys(): Promise<Array<{ table: string; refTable: string }>>;
  sourceCount(table: string): Promise<number>;
  targetCount(table: string): Promise<number>;

  // ── schema prep on target (createTables flow) ──
  // `targetTable` defaults to `table`; pass a different name to migrate into a
  // differently-named target table (manual table mapping). Reads always use the
  // source `table`; writes use `targetTable`.
  createTableOnTarget(table: string, targetTable?: string): Promise<void>;
  truncateTarget(table: string): Promise<void>;

  // ── add missing columns to an existing target table (ALTER ADD COLUMN) ──
  // Adds source columns (nullable) to `targetTable` if absent. When `columns`
  // is omitted, ALL source columns missing on the target are added.
  // Returns the columns actually added.
  addColumnsToTarget(table: string, targetTable: string, columns?: string[]): Promise<string[]>;

  // ── copy one table's data; returns rows copied ──
  copyTable(
    table: string,
    conflict: Conflict,
    onProgress: (copied: number, total: number) => void,
    targetTable?: string,
    options?: CopyOptions,
  ): Promise<number>;

  // ── SQL-script generation (source only) ──
  scriptHeader(sourceName: string, sourceDb: string): string[];
  scriptFooter(): string[];
  /** DROP + CREATE statements for one table (renamed to `targetTable`). */
  scriptCreateTable(table: string, targetTable?: string): Promise<string[]>;
  /** ALTER ... ADD COLUMN statements for missing columns on `targetTable`.
   *  Omit `columns` to emit all source columns missing on the target. */
  scriptAddColumns(table: string, targetTable: string, columns?: string[]): Promise<string[]>;
  scriptTruncate(table: string): string;
  /** INSERT statements for a table's data, capped at rowCap rows. */
  scriptInserts(
    table: string,
    conflict: Conflict,
    rowCap: number,
    targetTable?: string,
    options?: CopyOptions,
  ): Promise<{ lines: string[]; rows: number; truncated: boolean }>;
}
