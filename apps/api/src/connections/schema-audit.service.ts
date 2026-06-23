import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import {
  createPool,
  type SqlClient,
  buildSshConfig,
} from '../common/db/mysql-pool';
import { DbEngine, normalizeEngine } from '../common/db/engine';
import { AuditDialect, auditDialect } from './audit-dialect';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';

type Severity = 'high' | 'medium' | 'low' | 'info';

export interface AuditFinding {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  table?: string;
  column?: string;
  detail: string;
  recommendation: string;
  fixSql?: string;
  aiGenerated?: boolean;
}

export interface AuditReport {
  score: number;
  generatedAt: string;
  summary: {
    tables: number;
    columns: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: AuditFinding[];
}

interface ColModel {
  name: string;
  columnType: string;
  dataType: string;
  isNullable: boolean;
  columnKey: string;
  extra: string;
  collation: string | null;
}

interface IndexModel {
  name: string;
  columns: string[];
  unique: boolean;
}

interface TableModel {
  name: string;
  engine: string | null;
  collation: string | null;
  rowCount: number;
  isView: boolean;
  columns: ColModel[];
  indexes: IndexModel[];
  pk: string[];
  fkColumns: Set<string>;
}

const PENALTY: Record<Severity, number> = { high: 12, medium: 5, low: 2, info: 0 };

@Injectable()
export class SchemaAuditService {
  private readonly logger = new Logger(SchemaAuditService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private ai: AiOrchestratorService,
  ) {}

