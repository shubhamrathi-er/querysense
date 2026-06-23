import { Pool as PgPool, PoolClient } from 'pg';
import { createPostgresPool } from '../../common/db/mysql-pool';
import { quoteIdent } from '../../common/db/engine';
import {
  BATCH,
  type BaseTable,
  type Conflict,
  type MigrationConn,
  type MigrationDriver,
} from './migration-driver';

const id = (n: string) => quoteIdent('postgres', n);

interface ColInfo {
  name: string;
  type: string;
  notnull: boolean;
  identity: string; // 'a' always | 'd' by default | '' none
  generated: string; // 's' stored | '' none
  default: string | null;
}

/**
 * PostgreSQL data-migration strategy. Same-engine (pg→pg) only. DDL is
 * reconstructed from the catalog (no SHOW CREATE TABLE); writes use ON CONFLICT
 * and OVERRIDING SYSTEM VALUE so source identity/PK values are preserved, with a
 * best-effort sequence reset afterwards. Scoped to the connection's current
 * schema. Foreign-key constraints are NOT recreated by the table clone — create
 * the target schema yourself (createTables off) if you need them.
 */
export class PostgresMigrationDriver implements MigrationDriver {
  readonly engine = 'postgres' as const;

  private sPool!: PgPool;
  private tPool!: PgPool;
  private tClient!: PoolClient;
  private sCleanup?: () => Promise<void>;
  private tCleanup?: () => Promise<void>;
  /** True once FK triggers are suppressed via session_replication_role=replica. */
  private fkDisabled = false;

  constructor(
    private source: MigrationConn,
    private target: MigrationConn,
  ) {}

