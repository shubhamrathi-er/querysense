import * as mysql from 'mysql2/promise';
import { format } from 'mysql2';
import { createMysqlPool } from '../../common/db/mysql-pool';
import { quoteIdent } from '../../common/db/engine';
import {
  BATCH,
  type BaseTable,
  type Conflict,
  type MigrationConn,
  type MigrationDriver,
} from './migration-driver';

const id = (n: string) => quoteIdent('mysql', n);

/** MySQL data-migration strategy (ports the original SHOW CREATE TABLE flow). */
export class MysqlMigrationDriver implements MigrationDriver {
  readonly engine = 'mysql' as const;

  private sPool!: mysql.Pool;
  private tPool!: mysql.Pool;
  private tConn!: mysql.PoolConnection;
  private sCleanup?: () => Promise<void>;
  private tCleanup?: () => Promise<void>;

  constructor(
    private source: MigrationConn,
    private target: MigrationConn,
  ) {}

  private pool(c: MigrationConn) {
    return createMysqlPool({
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      ssl: c.sslEnabled,
      ssh: c.ssh,
      connectionLimit: 4,
      connectTimeout: 10000,
    });
  }

  async openSource(): Promise<void> {
    const { pool, cleanup } = await this.pool(this.source);
    this.sPool = pool;
    this.sCleanup = cleanup;
  }

  async openTarget(): Promise<void> {
    const { pool, cleanup } = await this.pool(this.target);
    this.tPool = pool;
    this.tCleanup = cleanup;
    this.tConn = await pool.getConnection();
    await this.tConn.query('SET SESSION FOREIGN_KEY_CHECKS=0');
    await this.tConn.query('SET SESSION UNIQUE_CHECKS=0');
  }

  async close(): Promise<void> {
    if (this.tConn) {
      try {
        await this.tConn.query('SET SESSION FOREIGN_KEY_CHECKS=1');
      } catch {
        /* ignore */
      }
      this.tConn.release();
    }
    if (this.sCleanup) await this.sCleanup();
    if (this.tCleanup) await this.tCleanup();
  }

