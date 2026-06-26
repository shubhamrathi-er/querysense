import * as mysql from 'mysql2/promise';
import { createMysqlPool, type SshConfig } from '../../../common/db/mysql-pool';
import type { ColumnSummary, IndexSummary } from '../types';
import type {
  DialectAdapter,
  FkDetail,
  GrantInfo,
  DuplicateProbe,
} from './dialect-adapter.interface';

export interface MysqlConnConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslEnabled: boolean;
  ssh?: SshConfig;
}

const IDENT = /^[A-Za-z0-9_$]+$/;
const id = (n: string) => {
  if (!IDENT.test(n)) throw new Error(`Invalid identifier "${n}"`);
  return `\`${n}\``;
};

const TEXT_TYPES = new Set(['tinytext', 'text', 'mediumtext', 'longtext']);
const BLOB_TYPES = new Set(['tinyblob', 'blob', 'mediumblob', 'longblob']);

export class MysqlAdapter implements DialectAdapter {
  readonly dialect = 'mysql';
  private pool!: mysql.Pool;
  private cleanup?: () => Promise<void>;

  constructor(private cfg: MysqlConnConfig) {}

  async connect(): Promise<void> {
    const tunneled = await createMysqlPool({
      host: this.cfg.host,
      port: this.cfg.port,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      ssl: this.cfg.sslEnabled,
      ssh: this.cfg.ssh,
      connectionLimit: 3,
      connectTimeout: 10000,
    });
    this.pool = tunneled.pool;
    this.cleanup = tunneled.cleanup;
  }
  async close(): Promise<void> {
    if (this.cleanup) await this.cleanup();
  }

