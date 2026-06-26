import { createPool, type SqlClient, type SshConfig } from '../../../common/db/mysql-pool';
import { quoteIdent } from '../../../common/db/engine';
import type { ColumnSummary, IndexSummary } from '../types';
import type {
  DialectAdapter,
  FkDetail,
  GrantInfo,
  DuplicateProbe,
} from './dialect-adapter.interface';

export interface OracleConnConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslEnabled: boolean;
  ssh?: SshConfig;
}

const id = (n: string) => quoteIdent('oracle', n);
const BLOB_TYPES = new Set(['blob', 'raw', 'long raw', 'bfile']);
const TEXT_TYPES = new Set(['clob', 'nclob', 'long']);

/**
 * Oracle implementation of DialectAdapter, scoped to the connected user's schema
 * via the USER_* data-dictionary views (Oracle has no information_schema). Uses
 * node-oracledb (thin mode) through the shared SqlClient with :n binds.
 */
export class OracleAdapter implements DialectAdapter {
  readonly dialect = 'oracle';
  private client!: SqlClient;

  constructor(private cfg: OracleConnConfig) {}

  async connect(): Promise<void> {
    this.client = await createPool('oracle', {
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
  }
  async close(): Promise<void> {
    if (this.client) await this.client.cleanup();
  }

  private q(sql: string, params: unknown[] = []) {
    return this.client.query<Record<string, unknown>>(sql, params);
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async databaseExists(): Promise<boolean> {
    const r = await this.q('SELECT 1 AS "x" FROM dual');
    return r.length > 0;
  }

  async tableExists(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT 1 AS "x" FROM user_tables WHERE table_name = :1`,
      [table],
    );
    return r.length > 0;
  }

  async isView(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT 1 AS "x" FROM user_views WHERE view_name = :1`,
      [table],
    );
    return r.length > 0;
  }

  async getColumns(table: string): Promise<ColumnSummary[]> {
    const rows = await this.q(
      `SELECT column_name AS "name", data_type AS "dataType", char_length AS "len",
              data_precision AS "prec", data_scale AS "scale",
              CASE WHEN nullable = 'Y' THEN 'YES' ELSE 'NO' END AS "nullable",
              data_default AS "dflt", identity_column AS "identity",
              virtual_column AS "virtual"
       FROM user_tab_cols WHERE table_name = :1 AND hidden_column = 'NO' ORDER BY column_id`,
      [table],
    );
    return rows.map((r) => {
      const dataType = String(r['dataType']).toLowerCase();
      const len =
        r['len'] === null || r['len'] === undefined || Number(r['len']) === 0
          ? null
          : Number(r['len']);
      const prec = r['prec'] === null ? null : Number(r['prec']);
      const scale = r['scale'] === null ? null : Number(r['scale']);
      const columnType =
        len != null
          ? `${dataType}(${len})`
          : dataType === 'number' && prec != null
            ? `${dataType}(${prec},${scale ?? 0})`
            : dataType;
      return {
        name: String(r['name']),
        dataType,
        columnType,
        length: len,
        precision: prec,
        scale,
        nullable: String(r['nullable']).toUpperCase() === 'YES',
        defaultValue: r['dflt'] === null ? null : String(r['dflt']),
        charset: null,
        collation: null,
        autoIncrement: String(r['identity'] ?? '').toUpperCase() === 'YES',
        unsigned: false,
        generated: String(r['virtual'] ?? '').toUpperCase() === 'YES',
        isBlob: BLOB_TYPES.has(dataType),
        isText: TEXT_TYPES.has(dataType),
        isEnum: false,
        enumValues: [],
      };
    });
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT cc.column_name AS "name"
       FROM user_constraints c
       JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
       WHERE c.constraint_type = 'P' AND c.table_name = :1
       ORDER BY cc.position`,
      [table],
    );
    return rows.map((r) => String(r['name']));
  }

  async getUniqueKeys(table: string): Promise<string[][]> {
    const rows = await this.q(
      `SELECT c.constraint_name AS "cn", cc.column_name AS "col"
       FROM user_constraints c
       JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
       WHERE c.constraint_type = 'U' AND c.table_name = :1
       ORDER BY c.constraint_name, cc.position`,
      [table],
    );
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const k = String(r['cn']);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(String(r['col']));
    }
    return [...map.values()];
  }

  async getIndexes(table: string): Promise<IndexSummary[]> {
    const rows = await this.q(
      `SELECT i.index_name AS "name", i.uniqueness AS "uniq",
              c.column_name AS "col", c.column_position AS "pos"
       FROM user_indexes i
       JOIN user_ind_columns c ON c.index_name = i.index_name
       WHERE i.table_name = :1
         AND NOT EXISTS (
           SELECT 1 FROM user_constraints uc
           WHERE uc.index_name = i.index_name AND uc.constraint_type = 'P'
         )
       ORDER BY i.index_name, c.column_position`,
      [table],
    );
    const map = new Map<string, IndexSummary>();
    for (const r of rows) {
      const name = String(r['name']);
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: String(r['uniq']) === 'UNIQUE' });
      }
      map.get(name)!.columns.push(String(r['col']));
    }
    return [...map.values()];
  }

  async getForeignKeys(): Promise<FkDetail[]> {
    const rows = await this.q(
      `SELECT acc.table_name AS "tbl", acc.column_name AS "col",
              pk.table_name AS "refTbl", pkc.column_name AS "refCol"
       FROM user_constraints a
       JOIN user_cons_columns acc ON acc.constraint_name = a.constraint_name
       JOIN user_constraints pk ON pk.constraint_name = a.r_constraint_name
       JOIN user_cons_columns pkc ON pkc.constraint_name = pk.constraint_name
                                 AND pkc.position = acc.position
       WHERE a.constraint_type = 'R'`,
    );
    return rows.map((r) => ({
      table: String(r['tbl']),
      column: String(r['col']),
      refTable: String(r['refTbl']),
      refColumn: String(r['refCol']),
    }));
  }

  async getRowCount(table: string): Promise<number> {
    const r = await this.q(`SELECT COUNT(*) AS "c" FROM ${id(table)}`);
    return Number(r[0]?.['c'] ?? 0);
  }

  async getTableSizeBytes(table: string): Promise<number> {
    const r = await this.q(
      `SELECT NVL(SUM(bytes), 0) AS "s" FROM user_segments WHERE segment_name = :1`,
      [table],
    );
    return Number(r[0]?.['s'] ?? 0);
  }

  async getTriggers(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT trigger_name AS "name" FROM user_triggers WHERE table_name = :1`,
      [table],
    );
    return rows.map((r) => String(r['name']));
  }

  async getPartitions(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT partition_name AS "name" FROM user_tab_partitions WHERE table_name = :1`,
      [table],
    );
    return rows.map((r) => String(r['name']));
  }

  async getRoutinesReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT DISTINCT name AS "name" FROM user_dependencies
       WHERE referenced_name = :1 AND type IN ('PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY')`,
      [table],
    );
    return rows.map((r) => String(r['name']));
  }

