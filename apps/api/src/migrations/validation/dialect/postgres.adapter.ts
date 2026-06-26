import { Pool as PgPool } from 'pg';
import { createPostgresPool, type SshConfig } from '../../../common/db/mysql-pool';
import { quoteIdent } from '../../../common/db/engine';
import type { ColumnSummary, IndexSummary } from '../types';
import type {
  DialectAdapter,
  FkDetail,
  GrantInfo,
  DuplicateProbe,
} from './dialect-adapter.interface';

export interface PostgresConnConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslEnabled: boolean;
  ssh?: SshConfig;
}

const id = (n: string) => quoteIdent('postgres', n);

function columnTypeOf(
  dataType: string,
  length: number | null,
  precision: number | null,
  scale: number | null,
): string {
  if (length != null) return `${dataType}(${length})`;
  if ((dataType === 'numeric' || dataType === 'decimal') && precision != null) {
    return `${dataType}(${precision},${scale ?? 0})`;
  }
  return dataType;
}

/**
 * PostgreSQL implementation of DialectAdapter. Scoped to the connection's
 * current schema (conventionally `public`). Mirrors MysqlAdapter but queries the
 * lowercase information_schema and pg_catalog, and uses $n placeholders.
 */
export class PostgresAdapter implements DialectAdapter {
  readonly dialect = 'postgres';
  private pool!: PgPool;
  private cleanup?: () => Promise<void>;

  constructor(private cfg: PostgresConnConfig) {}

