import { createPool, type SqlClient, type SshConfig } from '../../../common/db/mysql-pool';
import { quoteIdent } from '../../../common/db/engine';
import type { ColumnSummary, IndexSummary } from '../types';
import type {
  DialectAdapter,
  FkDetail,
  GrantInfo,
  DuplicateProbe,
} from './dialect-adapter.interface';

export interface SqlServerConnConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslEnabled: boolean;
  ssh?: SshConfig;
}

const SCHEMA = 'dbo';
const id = (n: string) => quoteIdent('sqlserver', n);
/** Schema-qualified, bracket-quoted table reference. */
const tbl = (n: string) => `${id(SCHEMA)}.${id(n)}`;

const BLOB_TYPES = new Set(['binary', 'varbinary', 'image']);
const TEXT_TYPES = new Set(['text', 'ntext']);

/**
 * SQL Server implementation of DialectAdapter. Scoped to the `dbo` schema.
 * Built on the shared SqlClient (typed @pN params); uses INFORMATION_SCHEMA +
 * sys catalogs and T-SQL idioms (TOP, COUNT_BIG, CHECKSUM_AGG, HAS_PERMS_BY_NAME).
 */
export class SqlServerAdapter implements DialectAdapter {
  readonly dialect = 'sqlserver';
  private client!: SqlClient;

  constructor(private cfg: SqlServerConnConfig) {}