  async audit(connectionId: string, workspaceId: string): Promise<AuditReport> {
    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException('Connection not found');

    const engine = normalizeEngine(connection.engine);
    const dialect = auditDialect(engine);
    const tables = await this.introspect(connection, engine);

    const findings: AuditFinding[] = [];
    for (const rule of this.RULES) findings.push(...rule(tables, dialect));

    // AI advisor — best-effort, adds higher-level suggestions.
    try {
      const advice = await this.ai.reviewSchema(this.schemaSummary(tables), engine);
      advice.forEach((a, i) =>
        findings.push({
          id: `ai:${i}`,
          severity: a.severity,
          category: a.category || 'Design',
          title: a.title,
          table: a.table ?? undefined,
          detail: a.recommendation,
          recommendation: a.recommendation,
          aiGenerated: true,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `AI schema review failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    const summary = {
      tables: tables.filter((t) => !t.isView).length,
      columns: tables.reduce((s, t) => s + t.columns.length, 0),
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };
    const penalty = findings.reduce((s, f) => s + PENALTY[f.severity], 0);
    const score = Math.max(0, Math.min(100, 100 - penalty));

    const order: Severity[] = ['high', 'medium', 'low', 'info'];
    findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

    return {
      score,
      generatedAt: new Date().toISOString(),
      summary,
      findings,
    };
  }

  // ─── Live introspection ──────────────────────────────────

  private async introspect(
    connection: {
      engine: string;
      host: string;
      port: number;
      databaseName: string;
      username: string;
      encryptedPassword: string;
      sslEnabled: boolean;
    } & Parameters<typeof buildSshConfig>[0],
    engine: DbEngine,
  ): Promise<TableModel[]> {
    const client = await createPool(engine, {
      host: connection.host,
      port: connection.port,
      database: connection.databaseName,
      user: connection.username,
      password: this.encryption.decrypt(connection.encryptedPassword),
      ssl: connection.sslEnabled,
      ssh: buildSshConfig(connection, (s) => this.encryption.decrypt(s)),
      connectionLimit: 3,
      connectTimeout: 10000,
    });

    try {
      if (engine === 'postgres') return await this.introspectPostgres(client);
      if (engine === 'sqlserver') return await this.introspectSqlServer(client);
      return await this.introspectMysql(client, connection.databaseName);
    } finally {
      await client.cleanup();
    }
  }

  private async introspectMysql(
    client: SqlClient,
    db: string,
  ): Promise<TableModel[]> {
    const tableRows = await client.query<Record<string, unknown>>(
      `SELECT TABLE_NAME, ENGINE, TABLE_ROWS, TABLE_COLLATION, TABLE_TYPE
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [db],
    );
    const colRows = await client.query<Record<string, unknown>>(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE,
              COLUMN_KEY, EXTRA, COLLATION_NAME, ORDINAL_POSITION
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [db],
    );
    const idxRows = await client.query<Record<string, unknown>>(
      `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [db],
    );
    const fkRows = await client.query<Record<string, unknown>>(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [db],
    );

    const tables = new Map<string, TableModel>();
    for (const r of tableRows) {
      const name = String(r['TABLE_NAME']);
      tables.set(name, {
        name,
        engine: r['ENGINE'] ? String(r['ENGINE']) : null,
        collation: r['TABLE_COLLATION'] ? String(r['TABLE_COLLATION']) : null,
        rowCount: Number(r['TABLE_ROWS'] ?? 0),
        isView: String(r['TABLE_TYPE']) === 'VIEW',
        columns: [],
        indexes: [],
        pk: [],
        fkColumns: new Set(),
      });
    }

    for (const r of colRows) {
      const t = tables.get(String(r['TABLE_NAME']));
      if (!t) continue;
      const col: ColModel = {
        name: String(r['COLUMN_NAME']),
        columnType: String(r['COLUMN_TYPE']),
        dataType: String(r['DATA_TYPE']).toLowerCase(),
        isNullable: String(r['IS_NULLABLE']).toUpperCase() === 'YES',
        columnKey: String(r['COLUMN_KEY'] ?? ''),
        extra: String(r['EXTRA'] ?? '').toLowerCase(),
        collation: r['COLLATION_NAME'] ? String(r['COLLATION_NAME']) : null,
      };
      t.columns.push(col);
      if (col.columnKey === 'PRI') t.pk.push(col.name);
    }

    const idxByTable = new Map<string, Map<string, IndexModel>>();
    for (const r of idxRows) {
      const tableName = String(r['TABLE_NAME']);
      if (!tables.has(tableName)) continue;
      const idxName = String(r['INDEX_NAME']);
      let byName = idxByTable.get(tableName);
      if (!byName) {
        byName = new Map();
        idxByTable.set(tableName, byName);
      }
      let idx = byName.get(idxName);
      if (!idx) {
        idx = { name: idxName, columns: [], unique: Number(r['NON_UNIQUE']) === 0 };
        byName.set(idxName, idx);
      }
      idx.columns.push(String(r['COLUMN_NAME']));
    }
    for (const [tableName, byName] of idxByTable) {
      const t = tables.get(tableName);
      if (t) t.indexes = [...byName.values()];
    }

    for (const r of fkRows) {
      const t = tables.get(String(r['TABLE_NAME']));
      if (t) t.fkColumns.add(String(r['COLUMN_NAME']));
    }

    return [...tables.values()];
  }

  /**
   * Postgres equivalent of introspectMysql. Scoped to the `public` schema.
   * `engine`/`collation` are left null (no MySQL storage-engine/charset notion),
   * which naturally disables those MySQL-only rules. Postgres types are mapped to
   * the MySQL-ish tokens the deterministic rules expect (e.g. integer -> int,
   * double precision -> double, character varying -> varchar), and identity /
   * serial columns are marked extra='auto_increment' so the PK rules still fire.
   */
  private async introspectPostgres(client: SqlClient): Promise<TableModel[]> {
    const schema = 'public';
    const tableRows = await client.query<Record<string, unknown>>(
      `SELECT t.table_name AS "tableName",
              COALESCE(st.n_live_tup, 0) AS "rowCount",
              t.table_type AS "tableType"
       FROM information_schema.tables t
       LEFT JOIN pg_stat_user_tables st
         ON st.relname = t.table_name AND st.schemaname = t.table_schema
       WHERE t.table_schema = $1`,
      [schema],
    );
    const colRows = await client.query<Record<string, unknown>>(
      `SELECT c.table_name AS "tableName",
              c.column_name AS "columnName",
              c.data_type AS "dataType",
              c.is_nullable AS "isNullable",
              c.character_maximum_length AS "charLen",
              c.numeric_precision AS "numPrec",
              c.numeric_scale AS "numScale",
              c.is_identity AS "isIdentity",
              c.column_default AS "columnDefault"
       FROM information_schema.columns c
       WHERE c.table_schema = $1
       ORDER BY c.table_name, c.ordinal_position`,
      [schema],
    );
    const pkRows = await client.query<Record<string, unknown>>(
      `SELECT kcu.table_name AS "tableName", kcu.column_name AS "columnName"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1`,
      [schema],
    );
    const fkRows = await client.query<Record<string, unknown>>(
      `SELECT kcu.table_name AS "tableName", kcu.column_name AS "columnName"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [schema],
    );
    const idxRows = await client.query<Record<string, unknown>>(
      `SELECT t.relname AS "tableName",
              i.relname AS "indexName",
              ix.indisunique AS "isUnique",
              a.attname AS "columnName",
              k.ord AS "seq"
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE n.nspname = $1 AND t.relkind IN ('r', 'p')
       ORDER BY t.relname, i.relname, k.ord`,
      [schema],
    );

    const pkSet = new Set(
      pkRows.map((r) => `${String(r['tableName'])}.${String(r['columnName'])}`),
    );

    const tables = new Map<string, TableModel>();
    for (const r of tableRows) {
      const name = String(r['tableName']);
      tables.set(name, {
        name,
        engine: null,
        collation: null,
        rowCount: Number(r['rowCount'] ?? 0),
        isView: String(r['tableType']) === 'VIEW',
        columns: [],
        indexes: [],
        pk: [],
        fkColumns: new Set(),
      });
    }

    for (const r of colRows) {
      const t = tables.get(String(r['tableName']));
      if (!t) continue;
      const name = String(r['columnName']);
      const dataType = this.mapPgType(String(r['dataType']));
      const isPk = pkSet.has(`${t.name}.${name}`);
      const isIdentity =
        String(r['isIdentity'] ?? '').toUpperCase() === 'YES' ||
        /nextval\(/i.test(String(r['columnDefault'] ?? ''));
      const col: ColModel = {
        name,
        columnType: this.pgColumnType(dataType, r),
        dataType,
        isNullable: String(r['isNullable']).toUpperCase() === 'YES',
        columnKey: isPk ? 'PRI' : '',
        extra: isIdentity ? 'auto_increment' : '',
        collation: null,
      };
      t.columns.push(col);
      if (isPk) t.pk.push(name);
    }

    const idxByTable = new Map<string, Map<string, IndexModel>>();
    for (const r of idxRows) {
      const tableName = String(r['tableName']);
      if (!tables.has(tableName)) continue;
      const idxName = String(r['indexName']);
      let byName = idxByTable.get(tableName);
      if (!byName) {
        byName = new Map();
        idxByTable.set(tableName, byName);
      }
      let idx = byName.get(idxName);
      if (!idx) {
        idx = { name: idxName, columns: [], unique: r['isUnique'] === true };
        byName.set(idxName, idx);
      }
      idx.columns.push(String(r['columnName']));
    }
    for (const [tableName, byName] of idxByTable) {
      const t = tables.get(tableName);
      if (t) t.indexes = [...byName.values()];
    }

    for (const r of fkRows) {
      const t = tables.get(String(r['tableName']));
      if (t) t.fkColumns.add(String(r['columnName']));
    }

    return [...tables.values()];
  }

  /**
   * SQL Server equivalent of introspectMysql. Scoped to the `dbo` schema.
   * engine/collation left null (disables the MySQL-only rules); types mapped to
   * the MySQL-ish tokens the rules expect; IDENTITY columns marked auto_increment.
   */
  private async introspectSqlServer(client: SqlClient): Promise<TableModel[]> {
    const schema = 'dbo';
    const tableRows = await client.query<Record<string, unknown>>(
      `SELECT t.TABLE_NAME AS name,
              t.TABLE_TYPE AS tableType,
              ISNULL((SELECT SUM(p.rows) FROM sys.partitions p
                      WHERE p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
                        AND p.index_id IN (0, 1)), 0) AS [rowCount]
       FROM INFORMATION_SCHEMA.TABLES t WHERE t.TABLE_SCHEMA = @p0`,
      [schema],
    );
    const colRows = await client.query<Record<string, unknown>>(
      `SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName,
              c.DATA_TYPE AS dataType, c.CHARACTER_MAXIMUM_LENGTH AS charLen,
              c.NUMERIC_PRECISION AS numPrec, c.NUMERIC_SCALE AS numScale,
              c.IS_NULLABLE AS isNullable,
              COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS isIdentity
       FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = @p0
       ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
      [schema],
    );
    const pkRows = await client.query<Record<string, unknown>>(
      `SELECT ku.TABLE_NAME AS tableName, ku.COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
         ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @p0`,
      [schema],
    );
    const fkRows = await client.query<Record<string, unknown>>(
      `SELECT OBJECT_NAME(fk.parent_object_id) AS tableName, pc.name AS columnName
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       WHERE SCHEMA_NAME(fk.schema_id) = @p0`,
      [schema],
    );
    const idxRows = await client.query<Record<string, unknown>>(
      `SELECT t.name AS tableName, i.name AS indexName, i.is_unique AS isUnique,
              c.name AS columnName, ic.key_ordinal AS seq
       FROM sys.indexes i
       JOIN sys.tables t ON t.object_id = i.object_id
       JOIN sys.schemas s ON s.schema_id = t.schema_id
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE s.name = @p0 AND i.type > 0
       ORDER BY t.name, i.name, ic.key_ordinal`,
      [schema],
    );

    const pkSet = new Set(
      pkRows.map((r) => `${String(r['tableName'])}.${String(r['columnName'])}`),
    );

    const tables = new Map<string, TableModel>();
    for (const r of tableRows) {
      const name = String(r['name']);
      tables.set(name, {
        name,
        engine: null,
        collation: null,
        rowCount: Number(r['rowCount'] ?? 0),
        isView: String(r['tableType']) === 'VIEW',
        columns: [],
        indexes: [],
        pk: [],
        fkColumns: new Set(),
      });
    }

    for (const r of colRows) {
      const t = tables.get(String(r['tableName']));
      if (!t) continue;
      const name = String(r['columnName']);
      const dataType = this.mapMssqlType(String(r['dataType']));
      const isPk = pkSet.has(`${t.name}.${name}`);
      const charLen = r['charLen'];
      const columnType =
        charLen !== null && charLen !== undefined && Number(charLen) > 0
          ? `${dataType}(${Number(charLen)})`
          : dataType === 'decimal' && r['numPrec'] != null
            ? `${dataType}(${Number(r['numPrec'])},${Number(r['numScale'] ?? 0)})`
            : dataType;
      const col: ColModel = {
        name,
        columnType,
        dataType,
        isNullable: String(r['isNullable']).toUpperCase() === 'YES',
        columnKey: isPk ? 'PRI' : '',
        extra: Number(r['isIdentity']) === 1 ? 'auto_increment' : '',
        collation: null,
      };
      t.columns.push(col);
      if (isPk) t.pk.push(name);
    }

    const idxByTable = new Map<string, Map<string, IndexModel>>();
    for (const r of idxRows) {
      const tableName = String(r['tableName']);
      if (!tables.has(tableName)) continue;
      const idxName = String(r['indexName']);
      let byName = idxByTable.get(tableName);
      if (!byName) {
        byName = new Map();
        idxByTable.set(tableName, byName);
      }
      let idx = byName.get(idxName);
      if (!idx) {
        idx = { name: idxName, columns: [], unique: r['isUnique'] === true };
        byName.set(idxName, idx);
      }
      idx.columns.push(String(r['columnName']));
    }
    for (const [tableName, byName] of idxByTable) {
      const t = tables.get(tableName);
      if (t) t.indexes = [...byName.values()];
    }

    for (const r of fkRows) {
      const t = tables.get(String(r['tableName']));
      if (t) t.fkColumns.add(String(r['columnName']));
    }

    return [...tables.values()];
  }

  /** Map a SQL Server data type to the MySQL-ish token the rules check against. */
  private mapMssqlType(t: string): string {
    const v = t.toLowerCase();
    if (v === 'float') return 'double';
    if (v === 'real') return 'float';
    if (v === 'numeric' || v === 'money' || v === 'smallmoney') return 'decimal';
    if (v === 'nvarchar' || v === 'varchar') return 'varchar';
    if (v === 'nchar' || v === 'char') return 'char';
    if (v === 'ntext') return 'text';
    if (v === 'bit') return 'boolean';
    return v; // int, bigint, smallint, decimal, text, datetime2, date, etc.
  }

  /** Map a Postgres data_type to the MySQL-ish token the rules check against. */
  private mapPgType(pg: string): string {
    const t = pg.toLowerCase();
    if (t === 'integer') return 'int';
    if (t === 'double precision') return 'double';
    if (t === 'real') return 'float';
    if (t === 'numeric' || t === 'decimal') return 'decimal';
    if (t === 'character varying') return 'varchar';
    if (t === 'character') return 'char';
    return t; // bigint, smallint, text, boolean, timestamp, date, etc. pass through
  }

  /** Reconstruct a MySQL-style columnType string (e.g. varchar(255)) for pg. */
  private pgColumnType(dataType: string, r: Record<string, unknown>): string {
    const charLen = r['charLen'];
    if (charLen !== null && charLen !== undefined) {
      return `${dataType}(${Number(charLen)})`;
    }
    if (dataType === 'decimal' && r['numPrec'] != null) {
      return `${dataType}(${Number(r['numPrec'])},${Number(r['numScale'] ?? 0)})`;
    }
    return dataType;
  }

  private schemaSummary(tables: TableModel[]): string {
    return tables
      .filter((t) => !t.isView)
      .map((t) => {
        const cols = t.columns
          .map((c) => {
            const flags = [
              c.columnKey === 'PRI' ? 'PK' : '',
              t.fkColumns.has(c.name) ? 'FK' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return `${c.name} ${c.columnType}${flags ? ' ' + flags : ''}`;
          })
          .join(', ');
        return `${t.name}(${cols})`;
      })
      .join('\n');
  }

  // ─── Deterministic rules ─────────────────────────────────

  private indexedFirst(t: TableModel, column: string): boolean {
    return t.indexes.some((i) => i.columns[0] === column);
  }

  private readonly RULES: Array<
    (tables: TableModel[], d: AuditDialect) => AuditFinding[]
  > = [
    // No primary key
    (tables, d) =>
      tables
        .filter((t) => !t.isView && t.pk.length === 0)
        .map((t) => ({
          id: `no_pk:${t.name}`,
          severity: 'high' as Severity,
          category: 'Structure',
          title: 'Table has no primary key',
          table: t.name,
          detail: `"${t.name}" has no primary key. PKs are required for replication, reliable updates and efficient clustering.`,
          recommendation: 'Add a primary key (e.g. an auto-incrementing id).',
          fixSql: d.addIdPk(t.name),
        })),

    // Implicit FK: *_id column referencing an existing table, but no FK constraint
    (tables, d) => {
      const names = new Set(tables.map((t) => t.name.toLowerCase()));
      const out: AuditFinding[] = [];
      for (const t of tables) {
        if (t.isView) continue;
        for (const c of t.columns) {
          const m = c.name.toLowerCase().match(/^(.*)_id$/);
          if (!m || t.fkColumns.has(c.name) || c.columnKey === 'PRI') continue;
          const base = m[1];
          const target = [base, `${base}s`, `${base}es`].find((n) => names.has(n));
          if (target) {
            out.push({
              id: `implicit_fk:${t.name}:${c.name}`,
              severity: 'medium',
              category: 'Integrity',
              title: 'Missing foreign-key constraint',
              table: t.name,
              column: c.name,
              detail: `"${t.name}.${c.name}" looks like it references "${target}" but has no FK constraint, so referential integrity isn't enforced.`,
              recommendation: `Add a foreign key from ${t.name}.${c.name} to ${target}.`,
              fixSql: d.addForeignKey(t.name, c.name, target),
            });
          }
        }
      }
      return out;
    },

