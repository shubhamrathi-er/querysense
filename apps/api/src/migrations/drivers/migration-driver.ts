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
/** Supported per-column value transforms (applied in JS during copy). */
export type TransformOp =
  | 'trim'
  | 'upper'
  | 'lower'
  | 'nullify_empty'
  | 'default'
  | 'prefix'
  | 'suffix';

export interface ColumnTransform {
  column: string; // source column the transform reads/writes
  op: TransformOp;
  value?: string; // argument for default/prefix/suffix
}

/** Apply one transform to a value. Non-string values pass through untouched
 *  except for `default` (fills null/empty). */
export function applyColumnTransform(t: ColumnTransform | undefined, v: unknown): unknown {
  if (!t) return v;
  const isEmpty = v === null || v === undefined || (typeof v === 'string' && v === '');
  switch (t.op) {
    case 'trim':
      return typeof v === 'string' ? v.trim() : v;
    case 'upper':
      return typeof v === 'string' ? v.toUpperCase() : v;
    case 'lower':
      return typeof v === 'string' ? v.toLowerCase() : v;
    case 'nullify_empty':
      return typeof v === 'string' && v.trim() === '' ? null : v;
    case 'default':
      return isEmpty ? (t.value ?? v) : v;
    case 'prefix':
      return v === null || v === undefined ? v : `${t.value ?? ''}${v as string}`;
    case 'suffix':
      return v === null || v === undefined ? v : `${v as string}${t.value ?? ''}`;
    default:
      return v;
  }
}

/** Build a `(column, value) => value` applier from a transform list (identity if
 *  none). Multiple transforms on the same column are applied in order (chained). */
export function makeTransformApplier(
  transforms?: ColumnTransform[],
): (col: string, v: unknown) => unknown {
  if (!transforms || transforms.length === 0) return (_c, v) => v;
  const byCol = new Map<string, ColumnTransform[]>();
  for (const t of transforms) {
    const list = byCol.get(t.column);
    if (list) list.push(t);
    else byCol.set(t.column, [t]);
  }
  return (col, v) => {
    const list = byCol.get(col);
    return list ? list.reduce((acc, t) => applyColumnTransform(t, acc), v) : v;
  };
}

export interface CopyOptions {
  columns?: ColumnMapping[];
  /**
   * Raw SQL predicate ANDed into the source SELECT (row filter / incremental
   * watermark). Validated by the service before it reaches a driver; inlined,
   * so it must already be safe. Applies to the source `table`.
   */
  where?: string;
  /** Per-column value transforms applied to each row during copy. */
  transforms?: ColumnTransform[];
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
  /** DROP a target table (used by rollback of tables this tool created). */
  dropTargetTable(table: string): Promise<void>;

  // ── add missing columns to an existing target table (ALTER ADD COLUMN) ──
  // Adds source columns (nullable) to `targetTable` if absent. When `columns`
  // is omitted, ALL source columns missing on the target are added.
  // Returns the columns actually added.
  addColumnsToTarget(table: string, targetTable: string, columns?: string[]): Promise<string[]>;

  // ── incremental copy ──
  // Build a WHERE predicate selecting source rows newer than the target's
  // current MAX(column). Reads the target; returns null when the target table
  // is empty or absent (→ copy everything). `column` must be a valid identifier.
  incrementalPredicate(targetTable: string, column: string): Promise<string | null>;

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