  async connect(): Promise<void> {
    const tunneled = await createPostgresPool({
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

  private async q(sql: string, params: unknown[] = []) {
    const res = await this.pool.query(sql, params);
    return res.rows as Record<string, unknown>[];
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async databaseExists(): Promise<boolean> {
    // Connecting already proves the database exists; confirm the schema too.
    const r = await this.q(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = current_schema() LIMIT 1`,
    );
    return r.length > 0;
  }

  async tableExists(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
      [table],
    );
    return r.length > 0;
  }

  async isView(table: string): Promise<boolean> {
    const r = await this.q(
      `SELECT table_type FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
      [table],
    );
    return String(r[0]?.['table_type']) === 'VIEW';
  }

  private async enumLabels(udtName: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT e.enumlabel FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [udtName],
    );
    return rows.map((r) => String(r['enumlabel']));
  }

  async getColumns(table: string): Promise<ColumnSummary[]> {
    const rows = await this.q(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default,
              character_maximum_length, numeric_precision, numeric_scale,
              collation_name, is_identity, is_generated
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );

    const out: ColumnSummary[] = [];
    for (const r of rows) {
      const dataType = String(r['data_type']).toLowerCase();
      const udtName = String(r['udt_name'] ?? '').toLowerCase();
      const length =
        r['character_maximum_length'] === null
          ? null
          : Number(r['character_maximum_length']);
      const precision =
        r['numeric_precision'] === null ? null : Number(r['numeric_precision']);
      const scale =
        r['numeric_scale'] === null ? null : Number(r['numeric_scale']);
      const isEnum = dataType === 'user-defined';
      const isIdentity = String(r['is_identity'] ?? '').toUpperCase() === 'YES';
      const def = r['column_default'];
      out.push({
        name: String(r['column_name']),
        dataType,
        columnType: columnTypeOf(
          isEnum ? udtName : dataType,
          length,
          precision,
          scale,
        ),
        length,
        precision,
        scale,
        nullable: String(r['is_nullable']).toUpperCase() === 'YES',
        defaultValue: def === null ? null : String(def),
        charset: null, // Postgres has no per-column character set
        collation: r['collation_name'] ? String(r['collation_name']) : null,
        autoIncrement: isIdentity || /nextval\(/i.test(String(def ?? '')),
        unsigned: false, // no UNSIGNED concept in Postgres
        generated: String(r['is_generated'] ?? '').toUpperCase() === 'ALWAYS',
        isBlob: dataType === 'bytea',
        isText: dataType === 'text',
        isEnum,
        enumValues: isEnum ? await this.enumLabels(udtName) : [],
      });
    }
    return out;
  }

  async getPrimaryKey(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT kcu.column_name, kcu.ordinal_position
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = current_schema() AND tc.table_name = $1
       ORDER BY kcu.ordinal_position`,
      [table],
    );
    return rows.map((r) => String(r['column_name']));
  }

  async getUniqueKeys(table: string): Promise<string[][]> {
    const rows = await this.q(
      `SELECT tc.constraint_name, kcu.column_name, kcu.ordinal_position
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'UNIQUE'
         AND tc.table_schema = current_schema() AND tc.table_name = $1
       ORDER BY tc.constraint_name, kcu.ordinal_position`,
      [table],
    );
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const k = String(r['constraint_name']);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(String(r['column_name']));
    }
    return [...map.values()];
  }

  async getIndexes(table: string): Promise<IndexSummary[]> {
    const rows = await this.q(
      `SELECT i.relname AS name, ix.indisunique AS is_unique, a.attname AS column_name, k.ord
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = current_schema()
       JOIN pg_index ix ON ix.indrelid = t.oid AND NOT ix.indisprimary
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE t.relname = $1
       ORDER BY i.relname, k.ord`,
      [table],
    );
    const map = new Map<string, IndexSummary>();
    for (const r of rows) {
      const name = String(r['name']);
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: r['is_unique'] === true });
      }
      map.get(name)!.columns.push(String(r['column_name']));
    }
    return [...map.values()];
  }

  async getForeignKeys(): Promise<FkDetail[]> {
    const rows = await this.q(
      `SELECT tc.table_name, kcu.column_name,
              ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = current_schema()`,
    );
    return rows.map((r) => ({
      table: String(r['table_name']),
      column: String(r['column_name']),
      refTable: String(r['ref_table']),
      refColumn: String(r['ref_column']),
    }));
  }

  async getRowCount(table: string): Promise<number> {
    const r = await this.q(`SELECT COUNT(*) AS c FROM ${id(table)}`);
    return Number(r[0]?.['c'] ?? 0);
  }

  async getTableSizeBytes(table: string): Promise<number> {
    const r = await this.q(
      `SELECT pg_total_relation_size(c.oid) AS s
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relname = $1`,
      [table],
    );
    return Number(r[0]?.['s'] ?? 0);
  }

  async getTriggers(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT DISTINCT trigger_name FROM information_schema.triggers
       WHERE trigger_schema = current_schema() AND event_object_table = $1`,
      [table],
    );
    return rows.map((r) => String(r['trigger_name']));
  }

  async getPartitions(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT c.relname FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace
       WHERE n.nspname = current_schema() AND p.relname = $1`,
      [table],
    );
    return rows.map((r) => String(r['relname']));
  }

  async getRoutinesReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = current_schema() AND routine_definition LIKE $1`,
      [`%${table}%`],
    );
    return rows.map((r) => String(r['routine_name']));
  }

  async getEventsReferencing(): Promise<string[]> {
    // PostgreSQL has no scheduled-event subsystem equivalent to MySQL EVENTS.
    return [];
  }

  async getViewsReferencing(table: string): Promise<string[]> {
    const rows = await this.q(
      `SELECT table_name FROM information_schema.views
       WHERE table_schema = current_schema() AND view_definition LIKE $1`,
      [`%${table}%`],
    );
    return rows.map((r) => String(r['table_name']));
  }

  async getGrants(): Promise<GrantInfo> {
    try {
      const r = await this.q(
        `SELECT
           bool_or(privilege_type = 'SELECT') AS sel,
           bool_or(privilege_type = 'INSERT') AS ins,
           bool_or(privilege_type = 'UPDATE') AS upd,
           bool_or(privilege_type = 'DELETE') AS del,
           has_schema_privilege(current_schema(), 'CREATE') AS cre
         FROM information_schema.role_table_grants
         WHERE table_schema = current_schema()
           AND grantee IN (current_user, 'PUBLIC')`,
      );
      const row = r[0] ?? {};
      return {
        select: row['sel'] === true,
        insert: row['ins'] === true,
        update: row['upd'] === true,
        delete: row['del'] === true,
        create: row['cre'] === true,
      };
    } catch {
      // Can't read grants — assume the connection works (it did connect).
      return { select: true, insert: true, update: true, delete: true, create: true };
    }
  }

  async maxCharLength(table: string, column: string): Promise<number | null> {
    const r = await this.q(
      `SELECT MAX(LENGTH(${id(column)}::text)) AS m FROM ${id(table)}`,
    );
    const v = r[0]?.['m'];
    return v === null || v === undefined ? null : Number(v);
  }

  async maxNumeric(table: string, column: string): Promise<bigint | null> {
    const r = await this.q(
      `SELECT MAX(${id(column)})::text AS m FROM ${id(table)}`,
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
      `SELECT COUNT(*) AS c FROM ${id(table)} WHERE ${id(column)} IS NULL`,
    );
    return Number(r[0]?.['c'] ?? 0);
  }

  async checksum(): Promise<string | null> {
    // No cheap table-checksum equivalent to MySQL's CHECKSUM TABLE; skip.
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
      `SELECT ${cols} FROM ${id(table)} LIMIT $1`,
      [limit],
    );
    return rows.map((r) => pkCols.map((c) => r[c]));
  }

  async sampleRows(table: string, limit: number): Promise<Array<Record<string, unknown>>> {
    return this.q(`SELECT * FROM ${id(table)} LIMIT $1`, [limit]) as Promise<
      Array<Record<string, unknown>>
    >;
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
    let sql: string;
    let params: unknown[];
    if (width === 1) {
      const ph = sourceKeySample.map((_, i) => `$${i + 1}`).join(', ');
      sql = `SELECT ${escCols[0]} AS k FROM ${id(table)} WHERE ${escCols[0]} IN (${ph})`;
      params = sourceKeySample.map((t) => t[0]);
    } else {
      const tuples = sourceKeySample
        .map(
          (_, ri) =>
            `(${escCols.map((__, ci) => `$${ri * width + ci + 1}`).join(', ')})`,
        )
        .join(', ');
      sql = `SELECT ${escCols
        .map((c, i) => `${c} AS k${i}`)
        .join(', ')} FROM ${id(table)} WHERE (${escCols.join(', ')}) IN (${tuples})`;
      params = sourceKeySample.flat();
    }
    const found = await this.q(sql, params);
    const sample = found
      .slice(0, 5)
      .map((r) =>
        width === 1
          ? String(r['k'])
          : pkCols.map((_, i) => String(r[`k${i}`])).join(' | '),
      );
    return { count: found.length, sample, sampled: true };
  }
}
