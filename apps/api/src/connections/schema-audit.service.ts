import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { createMysqlPool, buildSshConfig } from '../common/db/mysql-pool';
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

    const tables = await this.introspect(connection);

    const findings: AuditFinding[] = [];
    for (const rule of this.RULES) findings.push(...rule(tables));

    // AI advisor — best-effort, adds higher-level suggestions.
    try {
      const advice = await this.ai.reviewSchema(this.schemaSummary(tables));
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
      host: string;
      port: number;
      databaseName: string;
      username: string;
      encryptedPassword: string;
      sslEnabled: boolean;
    } & Parameters<typeof buildSshConfig>[0],
  ): Promise<TableModel[]> {
    const { pool, cleanup } = await createMysqlPool({
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
    const db = connection.databaseName;

    try {
      const [tableRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME, ENGINE, TABLE_ROWS, TABLE_COLLATION, TABLE_TYPE
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
        [db],
      );
      const [colRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE,
                COLUMN_KEY, EXTRA, COLLATION_NAME, ORDINAL_POSITION
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [db],
      );
      const [idxRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [db],
      );
      const [fkRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [db],
      );

      const tables = new Map<string, TableModel>();
      for (const r of tableRows as Record<string, unknown>[]) {
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

      for (const r of colRows as Record<string, unknown>[]) {
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
      for (const r of idxRows as Record<string, unknown>[]) {
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

      for (const r of fkRows as Record<string, unknown>[]) {
        const t = tables.get(String(r['TABLE_NAME']));
        if (t) t.fkColumns.add(String(r['COLUMN_NAME']));
      }

      return [...tables.values()];
    } finally {
      await cleanup();
    }
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

  private readonly RULES: Array<(tables: TableModel[]) => AuditFinding[]> = [
    // No primary key
    (tables) =>
      tables
        .filter((t) => !t.isView && t.pk.length === 0)
        .map((t) => ({
          id: `no_pk:${t.name}`,
          severity: 'high' as Severity,
          category: 'Structure',
          title: 'Table has no primary key',
          table: t.name,
          detail: `"${t.name}" has no primary key. PKs are required for replication, reliable updates and InnoDB clustering.`,
          recommendation: 'Add a primary key (e.g. an AUTO_INCREMENT id).',
          fixSql: `ALTER TABLE \`${t.name}\` ADD COLUMN \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;`,
        })),

    // Implicit FK: *_id column referencing an existing table, but no FK constraint
    (tables) => {
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
              fixSql: `ALTER TABLE \`${t.name}\` ADD CONSTRAINT \`fk_${t.name}_${c.name}\` FOREIGN KEY (\`${c.name}\`) REFERENCES \`${target}\`(\`id\`);`,
            });
          }
        }
      }
      return out;
    },

    // *_id columns not indexed (slow joins/filters)
    (tables) => {
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
              fixSql: `CREATE INDEX \`idx_${t.name}_${c.name}\` ON \`${t.name}\`(\`${c.name}\`);`,
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
    (tables) =>
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
          fixSql: `ALTER TABLE \`${t.name}\`\n  ADD COLUMN \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  ADD COLUMN \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`,
        })),

    // Money stored as float/double
    (tables) => {
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
              fixSql: `ALTER TABLE \`${t.name}\` MODIFY \`${c.name}\` DECIMAL(12,2);`,
            });
          }
        }
      }
      return out;
    },

    // Boolean-ish column stored as string
    (tables) => {
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
              recommendation: 'Use TINYINT(1)/BOOLEAN for flags.',
              fixSql: `ALTER TABLE \`${t.name}\` MODIFY \`${c.name}\` TINYINT(1) NOT NULL DEFAULT 0;`,
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

    // Non-InnoDB engine
    (tables) =>
      tables
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
        })),

    // Non-utf8mb4 collation
    (tables) =>
      tables
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
        })),

    // INT auto-increment PK overflow risk
    (tables) => {
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
            fixSql: `ALTER TABLE \`${t.name}\` MODIFY \`${idCol.name}\` BIGINT NOT NULL AUTO_INCREMENT;`,
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
    (tables) => {
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
              fixSql: `CREATE UNIQUE INDEX \`uq_${t.name}_${c.name}\` ON \`${t.name}\`(\`${c.name}\`);`,
            });
          }
        }
      }
      return out;
    },
  ];
}