    // *_id columns not indexed (slow joins/filters)
    (tables, d) => {
      const out: AuditFinding[] = [];
      for (const t of tables) {
        if (t.isView) continue;
        for (const c of t.columns) {
          if (!/_id$/i.test(c.name) || c.columnKey === 'PRI') continue;
          if (!this.indexedFirst(t, c.name)) {
            out.push({
              id: `unindexed_id:${t.name}:${c.name}`,
              severity: 'medium',
              category: 'Indexing',
              title: 'Likely lookup column is not indexed',
              table: t.name,
              column: c.name,
              detail: `"${t.name}.${c.name}" is commonly used for joins/filters but has no index — this causes full table scans.`,
              recommendation: `Add an index on ${t.name}.${c.name}.`,
              fixSql: d.createIndex(t.name, c.name),
            });
          }
        }
      }
      return out;
    },

    // Nullable foreign keys
    (tables) => {
      const out: AuditFinding[] = [];
      for (const t of tables) {
        for (const c of t.columns) {
          if (t.fkColumns.has(c.name) && c.isNullable) {
            out.push({
              id: `nullable_fk:${t.name}:${c.name}`,
              severity: 'low',
              category: 'Integrity',
              title: 'Nullable foreign key',
              table: t.name,
              column: c.name,
              detail: `FK "${t.name}.${c.name}" is nullable, which can hide orphaned/optional relationships.`,
              recommendation:
                'If the relationship is required, make it NOT NULL; otherwise confirm NULL is intentional.',
            });
          }
        }
      }
      return out;
    },