  async connect(): Promise<void> {
    this.client = await createPool('sqlserver', {
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
    const r = await this.q('SELECT DB_ID() AS id');
    return r[0]?.['id'] != null;
  }

  async tableExists(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = @p0 AND TABLE_NAME = @p1`,
      [SCHEMA, table],
    );
    return r.length > 0;
  }

  async isView(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT TABLE_TYPE AS t FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = @p0 AND TABLE_NAME = @p1`,
      [SCHEMA, table],
    );
    return String(r[0]?.['t']) === 'VIEW';
  }

  async getColumns(table: string): Promise<ColumnSummary[]> {
    const rows = await this.q(
      `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType,
              c.CHARACTER_MAXIMUM_LENGTH AS len, c.NUMERIC_PRECISION AS prec,
              c.NUMERIC_SCALE AS scale, c.IS_NULLABLE AS nullable,
              c.COLUMN_DEFAULT AS dflt, c.COLLATION_NAME AS collation,
              COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS isIdentity,
              COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed') AS isComputed
       FROM INFORMATION_SCHEMA.COLUMNS c
       WHERE c.TABLE_SCHEMA = @p0 AND c.TABLE_NAME = @p1
       ORDER BY c.ORDINAL_POSITION`,
      [SCHEMA, table],
    );
    return rows.map((r) => {
      const dataType = String(r['dataType']).toLowerCase();
      const len =
        r['len'] === null || r['len'] === undefined || Number(r['len']) < 0
          ? null
          : Number(r['len']);
      const prec = r['prec'] === null ? null : Number(r['prec']);
      const scale = r['scale'] === null ? null : Number(r['scale']);
      const columnType =
        len != null
          ? `${dataType}(${len})`
          : (dataType === 'decimal' || dataType === 'numeric') && prec != null
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
        collation: r['collation'] ? String(r['collation']) : null,
        autoIncrement: Number(r['isIdentity']) === 1,
        unsigned: false,
        generated: Number(r['isComputed']) === 1,
        isBlob: BLOB_TYPES.has(dataType),
        isText: TEXT_TYPES.has(dataType),
        isEnum: false,
        enumValues: [],
      };
    });
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT ku.COLUMN_NAME AS name
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
         ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @p0 AND tc.TABLE_NAME = @p1
       ORDER BY ku.ORDINAL_POSITION`,
      [SCHEMA, table],
    );
    return rows.map((r) => String(r['name']));
  }

  async getUniqueKeys(table: string): Promise<string[][]> {
    const rows = await this.q(
      `SELECT tc.CONSTRAINT_NAME AS cn, ku.COLUMN_NAME AS col
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
         ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'UNIQUE' AND tc.TABLE_SCHEMA = @p0 AND tc.TABLE_NAME = @p1
       ORDER BY tc.CONSTRAINT_NAME, ku.ORDINAL_POSITION`,
      [SCHEMA, table],
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
      `SELECT i.name AS name, i.is_unique AS is_unique, c.name AS column_name, ic.key_ordinal AS ord
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
       WHERE i.object_id = OBJECT_ID(@p0) AND i.is_primary_key = 0
         AND i.name IS NOT NULL AND ic.is_included_column = 0
       ORDER BY i.name, ic.key_ordinal`,
      [table],
    );
    const map = new Map<string, IndexSummary>();
    for (const r of rows) {
      const name = String(r['name']);
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: r['is_unique'] === true || r['is_unique'] === 1 });
      }
      map.get(name)!.columns.push(String(r['column_name']));
    }
    return [...map.values()];
  }

  async getForeignKeys(): Promise<FkDetail[]> {
    const rows = await this.q(
      `SELECT OBJECT_NAME(fk.parent_object_id) AS tbl, pc.name AS col,
              OBJECT_NAME(fk.referenced_object_id) AS refTbl, rc.name AS refCol
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE SCHEMA_NAME(fk.schema_id) = @p0`,
      [SCHEMA],
    );
    return rows.map((r) => ({
      table: String(r['tbl']),
      column: String(r['col']),
      refTable: String(r['refTbl']),
      refColumn: String(r['refCol']),
    }));
  }

  async getRowCount(table: string): Promise<number> {
    const r = await this.q(`SELECT COUNT_BIG(*) AS c FROM ${tbl(table)}`);
    return Number(r[0]?.['c'] ?? 0);
  }

  async getTableSizeBytes(table: string): Promise<number> {
    const r = await this.q(
      `SELECT ISNULL(SUM(a.total_pages) * 8 * 1024, 0) AS s
       FROM sys.tables t
       JOIN sys.indexes i ON i.object_id = t.object_id
       JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id = i.index_id
       JOIN sys.allocation_units a ON a.container_id = p.partition_id
       WHERE t.name = @p0 AND SCHEMA_NAME(t.schema_id) = @p1`,
      [table, SCHEMA],
    );
    return Number(r[0]?.['s'] ?? 0);
  }

  async getTriggers(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT tr.name AS name FROM sys.triggers tr
       JOIN sys.tables t ON t.object_id = tr.parent_id
       WHERE t.name = @p0 AND SCHEMA_NAME(t.schema_id) = @p1`,
      [table, SCHEMA],
    );
    return rows.map((r) => String(r['name']));
  }

  async getPartitions(): Promise<string[]> {
    // SQL Server partitioning is schema-level (partition functions/schemes);
    // not surfaced as named child tables. Skip.
    return [];
  }

  async getRoutinesReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT ROUTINE_NAME AS name FROM INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_SCHEMA = @p0 AND ROUTINE_DEFINITION LIKE @p1`,
      [SCHEMA, `%${table}%`],
    );
    return rows.map((r) => String(r['name']));
  }

  async getEventsReferencing(): Promise<string[]> {
    // No MySQL-style scheduled events (SQL Agent jobs are server-level).
    return [];
  }

  async getViewsReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.VIEWS
       WHERE TABLE_SCHEMA = @p0 AND VIEW_DEFINITION LIKE @p1`,
      [SCHEMA, `%${table}%`],
    );
    return rows.map((r) => String(r['name']));
  }

  async getGrants(): Promise<GrantInfo> {
    try {
      const r = await this.q(
        `SELECT
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'SELECT') AS sel,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS ins,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS upd,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS del,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS cre`,
      );
      const row = r[0] ?? {};
      return {
        select: Number(row['sel']) === 1,
        insert: Number(row['ins']) === 1,
        update: Number(row['upd']) === 1,
        delete: Number(row['del']) === 1,
        create: Number(row['cre']) === 1,
      };
    } catch {
      return { select: true, insert: true, update: true, delete: true, create: true };
    }
  }

  async maxCharLength(table: string, column: string): Promise<number | null> {
    const r = await this.q(
      `SELECT MAX(LEN(CAST(${id(column)} AS NVARCHAR(MAX)))) AS m FROM ${tbl(table)}`,
    );
    const v = r[0]?.['m'];
    return v === null || v === undefined ? null : Number(v);
  }

  async maxNumeric(table: string, column: string): Promise<bigint | null> {
    const r = await this.q(
      `SELECT CAST(MAX(${id(column)}) AS VARCHAR(64)) AS m FROM ${tbl(table)}`,
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
      `SELECT COUNT_BIG(*) AS c FROM ${tbl(table)} WHERE ${id(column)} IS NULL`,
    );
    return Number(r[0]?.['c'] ?? 0);
  }

  async checksum(table: string): Promise<string | null> {
    try {
      const r = await this.q(
        `SELECT CHECKSUM_AGG(CHECKSUM(*)) AS c FROM ${tbl(table)}`,
      );
      const v = r[0]?.['c'];
      return v === null || v === undefined ? null : String(v);
    } catch {
      return null;
    }
  }

  async sampleKeys(
    table: string,
    pkCols: string[],
    limit: number,
  ): Promise<unknown[][]> {
    if (pkCols.length === 0) return [];
    const cols = pkCols.map(id).join(', ');
    const rows = await this.q(
      `SELECT TOP (@p0) ${cols} FROM ${tbl(table)}`,
      [limit],
    );
    return rows.map((r) => pkCols.map((c) => r[c]));
  }

  async sampleRows(table: string, limit: number): Promise<Array<Record<string, unknown>>> {
    return this.q(`SELECT TOP (@p0) * FROM ${tbl(table)}`, [limit]);
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
      where = `${escCols[0]} IN (${sourceKeySample.map((_, i) => `@p${i}`).join(', ')})`;
    } else {
      where = sourceKeySample
        .map(
          (_, ri) =>
            `(${escCols.map((c, ci) => `${c} = @p${ri * width + ci}`).join(' AND ')})`,
        )
        .join(' OR ');
    }
    const select = escCols.map((c, i) => `${c} AS k${i}`).join(', ');
    const found = await this.q(
      `SELECT ${select} FROM ${tbl(table)} WHERE ${where}`,
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