  async getEventsReferencing(): Promise<string[]> {
    // Oracle scheduler jobs aren't a MySQL-events equivalent; skip.
    return [];
  }

  async getViewsReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT DISTINCT name AS "name" FROM user_dependencies
       WHERE referenced_name = :1 AND type = 'VIEW'`,
      [table],
    );
    return rows.map((r) => String(r['name']));
  }

  async getGrants(): Promise<GrantInfo> {
    // Connections operate within the user's own schema, which they fully own.
    return { select: true, insert: true, update: true, delete: true, create: true };
  }

  async maxCharLength(table: string, column: string): Promise<number | null> {
    const r = await this.q(
      `SELECT MAX(LENGTH(TO_CHAR(${id(column)}))) AS "m" FROM ${id(table)}`,
    );
    const v = r[0]?.['m'];
    return v === null || v === undefined ? null : Number(v);
  }

  async maxNumeric(table: string, column: string): Promise<bigint | null> {
    const r = await this.q(
      `SELECT TO_CHAR(MAX(${id(column)})) AS "m" FROM ${id(table)}`,
    );
    const v = r[0]?.['m'];
    if (v === null || v === undefined) return null;
    try {
      return BigInt(String(v).split('.')[0]);
    } catch {
      return null;
    }
  }

  async nullCount(table: string, column: string): Promise<number> {
    const r = await this.q(
      `SELECT COUNT(*) AS "c" FROM ${id(table)} WHERE ${id(column)} IS NULL`,
    );
    return Number(r[0]?.['c'] ?? 0);
  }

  async checksum(): Promise<string | null> {
    // No cheap whole-table checksum in Oracle; skip.
    return null;
  }

  async sampleKeys(
    table: string,
    pkCols: string[],
    limit: number,
  ): Promise<unknown[][]> {
    if (pkCols.length === 0) return [];
    const cols = pkCols.map(id).join(', ');
    const rows = await this.q(
      `SELECT ${cols} FROM ${id(table)} FETCH FIRST :1 ROWS ONLY`,
      [limit],
    );
    return rows.map((r) => pkCols.map((c) => r[c]));
  }

  async sampleRows(table: string, limit: number): Promise<Array<Record<string, unknown>>> {
    return this.q(`SELECT * FROM ${id(table)} FETCH FIRST :1 ROWS ONLY`, [limit]);
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
    const width = pkCols.length;
    let where: string;
    if (width === 1) {
      where = `${escCols[0]} IN (${sourceKeySample.map((_, i) => `:${i + 1}`).join(', ')})`;
    } else {
      const tuples = sourceKeySample
        .map(
          (_, ri) =>
            `(${escCols.map((__, ci) => `:${ri * width + ci + 1}`).join(', ')})`,
        )
        .join(', ');
      where = `(${escCols.join(', ')}) IN (${tuples})`;
    }
    const select = escCols.map((c, i) => `${c} AS "k${i}"`).join(', ');
    const found = await this.q(
      `SELECT ${select} FROM ${id(table)} WHERE ${where}`,
      sourceKeySample.flat(),
    );
    const sample = found
      .slice(0, 5)
      .map((r) =>
        width === 1
          ? String(r['k0'])
          : pkCols.map((_, i) => String(r[`k${i}`])).join(' | '),
      );
    return { count: found.length, sample, sampled: true };
  }
}