    // Missing audit timestamps
    (tables, d) =>
      tables
        .filter((t) => !t.isView)
        .filter((t) => {
          const cols = new Set(t.columns.map((c) => c.name.toLowerCase()));
          const hasCreated = ['created_at', 'created', 'createdat'].some((n) => cols.has(n));
          const hasUpdated = ['updated_at', 'updated', 'updatedat'].some((n) => cols.has(n));
          return !hasCreated || !hasUpdated;
        })
        .map((t) => ({
          id: `no_timestamps:${t.name}`,
          severity: 'low' as Severity,
          category: 'Structure',
          title: 'Missing audit timestamps',
          table: t.name,
          detail: `"${t.name}" is missing created_at/updated_at columns, making it hard to audit changes.`,
          recommendation: 'Add created_at and updated_at TIMESTAMP columns.',
          fixSql: d.addTimestamps(t.name),
        })),

    // Money stored as float/double
    (tables, d) => {
      const out: AuditFinding[] = [];
      const money = /(price|amount|cost|total|balance|salary|fee|payment|revenue|subtotal)/i;
      for (const t of tables) {
        for (const c of t.columns) {
          if (money.test(c.name) && (c.dataType === 'float' || c.dataType === 'double')) {
            out.push({
              id: `money_float:${t.name}:${c.name}`,
              severity: 'medium',
              category: 'Data Types',
              title: 'Monetary value stored as float',
              table: t.name,
              column: c.name,
              detail: `"${t.name}.${c.name}" stores money as ${c.dataType.toUpperCase()}, which is lossy and causes rounding errors.`,
              recommendation: 'Use DECIMAL(precision, scale) for money.',
              fixSql: d.setColumnDecimal(t.name, c.name),
            });
          }
        }
      }
      return out;
    },