  private get db() {
    return this.cfg.database;
  }
  private async q(sql: string, params: unknown[] = []) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(sql, params);
    return rows as Record<string, unknown>[];
  }

  async ping(): Promise<boolean> {
    try {
      const c = await this.pool.getConnection();
      await c.ping();
      c.release();
      return true;
    } catch {
      return false;
    }
  }

  async databaseExists(): Promise<boolean> {
    const r = await this.q(
      `SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1`,
      [this.db],
    );
    return r.length > 0;
  }

  async tableExists(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1`,
      [this.db, table],
    );
    return r.length > 0;
  }

  async isView(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1`,
      [this.db, table],
    );
    return String(r[0]?.['TABLE_TYPE']) === 'VIEW';
  }

  async getColumns(table: string): Promise<ColumnSummary[]> {
    const rows = await this.q(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
              CHARACTER_SET_NAME, COLLATION_NAME, EXTRA
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
       ORDER BY ORDINAL_POSITION`,
      [this.db, table],
    );
    return rows.map((r) => {
      const dataType = String(r['DATA_TYPE']).toLowerCase();
      const columnType = String(r['COLUMN_TYPE']);
      const extra = String(r['EXTRA'] ?? '').toLowerCase();
      const enumValues =
        dataType === 'enum' || dataType === 'set'
          ? (columnType.match(/\((.*)\)/)?.[1] ?? '')
              .split(',')
              .map((s) => s.trim().replace(/^'|'$/g, ''))
              .filter(Boolean)
          : [];
      return {
        name: String(r['COLUMN_NAME']),
        dataType,
        columnType,
        length: r['CHARACTER_MAXIMUM_LENGTH'] === null ? null : Number(r['CHARACTER_MAXIMUM_LENGTH']),
        precision: r['NUMERIC_PRECISION'] === null ? null : Number(r['NUMERIC_PRECISION']),
        scale: r['NUMERIC_SCALE'] === null ? null : Number(r['NUMERIC_SCALE']),
        nullable: String(r['IS_NULLABLE']).toUpperCase() === 'YES',
        defaultValue: r['COLUMN_DEFAULT'] === null ? null : String(r['COLUMN_DEFAULT']),
        charset: r['CHARACTER_SET_NAME'] ? String(r['CHARACTER_SET_NAME']) : null,
        collation: r['COLLATION_NAME'] ? String(r['COLLATION_NAME']) : null,
        autoIncrement: extra.includes('auto_increment'),
        unsigned: columnType.toLowerCase().includes('unsigned'),
        generated: extra.includes('generated'),
        isBlob: BLOB_TYPES.has(dataType),
        isText: TEXT_TYPES.has(dataType),
        isEnum: dataType === 'enum',
        enumValues,
      };
    });
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_KEY='PRI' ORDER BY ORDINAL_POSITION`,
      [this.db, table],
    );
    return rows.map((r) => String(r['COLUMN_NAME']));
  }

  async getUniqueKeys(table: string): Promise<string[][]> {
    const rows = await this.q(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND NON_UNIQUE=0
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [this.db, table],
    );
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const k = String(r['INDEX_NAME']);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(String(r['COLUMN_NAME']));
    }
    return [...map.values()];
  }

  async getIndexes(table: string): Promise<IndexSummary[]> {
    const rows = await this.q(
      `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME <> 'PRIMARY'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [this.db, table],
    );
    const map = new Map<string, IndexSummary>();
    for (const r of rows) {
      const name = String(r['INDEX_NAME']);
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: Number(r['NON_UNIQUE']) === 0 });
      }
      map.get(name)!.columns.push(String(r['COLUMN_NAME']));
    }
    return [...map.values()];
  }

  async getForeignKeys(): Promise<FkDetail[]> {
    const rows = await this.q(
      `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.db],
    );
    return rows.map((r) => ({
      table: String(r['TABLE_NAME']),
      column: String(r['COLUMN_NAME']),
      refTable: String(r['REFERENCED_TABLE_NAME']),
      refColumn: String(r['REFERENCED_COLUMN_NAME']),
    }));
  }

  async getRowCount(table: string): Promise<number> {
    const r = await this.q(`SELECT COUNT(*) AS C FROM ${id(table)}`);
    return Number(r[0]?.['C'] ?? 0);
  }

  async getTableSizeBytes(table: string): Promise<number> {
    const r = await this.q(
      `SELECT COALESCE(DATA_LENGTH,0)+COALESCE(INDEX_LENGTH,0) AS S
       FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
      [this.db, table],
    );
    return Number(r[0]?.['S'] ?? 0);
  }

  async getTriggers(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
       WHERE EVENT_OBJECT_SCHEMA=? AND EVENT_OBJECT_TABLE=?`,
      [this.db, table],
    );
    return rows.map((r) => String(r['TRIGGER_NAME']));
  }

  async getPartitions(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT PARTITION_NAME FROM information_schema.PARTITIONS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND PARTITION_NAME IS NOT NULL`,
      [this.db, table],
    );
    return rows.map((r) => String(r['PARTITION_NAME']));
  }

  async getRoutinesReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA=? AND ROUTINE_DEFINITION LIKE ?`,
      [this.db, `%${table}%`],
    );
    return rows.map((r) => String(r['ROUTINE_NAME']));
  }

  async getEventsReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT EVENT_NAME FROM information_schema.EVENTS
       WHERE EVENT_SCHEMA=? AND EVENT_DEFINITION LIKE ?`,
      [this.db, `%${table}%`],
    );
    return rows.map((r) => String(r['EVENT_NAME']));
  }

  async getViewsReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT TABLE_NAME FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA=? AND VIEW_DEFINITION LIKE ?`,
      [this.db, `%${table}%`],
    );
    return rows.map((r) => String(r['TABLE_NAME']));
  }

  async getGrants(): Promise<GrantInfo> {
    const empty: GrantInfo = {
      select: false,
      insert: false,
      update: false,
      delete: false,
      create: false,
    };
    let rows: Record<string, unknown>[];
    try {
      rows = await this.q('SHOW GRANTS');
    } catch {
      // Can't read grants — assume the connection works (it did connect).
      return { select: true, insert: true, update: true, delete: true, create: true };
    }
    const out = { ...empty };
    const dbLower = this.db.toLowerCase();
    for (const r of rows) {
      const line = String(Object.values(r)[0] ?? '');
      const m = line.match(/GRANT (.+?) ON (.+?) TO /i);
      if (!m) continue;
      const privs = m[1].toUpperCase();
      const scope = m[2].toLowerCase().replace(/`/g, '');
      const appliesToDb =
        scope === '*.*' || scope === `${dbLower}.*` || scope.startsWith(`${dbLower}.`);
      if (!appliesToDb) continue;
      const all = privs.includes('ALL PRIVILEGES');
      if (all || privs.includes('SELECT')) out.select = true;
      if (all || privs.includes('INSERT')) out.insert = true;
      if (all || /\bUPDATE\b/.test(privs)) out.update = true;
      if (all || /\bDELETE\b/.test(privs)) out.delete = true;
      if (all || privs.includes('CREATE')) out.create = true;
    }
    return out;
  }

  async maxCharLength(table: string, column: string): Promise<number | null> {
    const r = await this.q(`SELECT MAX(CHAR_LENGTH(${id(column)})) AS M FROM ${id(table)}`);
    return r[0]?.['M'] === null || r[0]?.['M'] === undefined ? null : Number(r[0]['M']);
  }

  async maxNumeric(table: string, column: string): Promise<bigint | null> {
    const r = await this.q(`SELECT CAST(MAX(${id(column)}) AS CHAR) AS M FROM ${id(table)}`);
    const v = r[0]?.['M'];
    if (v === null || v === undefined) return null;
    try {
      return BigInt(String(v).split('.')[0]);
    } catch {
      return null;
    }
  }

  async nullCount(table: string, column: string): Promise<number> {
    const r = await this.q(
      `SELECT COUNT(*) AS C FROM ${id(table)} WHERE ${id(column)} IS NULL`,
    );
    return Number(r[0]?.['C'] ?? 0);
  }

  async checksum(table: string): Promise<string | null> {
    try {
      const r = await this.q(`CHECKSUM TABLE ${id(table)}`);
      const v = r[0]?.['Checksum'];
      return v === null || v === undefined ? null : String(v);
    } catch {
      return null;
    }
  }

  async sampleKeys(table: string, pkCols: string[], limit: number): Promise<unknown[][]> {
    if (pkCols.length === 0) return [];
    const cols = pkCols.map(id).join(', ');
    const rows = await this.q(`SELECT ${cols} FROM ${id(table)} LIMIT ?`, [limit]);
    return rows.map((r) => pkCols.map((c) => r[c]));
  }

  async sampleRows(table: string, limit: number): Promise<Array<Record<string, unknown>>> {
    return this.q(`SELECT * FROM ${id(table)} LIMIT ?`, [limit]);
  }

  async probeDuplicates(
    table: string,
    pkCols: string[],
    sourceKeySample: unknown[][],
  ): Promise<DuplicateProbe> {
    if (pkCols.length === 0 || sourceKeySample.length === 0) {
      return { count: 0, sample: [], sampled: false };
    }
    const escCols = pkCols.map(id);
    let sql: string;
    let params: unknown[];
    if (pkCols.length === 1) {
      sql = `SELECT ${escCols[0]} AS k FROM ${id(table)} WHERE ${escCols[0]} IN (?)`;
      params = [sourceKeySample.map((t) => t[0])];
    } else {
      sql = `SELECT ${escCols.map((c, i) => `${c} AS k${i}`).join(', ')} FROM ${id(table)} WHERE (${escCols.join(', ')}) IN (?)`;
      params = [sourceKeySample];
    }
    const found = await this.q(sql, params);
    const sample = found
      .slice(0, 5)
      .map((r) =>
        pkCols.length === 1
          ? String(r['k'])
          : pkCols.map((_, i) => String(r[`k${i}`])).join(' | '),
      );
    return { count: found.length, sample, sampled: true };
  }
}
