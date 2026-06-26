import { createPool, type SqlClient, type SqlExecutor } from '../../common/db/mysql-pool';
import { quoteIdent } from '../../common/db/engine';
import {
  BATCH,
  makeTransformApplier,
  type BaseTable,
  type Conflict,
  type CopyOptions,
  type MigrationConn,
  type MigrationDriver,
} from './migration-driver';

const SCHEMA = 'dbo';
const id = (n: string) => quoteIdent('sqlserver', n);
const tbl = (n: string) => `${id(SCHEMA)}.${id(n)}`;

interface ColDdl {
  name: string;
  dataType: string;
  len: number | null;
  prec: number | null;
  scale: number | null;
  nullable: boolean;
  identity: boolean;
  computed: boolean;
  default: string | null;
}

/** Build a SQL Server column type string from INFORMATION_SCHEMA parts. */
function typeString(c: ColDdl): string {
  const t = c.dataType.toLowerCase();
  const withLen = ['char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary'];
  if (withLen.includes(t)) {
    const len = c.len === -1 ? 'MAX' : (c.len ?? 'MAX');
    return `${t}(${len})`;
  }
  if (t === 'decimal' || t === 'numeric') {
    return `${t}(${c.prec ?? 18},${c.scale ?? 0})`;
  }
  return t;
}

/**
 * SQL Server (T-SQL) data-migration strategy. Same-engine (mssql→mssql) only.
 * Preserves identity/PK values with SET IDENTITY_INSERT + a DBCC CHECKIDENT
 * reseed afterwards; skip/upsert use MERGE. Scoped to the `dbo` schema; FK
 * constraints and computed columns are not recreated by the table clone.
 */
export class SqlServerMigrationDriver implements MigrationDriver {
  readonly engine = 'sqlserver' as const;

  private sClient!: SqlClient;
  private tClient!: SqlClient;

  constructor(
    private source: MigrationConn,
    private target: MigrationConn,
  ) {}

  private cfg(c: MigrationConn) {
    return {
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      ssl: c.sslEnabled,
      ssh: c.ssh,
      connectionLimit: 4,
      connectTimeout: 10000,
    };
  }

  async openSource(): Promise<void> {
    this.sClient = await createPool('sqlserver', this.cfg(this.source));
  }
  async openTarget(): Promise<void> {
    this.tClient = await createPool('sqlserver', this.cfg(this.target));
  }
  async close(): Promise<void> {
    if (this.sClient) await this.sClient.cleanup();
    if (this.tClient) await this.tClient.cleanup();
  }

  private async baseTables(client: SqlClient): Promise<BaseTable[]> {
    const rows = await client.query<Record<string, unknown>>(
      `SELECT t.TABLE_NAME AS name,
              ISNULL((SELECT SUM(p.rows) FROM sys.partitions p
                      WHERE p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
                        AND p.index_id IN (0, 1)), 0) AS [rows]
       FROM INFORMATION_SCHEMA.TABLES t
       WHERE t.TABLE_SCHEMA = @p0 AND t.TABLE_TYPE = 'BASE TABLE'
       ORDER BY t.TABLE_NAME`,
      [SCHEMA],
    );
    return rows.map((r) => ({ name: String(r['name']), rows: Number(r['rows'] ?? 0) }));
  }
  sourceBaseTables() {
    return this.baseTables(this.sClient);
  }
  targetBaseTables() {
    return this.baseTables(this.tClient);
  }

  async sourceForeignKeys() {
    const rows = await this.sClient.query<Record<string, unknown>>(
      `SELECT OBJECT_NAME(fk.parent_object_id) AS tbl, OBJECT_NAME(fk.referenced_object_id) AS ref
       FROM sys.foreign_keys fk WHERE SCHEMA_NAME(fk.schema_id) = @p0`,
      [SCHEMA],
    );
    return rows.map((r) => ({ table: String(r['tbl']), refTable: String(r['ref']) }));
  }

  private async count(client: SqlClient, table: string): Promise<number> {
    const r = await client.query<Record<string, unknown>>(
      `SELECT COUNT_BIG(*) AS c FROM ${tbl(table)}`,
    );
    return Number(r[0]?.['c'] ?? 0);
  }
  sourceCount(table: string) {
    return this.count(this.sClient, table);
  }
  targetCount(table: string) {
    return this.count(this.tClient, table);
  }