    // Boolean-ish column stored as string
    (tables, d) => {
      const out: AuditFinding[] = [];
      for (const t of tables) {
        for (const c of t.columns) {
          if (/^(is_|has_|can_|should_)/i.test(c.name) && ['varchar', 'char', 'text'].includes(c.dataType)) {
            out.push({
              id: `bool_string:${t.name}:${c.name}`,
              severity: 'low',
              category: 'Data Types',
              title: 'Boolean flag stored as string',
              table: t.name,
              column: c.name,
              detail: `"${t.name}.${c.name}" looks boolean but is ${c.dataType.toUpperCase()}.`,
              recommendation: `Use ${d.booleanTypeLabel} for flags.`,
              fixSql: d.setColumnBoolean(t.name, c.name),
            });
          }
        }
      }
      return out;
    },

    // Inconsistent table naming
    (tables) => {
      const base = tables.filter((t) => !t.isView);
      const snake = (n: string) => /^[a-z][a-z0-9_]*$/.test(n);
      const snakeCount = base.filter((t) => snake(t.name)).length;
      // Only flag if the majority are snake_case (a clear house style).
      if (snakeCount < base.length * 0.6) return [];
      return base
        .filter((t) => !snake(t.name) && !t.name.startsWith('_'))
        .map((t) => ({
          id: `naming:${t.name}`,
          severity: 'medium' as Severity,
          category: 'Naming',
          title: 'Inconsistent table naming',
          table: t.name,
          detail: `"${t.name}" breaks the snake_case convention used by most tables (e.g. uppercase letters).`,
          recommendation: `Rename to snake_case (e.g. ${t.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/_+/g, '_').toLowerCase()}).`,
        }));
    },