  private pool(c: MigrationConn) {
    return createPostgresPool({
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
    this.tClient = await pool.connect();
    // Disable FK-trigger enforcement for the copy (needs sufficient privilege;
    // ignored if not permitted — topological ordering still keeps inserts valid).
    try {
      await this.tClient.query('SET session_replication_role = replica');
      this.fkDisabled = true;
    } catch {
      /* not a superuser — rely on insertion order */
    }
  }

  async close(): Promise<void> {
    if (this.tClient) {
      try {
        await this.tClient.query('SET session_replication_role = origin');
      } catch {
        /* ignore */
      }
      this.tClient.release();
    }
    if (this.sCleanup) await this.sCleanup();
    if (this.tCleanup) await this.tCleanup();
  }

  private async rows(pool: PgPool, sql: string, params: unknown[] = []) {
    return (await pool.query(sql, params)).rows as Record<string, unknown>[];
  }

  private async baseTables(pool: PgPool): Promise<BaseTable[]> {
    const rows = await this.rows(
      pool,
      `SELECT t.table_name AS name, COALESCE(st.n_live_tup, 0) AS rows
       FROM information_schema.tables t
       LEFT JOIN pg_stat_user_tables st
         ON st.relname = t.table_name AND st.schemaname = t.table_schema
       WHERE t.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
       ORDER BY t.table_name`,
    );
    return rows.map((r) => ({ name: String(r['name']), rows: Number(r['rows'] ?? 0) }));
  }

  sourceBaseTables() {
    return this.baseTables(this.sPool);
  }
  targetBaseTables() {
    return this.baseTables(this.tPool);
  }

  async sourceForeignKeys() {
    const rows = await this.rows(
      this.sPool,
      `SELECT tc.table_name AS tbl, ccu.table_name AS ref
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = current_schema()`,
    );
    return rows.map((r) => ({
      table: String(r['tbl']),
      refTable: String(r['ref']),
    }));
  }

  private async count(pool: PgPool, table: string): Promise<number> {
    const r = await this.rows(pool, `SELECT COUNT(*) AS c FROM ${id(table)}`);
    return Number(r[0]?.['c'] ?? 0);
  }
  sourceCount(table: string) {
    return this.count(this.sPool, table);
  }
  targetCount(table: string) {
    return this.count(this.tPool, table);
  }

  private async primaryKey(table: string): Promise<string[]> {
    const rows = await this.rows(
      this.sPool,
      `SELECT kcu.column_name AS name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = current_schema() AND tc.table_name = $1
       ORDER BY kcu.ordinal_position`,
      [table],
    );
    return rows.map((r) => String(r['name']));
  }

  private async columns(table: string): Promise<ColInfo[]> {
    const rows = await this.rows(
      this.sPool,
      `SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS notnull,
              a.attidentity AS identity,
              a.attgenerated AS generated,
              pg_get_expr(ad.adbin, ad.adrelid) AS def
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE n.nspname = current_schema() AND c.relname = $1
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [table],
    );
    return rows.map((r) => ({
      name: String(r['name']),
      type: String(r['type']),
      notnull: r['notnull'] === true,
      identity: String(r['identity'] ?? ''),
      generated: String(r['generated'] ?? ''),
      default: r['def'] === null || r['def'] === undefined ? null : String(r['def']),
    }));
  }

  /** Columns we can write to (excludes STORED generated cols), and whether any
   *  is a GENERATED ALWAYS identity (which needs OVERRIDING SYSTEM VALUE). */
  private async insertable(
    table: string,
  ): Promise<{ cols: string[]; overriding: boolean; identityCols: string[] }> {
    const all = await this.columns(table);
    const writable = all.filter((c) => c.generated !== 's');
    return {
      cols: writable.map((c) => c.name),
      overriding: writable.some((c) => c.identity === 'a'),
      identityCols: writable.filter((c) => c.identity !== '').map((c) => c.name),
    };
  }

  private buildCreateTable(table: string, cols: ColInfo[], pk: string[]): string {
    const defs = cols.map((c) => {
      let d = `  ${id(c.name)} ${c.type}`;
      if (c.generated === 's' && c.default) {
        d += ` GENERATED ALWAYS AS (${c.default}) STORED`;
      } else if (c.identity === 'a') {
        d += ' GENERATED ALWAYS AS IDENTITY';
      } else if (c.identity === 'd') {
        d += ' GENERATED BY DEFAULT AS IDENTITY';
      } else if (c.default !== null) {
        d += ` DEFAULT ${c.default}`;
      }
      if (c.notnull && c.identity === '' && c.generated === '') d += ' NOT NULL';
      return d;
    });
    if (pk.length) defs.push(`  PRIMARY KEY (${pk.map(id).join(', ')})`);
    return `CREATE TABLE ${id(table)} (\n${defs.join(',\n')}\n)`;
  }

  async createTableOnTarget(table: string): Promise<void> {
    const cols = await this.columns(table);
    const pk = await this.primaryKey(table);
    await this.tClient.query(this.buildCreateTable(table, cols, pk));
  }

  async truncateTarget(table: string): Promise<void> {
    // DELETE (not TRUNCATE) so FK-trigger suppression via session_replication_role
    // applies and we don't risk a CASCADE into non-selected tables.
    await this.tClient.query(`DELETE FROM ${id(table)}`);
  }

  private conflictClause(conflict: Conflict, cols: string[], pk: string[]): string {
    if (conflict === 'skip') return ' ON CONFLICT DO NOTHING';
    if (conflict === 'upsert') {
      if (pk.length === 0) return ' ON CONFLICT DO NOTHING';
      const updates = cols
        .filter((c) => !pk.includes(c))
        .map((c) => `${id(c)} = EXCLUDED.${id(c)}`)
        .join(', ');
      const target = pk.map(id).join(', ');
      return updates
        ? ` ON CONFLICT (${target}) DO UPDATE SET ${updates}`
        : ` ON CONFLICT (${target}) DO NOTHING`;
    }
    return ''; // truncate mode: table already emptied
  }

  private async insertBatch(
    table: string,
    cols: string[],
    overriding: boolean,
    conflict: string,
    rowsData: unknown[][],
  ) {
    if (rowsData.length === 0) return;
    const width = cols.length;
    const tuples = rowsData
      .map(
        (_, ri) =>
          `(${cols.map((__, ci) => `$${ri * width + ci + 1}`).join(', ')})`,
      )
      .join(', ');
    const sql =
      `INSERT INTO ${id(table)} (${cols.map(id).join(', ')}) ` +
      `${overriding ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES ${tuples}${conflict}`;
    await this.tClient.query(sql, rowsData.flat());
  }

  /** After inserting explicit identity values, advance the sequences so future
   *  inserts on the target don't collide. Best-effort. */
  private async resetSequences(table: string, identityCols: string[]) {
    // setval() is silently ignored while session_replication_role = replica, so
    // briefly switch back to origin around the resets.
    if (this.fkDisabled) {
      await this.tClient.query('SET session_replication_role = origin');
    }
    try {
      for (const col of identityCols) {
        try {
          await this.tClient.query(
            `SELECT setval(
               pg_get_serial_sequence(format('%I.%I', current_schema(), $1::text), $2::text),
               GREATEST((SELECT COALESCE(MAX(${id(col)}), 0) FROM ${id(table)}), 1),
               true)`,
            [table, col],
          );
        } catch {
          /* no sequence for this column, or insufficient privilege */
        }
      }
    } finally {
      if (this.fkDisabled) {
        await this.tClient.query('SET session_replication_role = replica');
      }
    }
  }

  async copyTable(
    table: string,
    conflict: Conflict,
    onProgress: (copied: number, total: number) => void,
  ): Promise<number> {
    const { cols, overriding, identityCols } = await this.insertable(table);
    if (cols.length === 0) return 0;
    const pk = await this.primaryKey(table);
    const total = await this.sourceCount(table);
    const colList = cols.map(id).join(', ');
    const conflictClause = this.conflictClause(conflict, cols, pk);

    let copied = 0;
    if (pk.length === 1) {
      const key = pk[0];
      let last: unknown = null;
      for (;;) {
        const sql =
          last === null
            ? `SELECT ${colList} FROM ${id(table)} ORDER BY ${id(key)} ASC LIMIT $1`
            : `SELECT ${colList} FROM ${id(table)} WHERE ${id(key)} > $1 ORDER BY ${id(key)} ASC LIMIT $2`;
        const params = last === null ? [BATCH] : [last, BATCH];
        const rows = await this.rows(this.sPool, sql, params);
        if (rows.length === 0) break;
        await this.insertBatch(
          table,
          cols,
          overriding,
          conflictClause,
          rows.map((r) => cols.map((c) => r[c])),
        );
        copied += rows.length;
        last = rows[rows.length - 1][key];
        onProgress(copied, total);
        if (rows.length < BATCH) break;
      }
    } else {
      // Stable order via ctid (physical row id) so OFFSET paging can't skip rows.
      let offset = 0;
      for (;;) {
        const rows = await this.rows(
          this.sPool,
          `SELECT ${colList} FROM ${id(table)} ORDER BY ctid LIMIT $1 OFFSET $2`,
          [BATCH, offset],
        );
        if (rows.length === 0) break;
        await this.insertBatch(
          table,
          cols,
          overriding,
          conflictClause,
          rows.map((r) => cols.map((c) => r[c])),
        );
        copied += rows.length;
        offset += rows.length;
        onProgress(copied, total);
        if (rows.length < BATCH) break;
      }
    }

    if (overriding || identityCols.length) await this.resetSequences(table, identityCols);
    return copied;
  }

  // ── script generation ──

  scriptHeader(sourceName: string, sourceDb: string): string[] {
    return [
      '-- Migration script generated by QuerySense (PostgreSQL)',
      `-- Source: ${sourceName} (${sourceDb})`,
      '-- Note: foreign-key constraints and custom types are not recreated here.',
      'SET session_replication_role = replica;',
      '',
    ];
  }
  scriptFooter(): string[] {
    return ['SET session_replication_role = origin;'];
  }

  async scriptCreateTable(table: string): Promise<string[]> {
    const cols = await this.columns(table);
    const pk = await this.primaryKey(table);
    return [
      `DROP TABLE IF EXISTS ${id(table)} CASCADE;`,
      `${this.buildCreateTable(table, cols, pk)};`,
      '',
    ];
  }

  scriptTruncate(table: string): string {
    return `DELETE FROM ${id(table)};`;
  }

  /** Render a JS value as a Postgres SQL literal (standard_conforming_strings). */
  private literal(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date) return `'${v.toISOString()}'`;
    if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
    if (typeof v === 'object') {
      return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
    }
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  async scriptInserts(table: string, conflict: Conflict, rowCap: number) {
    const { cols, overriding } = await this.insertable(table);
    const lines: string[] = [];
    if (cols.length === 0) return { lines, rows: 0, truncated: false };
    const pk = await this.primaryKey(table);
    const conflictClause = this.conflictClause(conflict, cols, pk);
    const colList = cols.map(id).join(', ');
    const prefix =
      `INSERT INTO ${id(table)} (${colList}) ` +
      `${overriding ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES `;

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
      const data = await this.rows(
        this.sPool,
        `SELECT ${colList} FROM ${id(table)} ORDER BY ctid LIMIT $1 OFFSET $2`,
        [BATCH, offset],
      );
      if (data.length === 0) break;
      const tuples = data
        .map((r) => `(${cols.map((c) => this.literal(r[c])).join(', ')})`)
        .join(',\n  ');
      lines.push(`${prefix}\n  ${tuples}${conflictClause};`);
      rows += data.length;
      offset += data.length;
      if (data.length < BATCH) break;
    }
    lines.push('');
    return { lines, rows, truncated };
  }
}