  private async baseTables(pool: mysql.Pool, db: string): Promise<BaseTable[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, COALESCE(TABLE_ROWS,0) AS R
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [db],
    );
    return rows.map((r) => ({
      name: String((r as Record<string, unknown>)['TABLE_NAME']),
      rows: Number((r as Record<string, unknown>)['R'] ?? 0),
    }));
  }

  sourceBaseTables() {
    return this.baseTables(this.sPool, this.source.database);
  }
  targetBaseTables() {
    return this.baseTables(this.tPool, this.target.database);
  }

  async sourceForeignKeys() {
    const [rows] = await this.sPool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, REFERENCED_TABLE_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.source.database],
    );
    return rows.map((r) => ({
      table: String((r as Record<string, unknown>)['TABLE_NAME']),
      refTable: String((r as Record<string, unknown>)['REFERENCED_TABLE_NAME']),
    }));
  }

  private async count(pool: mysql.Pool, table: string): Promise<number> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS C FROM ${id(table)}`,
    );
    return Number((rows[0] as Record<string, unknown>)['C'] ?? 0);
  }
  sourceCount(table: string) {
    return this.count(this.sPool, table);
  }
  targetCount(table: string) {
    return this.count(this.tPool, table);
  }

  private async primaryKey(table: string): Promise<string[]> {
    const [rows] = await this.sPool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'
       ORDER BY ORDINAL_POSITION`,
      [this.source.database, table],
    );
    return rows.map((r) => String((r as Record<string, unknown>)['COLUMN_NAME']));
  }

  private async insertableColumns(table: string): Promise<string[]> {
    const [rows] = await this.sPool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, EXTRA FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [this.source.database, table],
    );
    return rows
      .filter(
        (r) =>
          !String((r as Record<string, unknown>)['EXTRA'] ?? '')
            .toUpperCase()
            .includes('GENERATED'),
      )
      .map((r) => String((r as Record<string, unknown>)['COLUMN_NAME']));
  }

  async createTableOnTarget(table: string): Promise<void> {
    const sConn = await this.sPool.getConnection();
    try {
      const [rows] = await sConn.query<mysql.RowDataPacket[]>(
        `SHOW CREATE TABLE ${id(table)}`,
      );
      const ddl = String((rows[0] as Record<string, unknown>)['Create Table'] ?? '');
      await this.tConn.query(ddl);
    } finally {
      sConn.release();
    }
  }

  async truncateTarget(table: string): Promise<void> {
    await this.tConn.query(`TRUNCATE TABLE ${id(table)}`);
  }

  /** mysql2 returns JSON columns as JS objects; re-serialize so the bulk-insert
   *  formatter doesn't expand them into extra SQL columns. */
  private normalizeValue(v: unknown): unknown {
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      return JSON.stringify(v);
    }
    return v;
  }

  private insertTemplate(conflict: Conflict, table: string, cols: string[]): string {
    const colList = cols.map(id).join(', ');
    if (conflict === 'skip') {
      return `INSERT IGNORE INTO ${id(table)} (${colList}) VALUES ?`;
    }
    if (conflict === 'upsert') {
      const upd = cols.map((c) => `${id(c)}=VALUES(${id(c)})`).join(', ');
      return `INSERT INTO ${id(table)} (${colList}) VALUES ? ON DUPLICATE KEY UPDATE ${upd}`;
    }
    return `INSERT INTO ${id(table)} (${colList}) VALUES ?`;
  }

  async copyTable(
    table: string,
    conflict: Conflict,
    onProgress: (copied: number, total: number) => void,
  ): Promise<number> {
    const cols = await this.insertableColumns(table);
    if (cols.length === 0) return 0;
    const pk = await this.primaryKey(table);
    const total = await this.sourceCount(table);
    const colList = cols.map(id).join(', ');
    const insertSql = this.insertTemplate(conflict, table, cols);

    const insertBatch = async (rows: mysql.RowDataPacket[]) => {
      const values = rows.map((r) =>
        cols.map((c) => this.normalizeValue((r as Record<string, unknown>)[c])),
      );
      await this.tConn.query(insertSql, [values]);
    };

    let copied = 0;
    if (pk.length === 1) {
      const key = pk[0];
      let last: unknown = null;
      for (;;) {
        const where = last === null ? '' : `WHERE ${id(key)} > ?`;
        const params = last === null ? [BATCH] : [last, BATCH];
        const [rows] = await this.sPool.query<mysql.RowDataPacket[]>(
          `SELECT ${colList} FROM ${id(table)} ${where} ORDER BY ${id(key)} ASC LIMIT ?`,
          params,
        );
        if (rows.length === 0) break;
        await insertBatch(rows);
        copied += rows.length;
        last = (rows[rows.length - 1] as Record<string, unknown>)[key];
        onProgress(copied, total);
        if (rows.length < BATCH) break;
      }
    } else {
      let offset = 0;
      for (;;) {
        const [rows] = await this.sPool.query<mysql.RowDataPacket[]>(
          `SELECT ${colList} FROM ${id(table)} LIMIT ? OFFSET ?`,
          [BATCH, offset],
        );
        if (rows.length === 0) break;
        await insertBatch(rows);
        copied += rows.length;
        offset += rows.length;
        onProgress(copied, total);
        if (rows.length < BATCH) break;
      }
    }
    return copied;
  }

  // ── script generation ──

  scriptHeader(sourceName: string, sourceDb: string): string[] {
    return [
      '-- Migration script generated by QuerySense',
      `-- Source: ${sourceName} (${sourceDb})`,
      'SET FOREIGN_KEY_CHECKS=0;',
      '',
    ];
  }
  scriptFooter(): string[] {
    return ['SET FOREIGN_KEY_CHECKS=1;'];
  }

  async scriptCreateTable(table: string): Promise<string[]> {
    const [rows] = await this.sPool.query<mysql.RowDataPacket[]>(
      `SHOW CREATE TABLE ${id(table)}`,
    );
    const ddl = String((rows[0] as Record<string, unknown>)['Create Table'] ?? '');
    return [`DROP TABLE IF EXISTS ${id(table)};`, `${ddl};`, ''];
  }

  scriptTruncate(table: string): string {
    return `TRUNCATE TABLE ${id(table)};`;
  }

  async scriptInserts(table: string, conflict: Conflict, rowCap: number) {
    const cols = await this.insertableColumns(table);
    const lines: string[] = [];
    if (cols.length === 0) return { lines, rows: 0, truncated: false };
    const insertSql = this.insertTemplate(conflict, table, cols);
    const colList = cols.map(id).join(', ');

    let offset = 0;
    let rows = 0;
    let truncated = false;
    for (;;) {
      if (rows >= rowCap) {
        truncated = true;
        lines.push(
          `-- NOTE: ${id(table)} truncated at ${rowCap} rows in this script. Use direct copy for the full table.`,
        );
        break;
      }
      const [data] = await this.sPool.query<mysql.RowDataPacket[]>(
        `SELECT ${colList} FROM ${id(table)} LIMIT ? OFFSET ?`,
        [BATCH, offset],
      );
      if (data.length === 0) break;
      const values = data.map((r) =>
        cols.map((c) => this.normalizeValue((r as Record<string, unknown>)[c])),
      );
      lines.push(format(insertSql, [values] as never) + ';');
      rows += data.length;
      offset += data.length;
      if (data.length < BATCH) break;
    }
    lines.push('');
    return { lines, rows, truncated };
  }
}
