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
  createTableOnTarget(table: string): Promise<void>;
  truncateTarget(table: string): Promise<void>;

  // ── copy one table's data; returns rows copied ──
  copyTable(
    table: string,
    conflict: Conflict,
    onProgress: (copied: number, total: number) => void,
  ): Promise<number>;

  // ── SQL-script generation (source only) ──
  scriptHeader(sourceName: string, sourceDb: string): string[];
  scriptFooter(): string[];
  /** DROP + CREATE statements for one table. */
  scriptCreateTable(table: string): Promise<string[]>;
  scriptTruncate(table: string): string;
  /** INSERT statements for a table's data, capped at rowCap rows. */
  scriptInserts(
    table: string,
    conflict: Conflict,
    rowCap: number,
  ): Promise<{ lines: string[]; rows: number; truncated: boolean }>;
}