  private async primaryKey(table: string): Promise<string[]> {
    const rows = await this.sClient.query<Record<string, unknown>>(
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

  private async columns(table: string, client: SqlClient = this.sClient): Promise<ColDdl[]> {
    const rows = await client.query<Record<string, unknown>>(
      `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType,
              c.CHARACTER_MAXIMUM_LENGTH AS len, c.NUMERIC_PRECISION AS prec, c.NUMERIC_SCALE AS scale,
              c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS dflt,
              COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS isIdentity,
              COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed') AS isComputed
       FROM INFORMATION_SCHEMA.COLUMNS c
       WHERE c.TABLE_SCHEMA = @p0 AND c.TABLE_NAME = @p1
       ORDER BY c.ORDINAL_POSITION`,
      [SCHEMA, table],
    );
    return rows.map((r) => ({
      name: String(r['name']),
      dataType: String(r['dataType']),
      len: r['len'] === null || r['len'] === undefined ? null : Number(r['len']),
      prec: r['prec'] === null ? null : Number(r['prec']),
      scale: r['scale'] === null ? null : Number(r['scale']),
      nullable: String(r['nullable']).toUpperCase() === 'YES',
      identity: Number(r['isIdentity']) === 1,
      computed: Number(r['isComputed']) === 1,
      default: r['dflt'] === null || r['dflt'] === undefined ? null : String(r['dflt']),
    }));
  }

  /** Writable columns (excludes computed) + whether any is an identity column. */
  private async insertable(table: string) {
    const all = await this.columns(table);
    const writable = all.filter((c) => !c.computed);
    return {
      cols: writable.map((c) => c.name),
      hasIdentity: writable.some((c) => c.identity),
    };
  }

  private buildCreateTable(table: string, cols: ColDdl[], pk: string[]): string {
    const defs = cols
      .filter((c) => !c.computed)
      .map((c) => {
        let d = `  ${id(c.name)} ${typeString(c)}`;
        if (c.identity) d += ' IDENTITY(1,1)';
        else if (c.default !== null) d += ` DEFAULT ${c.default}`;
        d += c.nullable ? ' NULL' : ' NOT NULL';
        return d;
      });
    if (pk.length) defs.push(`  PRIMARY KEY (${pk.map(id).join(', ')})`);
    return `CREATE TABLE ${tbl(table)} (\n${defs.join(',\n')}\n)`;
  }

  /** Secondary (non-PK) indexes on the source table, columns in key order. */
  private async sourceIndexes(
    table: string,
  ): Promise<Array<{ name: string; columns: string[]; unique: boolean }>> {
    const rows = await this.sClient.query<Record<string, unknown>>(
      `SELECT i.name AS name, i.is_unique AS is_unique, c.name AS column_name, ic.key_ordinal AS ord
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
       WHERE i.object_id = OBJECT_ID(@p0) AND i.is_primary_key = 0
         AND i.name IS NOT NULL AND ic.is_included_column = 0
       ORDER BY i.name, ic.key_ordinal`,
      [`${SCHEMA}.${table}`],
    );
    const map = new Map<string, { name: string; columns: string[]; unique: boolean }>();
    for (const r of rows) {
      const name = String(r['name']);
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: r['is_unique'] === true || r['is_unique'] === 1 });
      }
      map.get(name)!.columns.push(String(r['column_name']));
    }
    return [...map.values()];
  }

  private createIndexSql(targetTable: string, ix: { name: string; columns: string[]; unique: boolean }): string {
    const cols = ix.columns.map(id).join(', ');
    return `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${id(ix.name)} ON ${tbl(targetTable)} (${cols})`;
  }

  async createTableOnTarget(table: string, targetTable: string = table): Promise<void> {
    const cols = await this.columns(table);
    const pk = await this.primaryKey(table);
    await this.tClient.query(this.buildCreateTable(targetTable, cols, pk));
    for (const ix of await this.sourceIndexes(table)) {
      await this.tClient.query(this.createIndexSql(targetTable, ix));
    }
  }

  async incrementalPredicate(targetTable: string, column: string): Promise<string | null> {
    try {
      const rows = await this.tClient.query<Record<string, unknown>>(
        `SELECT MAX(${id(column)}) AS m FROM ${tbl(targetTable)}`,
      );
      const m = rows[0]?.['m'];
      if (m === null || m === undefined) return null;
      return `${id(column)} > ${this.literal(m)}`;
    } catch {
      return null;
    }
  }

  async addColumnsToTarget(table: string, targetTable: string, columns?: string[]): Promise<string[]> {
    const want = columns ? new Set(columns) : null;
    const src = await this.columns(table);
    const existing = new Set((await this.columns(targetTable, this.tClient)).map((c) => c.name));
    const toAdd = src.filter((c) => (!want || want.has(c.name)) && !c.computed && !existing.has(c.name));
    for (const c of toAdd) {
      await this.tClient.query(`ALTER TABLE ${tbl(targetTable)} ADD ${id(c.name)} ${typeString(c)} NULL`);
    }
    return toAdd.map((c) => c.name);
  }

  async scriptAddColumns(table: string, targetTable: string, columns?: string[]): Promise<string[]> {
    const want = columns ? new Set(columns) : null;
    const src = await this.columns(table);
    const existing = new Set((await this.columns(targetTable, this.tClient)).map((c) => c.name));
    if (existing.size === 0) return []; // target table doesn't exist — nothing to alter
    return src
      .filter((c) => (!want || want.has(c.name)) && !c.computed && !existing.has(c.name))
      .map((c) => `ALTER TABLE ${tbl(targetTable)} ADD ${id(c.name)} ${typeString(c)} NULL;`);
  }

  async truncateTarget(table: string): Promise<void> {
    // DELETE (not TRUNCATE): TRUNCATE is blocked by any inbound FK reference.
    await this.tClient.query(`DELETE FROM ${tbl(table)}`);
  }

  async dropTargetTable(table: string): Promise<void> {
    await this.tClient.query(
      `IF OBJECT_ID('${SCHEMA}.${table}', 'U') IS NOT NULL DROP TABLE ${tbl(table)}`,
    );
  }

  /** Build the per-batch write statement for the conflict mode. */
  private writeStatement(
    table: string,
    cols: string[],
    pk: string[],
    conflict: Conflict,
    rowCount: number,
  ): string {
    const width = cols.length;
    const tuples = Array.from({ length: rowCount }, (_, ri) =>
      `(${cols.map((__, ci) => `@p${ri * width + ci}`).join(', ')})`,
    ).join(', ');
    const colList = cols.map(id).join(', ');

    // skip/upsert need a key to match on; without a PK they degrade to insert.
    if ((conflict === 'skip' || conflict === 'upsert') && pk.length) {
      const on = pk.map((c) => `tgt.${id(c)} = src.${id(c)}`).join(' AND ');
      const insCols = colList;
      const insVals = cols.map((c) => `src.${id(c)}`).join(', ');
      let merge =
        `MERGE ${tbl(table)} AS tgt USING (VALUES ${tuples}) AS src (${colList}) ON ${on} ` +
        `WHEN NOT MATCHED THEN INSERT (${insCols}) VALUES (${insVals})`;
      if (conflict === 'upsert') {
        const upd = cols
          .filter((c) => !pk.includes(c))
          .map((c) => `tgt.${id(c)} = src.${id(c)}`)
          .join(', ');
        if (upd) merge += ` WHEN MATCHED THEN UPDATE SET ${upd}`;
      }
      return merge + ';';
    }
    return `INSERT INTO ${tbl(table)} (${colList}) VALUES ${tuples}`;
  }

  async copyTable(
    table: string,
    conflict: Conflict,
    onProgress: (copied: number, total: number) => void,
    targetTable: string = table,
    options?: CopyOptions,
  ): Promise<number> {
    const ins = await this.insertable(table);
    const map = options?.columns;
    const readCols = map ? map.map((m) => m.source) : ins.cols;
    const writeCols = map ? map.map((m) => m.target) : ins.cols;
    const hasIdentity = map ? false : ins.hasIdentity;
    if (readCols.length === 0) return 0;
    const pk = await this.primaryKey(table);
    const total = await this.sourceCount(table);
    const colList = readCols.map(id).join(', ');
    const filter = options?.where ? `(${options.where})` : '';
    const applyTx = makeTransformApplier(options?.transforms);
    const toTuple = (r: Record<string, unknown>) => readCols.map((c) => applyTx(c, r[c]));
    // Respect the 1000-row / 2100-param statement limits.
    const perStmt = Math.max(1, Math.min(1000, Math.floor(2100 / Math.max(1, writeCols.length))));

    const copied = await this.tClient.transaction(async (tx: SqlExecutor) => {
      let n = 0;

      const flush = async (rowsData: unknown[][]) => {
        for (let i = 0; i < rowsData.length; i += perStmt) {
          const chunk = rowsData.slice(i, i + perStmt);
          const stmt = this.writeStatement(targetTable, writeCols, pk, conflict, chunk.length);
          // IDENTITY_INSERT is reset between requests, so set it in the same batch.
          const sql = hasIdentity
            ? `SET IDENTITY_INSERT ${tbl(targetTable)} ON; ${stmt}`
            : stmt;
          await tx.query(sql, chunk.flat());
        }
      };

      if (pk.length === 1 && readCols.includes(pk[0])) {
        const key = pk[0];
        let last: unknown = null;
        for (;;) {
          const sql =
            last === null
              ? `SELECT TOP (@p0) ${colList} FROM ${tbl(table)} ${filter ? `WHERE ${filter}` : ''} ORDER BY ${id(key)} ASC`
              : `SELECT TOP (@p1) ${colList} FROM ${tbl(table)} WHERE ${id(key)} > @p0${filter ? ` AND ${filter}` : ''} ORDER BY ${id(key)} ASC`;
          const params = last === null ? [BATCH] : [last, BATCH];
          const rows = await this.sClient.query<Record<string, unknown>>(sql, params);
          if (rows.length === 0) break;
          await flush(rows.map(toTuple));
          n += rows.length;
          last = rows[rows.length - 1][key];
          onProgress(n, total);
          if (rows.length < BATCH) break;
        }
      } else {
        let offset = 0;
        for (;;) {
          const rows = await this.sClient.query<Record<string, unknown>>(
            `SELECT ${colList} FROM ${tbl(table)} ${filter ? `WHERE ${filter}` : ''} ORDER BY (SELECT NULL) OFFSET @p0 ROWS FETCH NEXT @p1 ROWS ONLY`,
            [offset, BATCH],
          );
          if (rows.length === 0) break;
          await flush(rows.map(toTuple));
          n += rows.length;
          offset += rows.length;
          onProgress(n, total);
          if (rows.length < BATCH) break;
        }
      }

      return n;
    });

    // Reseed identity so future inserts don't collide with copied values.
    if (hasIdentity) {
      try {
        await this.tClient.query(`DBCC CHECKIDENT ('${SCHEMA}.${targetTable}', RESEED)`);
      } catch {
        /* best-effort */
      }
    }
    return copied;
  }

  // ── script generation ──

  scriptHeader(sourceName: string, sourceDb: string): string[] {
    return [
      '-- Migration script generated by QuerySense (SQL Server)',
      `-- Source: ${sourceName} (${sourceDb})`,
      '-- Note: foreign-key constraints and computed columns are not recreated here.',
      'SET NOCOUNT ON;',
      '',
    ];
  }
  scriptFooter(): string[] {
    return ['SET NOCOUNT OFF;'];
  }

  async scriptCreateTable(table: string, targetTable: string = table): Promise<string[]> {
    const cols = await this.columns(table);
    const pk = await this.primaryKey(table);
    const idx = (await this.sourceIndexes(table)).map((ix) => `${this.createIndexSql(targetTable, ix)};`);
    return [
      `IF OBJECT_ID('${SCHEMA}.${targetTable}', 'U') IS NOT NULL DROP TABLE ${tbl(targetTable)};`,
      `${this.buildCreateTable(targetTable, cols, pk)};`,
      ...idx,
      '',
    ];
  }

  scriptTruncate(table: string): string {
    return `DELETE FROM ${tbl(table)};`;
  }

  /** Render a JS value as a T-SQL literal. */
  private literal(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Date) return `'${v.toISOString()}'`;
    if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
    if (typeof v === 'object') return `N'${JSON.stringify(v).replace(/'/g, "''")}'`;
    return `N'${String(v).replace(/'/g, "''")}'`;
  }

  async scriptInserts(table: string, conflict: Conflict, rowCap: number, targetTable: string = table, options?: CopyOptions) {
    const ins = await this.insertable(table);
    const map = options?.columns;
    const readCols = map ? map.map((m) => m.source) : ins.cols;
    const writeCols = map ? map.map((m) => m.target) : ins.cols;
    const hasIdentity = map ? false : ins.hasIdentity;
    const lines: string[] = [];
    if (readCols.length === 0) return { lines, rows: 0, truncated: false };
    const readList = readCols.map(id).join(', ');
    const writeList = writeCols.map(id).join(', ');
    const filter = options?.where ? `WHERE (${options.where})` : '';
    const applyTx = makeTransformApplier(options?.transforms);
    if (hasIdentity) lines.push(`SET IDENTITY_INSERT ${tbl(targetTable)} ON;`);

    let offset = 0;
    let rows = 0;
    let truncated = false;
    for (;;) {
      if (rows >= rowCap) {
        truncated = true;
        lines.push(`-- NOTE: ${tbl(table)} truncated at ${rowCap} rows in this script. Use direct copy for the full table.`);
        break;
      }
      const data = await this.sClient.query<Record<string, unknown>>(
        `SELECT ${readList} FROM ${tbl(table)} ${filter} ORDER BY (SELECT NULL) OFFSET @p0 ROWS FETCH NEXT @p1 ROWS ONLY`,
        [offset, BATCH],
      );
      if (data.length === 0) break;
      const tuples = data
        .map((r) => `(${readCols.map((c) => this.literal(applyTx(c, r[c]))).join(', ')})`)
        .join(',\n  ');
      lines.push(`INSERT INTO ${tbl(targetTable)} (${writeList}) VALUES\n  ${tuples};`);
      rows += data.length;
      offset += data.length;
      if (data.length < BATCH) break;
    }
    if (hasIdentity) lines.push(`SET IDENTITY_INSERT ${tbl(targetTable)} OFF;`);
    lines.push('');
    return { lines, rows, truncated };
  }
}