    // Non-InnoDB engine (MySQL only)
    (tables, d) => {
      if (!d.hasStorageEngines) return [];
      return tables
        .filter((t) => !t.isView && t.engine && t.engine.toLowerCase() !== 'innodb')
        .map((t) => ({
          id: `engine:${t.name}`,
          severity: 'medium' as Severity,
          category: 'Storage',
          title: `Non-InnoDB engine (${t.engine})`,
          table: t.name,
          detail: `"${t.name}" uses ${t.engine}, which lacks transactions and foreign keys.`,
          recommendation: 'Convert to InnoDB.',
          fixSql: `ALTER TABLE \`${t.name}\` ENGINE=InnoDB;`,
        }));
    },

    // Non-utf8mb4 collation (MySQL only)
    (tables, d) => {
      if (!d.hasCharsets) return [];
      return tables
        .filter((t) => !t.isView && t.collation && !t.collation.startsWith('utf8mb4'))
        .map((t) => ({
          id: `charset:${t.name}`,
          severity: 'low' as Severity,
          category: 'Storage',
          title: 'Table is not utf8mb4',
          table: t.name,
          detail: `"${t.name}" uses ${t.collation}; non-utf8mb4 can't store emoji/4-byte unicode and may corrupt data.`,
          recommendation: 'Convert the table to utf8mb4.',
          fixSql: `ALTER TABLE \`${t.name}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
        }));
    },

    // INT auto-increment PK overflow risk
    (tables, d) => {
      const out: AuditFinding[] = [];
      for (const t of tables) {
        if (t.isView) continue;
        const idCol = t.columns.find(
          (c) => c.columnKey === 'PRI' && c.extra.includes('auto_increment'),
        );
        if (idCol && idCol.dataType === 'int') {
          const large = t.rowCount > 500_000;
          out.push({
            id: `int_pk:${t.name}`,
            severity: large ? 'medium' : 'low',
            category: 'Scalability',
            title: 'INT auto-increment primary key',
            table: t.name,
            column: idCol.name,
            detail: `"${t.name}.${idCol.name}" is a signed INT (max ~2.1B)${large ? ` and the table already has ~${t.rowCount.toLocaleString()} rows` : ''}.`,
            recommendation: 'Use BIGINT for primary keys to avoid future overflow.',
            fixSql: d.widenPkToBigint(t.name, idCol.name),
          });
        }
      }
      return out;
    },

    // Possible plaintext password
    (tables) => {
      const out: AuditFinding[] = [];
      for (const t of tables) {
        for (const c of t.columns) {
          if (/(password|passwd|pwd)/i.test(c.name) && /(varchar|char|text)/.test(c.dataType)) {
            const lenMatch = c.columnType.match(/\((\d+)\)/);
            const len = lenMatch ? Number(lenMatch[1]) : 999;
            if (len < 60) {
              out.push({
                id: `plaintext_pw:${t.name}:${c.name}`,
                severity: 'high',
                category: 'Security',
                title: 'Password column may store plaintext',
                table: t.name,
                column: c.name,
                detail: `"${t.name}.${c.name}" is ${c.columnType} — too short for a modern hash, suggesting plaintext or weak hashing.`,
                recommendation: 'Store a strong one-way hash (bcrypt/argon2); widen the column to ≥60 chars.',
              });
            }
          }
        }
      }
      return out;
    },

    // Sensitive data likely needing encryption
    (tables) => {
      const out: AuditFinding[] = [];
      const sensitive = /(ssn|social_security|card_number|cardnumber|cvv|api_key|apikey|secret|access_token)/i;
      for (const t of tables) {
        for (const c of t.columns) {
          if (sensitive.test(c.name)) {
            out.push({
              id: `sensitive:${t.name}:${c.name}`,
              severity: 'medium',
              category: 'Security',
              title: 'Sensitive column may be unprotected',
              table: t.name,
              column: c.name,
              detail: `"${t.name}.${c.name}" likely holds sensitive data. Confirm it is encrypted/tokenised at rest.`,
              recommendation: 'Encrypt or tokenise sensitive values; avoid storing raw card/SSN data.',
            });
          }
        }
      }
      return out;
    },

    // Natural key without a unique index
    (tables, d) => {
      const out: AuditFinding[] = [];
      const natural = new Set(['email', 'username', 'slug', 'sku', 'code']);
      for (const t of tables) {
        if (t.isView) continue;
        for (const c of t.columns) {
          if (!natural.has(c.name.toLowerCase())) continue;
          const hasUnique = t.indexes.some(
            (i) => i.unique && i.columns.length === 1 && i.columns[0] === c.name,
          );
          if (!hasUnique) {
            out.push({
              id: `unique_key:${t.name}:${c.name}`,
              severity: 'low',
              category: 'Integrity',
              title: 'Natural key without a unique constraint',
              table: t.name,
              column: c.name,
              detail: `"${t.name}.${c.name}" should usually be unique but has no unique index, allowing duplicates.`,
              recommendation: `Add a unique index on ${t.name}.${c.name}.`,
              fixSql: d.createUniqueIndex(t.name, c.name),
            });
          }
        }
      }
      return out;
    },
  ];
}
