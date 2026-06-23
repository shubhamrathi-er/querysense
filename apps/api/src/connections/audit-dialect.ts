import { DbEngine, quoteIdent } from '../common/db/engine';

/**
 * Per-engine fix-SQL templates and capability flags for the schema auditor.
 * Keeps the deterministic rules in schema-audit.service.ts dialect-agnostic:
 * they call these builders instead of hand-writing backtick MySQL DDL.
 */
export interface AuditDialect {
  readonly engine: DbEngine;
  q(name: string): string;
  addIdPk(table: string): string;
  addForeignKey(table: string, col: string, refTable: string): string;
  createIndex(table: string, col: string): string;
  createUniqueIndex(table: string, col: string): string;
  addTimestamps(table: string): string;
  setColumnDecimal(table: string, col: string): string;
  setColumnBoolean(table: string, col: string): string;
  widenPkToBigint(table: string, col: string): string;
  /** Label used in the boolean-as-string recommendation text. */
  readonly booleanTypeLabel: string;
  /** Storage-engine (InnoDB) rule only applies to MySQL. */
  readonly hasStorageEngines: boolean;
  /** Per-table charset/collation rule only applies to MySQL. */
  readonly hasCharsets: boolean;
}

const mysqlDialect: AuditDialect = {
  engine: 'mysql',
  q: (n) => quoteIdent('mysql', n),
  addIdPk: (t) =>
    `ALTER TABLE ${quoteIdent('mysql', t)} ADD COLUMN \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;`,
  addForeignKey: (t, c, ref) =>
    `ALTER TABLE ${quoteIdent('mysql', t)} ADD CONSTRAINT \`fk_${t}_${c}\` FOREIGN KEY (${quoteIdent('mysql', c)}) REFERENCES ${quoteIdent('mysql', ref)}(\`id\`);`,
  createIndex: (t, c) =>
    `CREATE INDEX \`idx_${t}_${c}\` ON ${quoteIdent('mysql', t)}(${quoteIdent('mysql', c)});`,
  createUniqueIndex: (t, c) =>
    `CREATE UNIQUE INDEX \`uq_${t}_${c}\` ON ${quoteIdent('mysql', t)}(${quoteIdent('mysql', c)});`,
  addTimestamps: (t) =>
    `ALTER TABLE ${quoteIdent('mysql', t)}\n  ADD COLUMN \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  ADD COLUMN \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`,
  setColumnDecimal: (t, c) =>
    `ALTER TABLE ${quoteIdent('mysql', t)} MODIFY ${quoteIdent('mysql', c)} DECIMAL(12,2);`,
  setColumnBoolean: (t, c) =>
    `ALTER TABLE ${quoteIdent('mysql', t)} MODIFY ${quoteIdent('mysql', c)} TINYINT(1) NOT NULL DEFAULT 0;`,
  widenPkToBigint: (t, c) =>
    `ALTER TABLE ${quoteIdent('mysql', t)} MODIFY ${quoteIdent('mysql', c)} BIGINT NOT NULL AUTO_INCREMENT;`,
  booleanTypeLabel: 'TINYINT(1)/BOOLEAN',
  hasStorageEngines: true,
  hasCharsets: true,
};

const postgresDialect: AuditDialect = {
  engine: 'postgres',
  q: (n) => quoteIdent('postgres', n),
  addIdPk: (t) =>
    `ALTER TABLE ${quoteIdent('postgres', t)} ADD COLUMN "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY;`,
  addForeignKey: (t, c, ref) =>
    `ALTER TABLE ${quoteIdent('postgres', t)} ADD CONSTRAINT "fk_${t}_${c}" FOREIGN KEY (${quoteIdent('postgres', c)}) REFERENCES ${quoteIdent('postgres', ref)}("id");`,
  createIndex: (t, c) =>
    `CREATE INDEX "idx_${t}_${c}" ON ${quoteIdent('postgres', t)}(${quoteIdent('postgres', c)});`,
  createUniqueIndex: (t, c) =>
    `CREATE UNIQUE INDEX "uq_${t}_${c}" ON ${quoteIdent('postgres', t)}(${quoteIdent('postgres', c)});`,
  // Postgres has no ON UPDATE clause; updated_at maintenance needs a trigger.
  addTimestamps: (t) =>
    `ALTER TABLE ${quoteIdent('postgres', t)}\n  ADD COLUMN "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  ADD COLUMN "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`,
  setColumnDecimal: (t, c) =>
    `ALTER TABLE ${quoteIdent('postgres', t)} ALTER COLUMN ${quoteIdent('postgres', c)} TYPE DECIMAL(12,2);`,
  setColumnBoolean: (t, c) =>
    `ALTER TABLE ${quoteIdent('postgres', t)} ALTER COLUMN ${quoteIdent('postgres', c)} TYPE BOOLEAN USING (${quoteIdent('postgres', c)}::boolean);`,
  widenPkToBigint: (t, c) =>
    `ALTER TABLE ${quoteIdent('postgres', t)} ALTER COLUMN ${quoteIdent('postgres', c)} TYPE BIGINT;`,
  booleanTypeLabel: 'BOOLEAN',
  hasStorageEngines: false,
  hasCharsets: false,
};

const sqlServerDialect: AuditDialect = {
  engine: 'sqlserver',
  q: (n) => quoteIdent('sqlserver', n),
  addIdPk: (t) =>
    `ALTER TABLE ${quoteIdent('sqlserver', t)} ADD [id] BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY;`,
  addForeignKey: (t, c, ref) =>
    `ALTER TABLE ${quoteIdent('sqlserver', t)} ADD CONSTRAINT [fk_${t}_${c}] FOREIGN KEY (${quoteIdent('sqlserver', c)}) REFERENCES ${quoteIdent('sqlserver', ref)}([id]);`,
  createIndex: (t, c) =>
    `CREATE INDEX [idx_${t}_${c}] ON ${quoteIdent('sqlserver', t)}(${quoteIdent('sqlserver', c)});`,
  createUniqueIndex: (t, c) =>
    `CREATE UNIQUE INDEX [uq_${t}_${c}] ON ${quoteIdent('sqlserver', t)}(${quoteIdent('sqlserver', c)});`,
  // No ON UPDATE in T-SQL; updated_at maintenance needs a trigger.
  addTimestamps: (t) =>
    `ALTER TABLE ${quoteIdent('sqlserver', t)} ADD [created_at] DATETIME2 DEFAULT SYSUTCDATETIME(), [updated_at] DATETIME2 DEFAULT SYSUTCDATETIME();`,
  setColumnDecimal: (t, c) =>
    `ALTER TABLE ${quoteIdent('sqlserver', t)} ALTER COLUMN ${quoteIdent('sqlserver', c)} DECIMAL(12,2);`,
  setColumnBoolean: (t, c) =>
    `ALTER TABLE ${quoteIdent('sqlserver', t)} ALTER COLUMN ${quoteIdent('sqlserver', c)} BIT;`,
  widenPkToBigint: (t, c) =>
    `ALTER TABLE ${quoteIdent('sqlserver', t)} ALTER COLUMN ${quoteIdent('sqlserver', c)} BIGINT;`,
  booleanTypeLabel: 'BIT',
  hasStorageEngines: false,
  hasCharsets: false,
};

const oracleDialect: AuditDialect = {
  engine: 'oracle',
  q: (n) => quoteIdent('oracle', n),
  addIdPk: (t) =>
    `ALTER TABLE ${quoteIdent('oracle', t)} ADD "id" NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY;`,
  addForeignKey: (t, c, ref) =>
    `ALTER TABLE ${quoteIdent('oracle', t)} ADD CONSTRAINT "fk_${t}_${c}" FOREIGN KEY (${quoteIdent('oracle', c)}) REFERENCES ${quoteIdent('oracle', ref)}("id");`,
  createIndex: (t, c) =>
    `CREATE INDEX "idx_${t}_${c}" ON ${quoteIdent('oracle', t)}(${quoteIdent('oracle', c)});`,
  createUniqueIndex: (t, c) =>
    `CREATE UNIQUE INDEX "uq_${t}_${c}" ON ${quoteIdent('oracle', t)}(${quoteIdent('oracle', c)});`,
  // Oracle: ADD (cols); no ON UPDATE (use a trigger).
  addTimestamps: (t) =>
    `ALTER TABLE ${quoteIdent('oracle', t)} ADD ("created_at" TIMESTAMP DEFAULT SYSTIMESTAMP, "updated_at" TIMESTAMP DEFAULT SYSTIMESTAMP);`,
  setColumnDecimal: (t, c) =>
    `ALTER TABLE ${quoteIdent('oracle', t)} MODIFY (${quoteIdent('oracle', c)} NUMBER(12,2));`,
  setColumnBoolean: (t, c) =>
    `ALTER TABLE ${quoteIdent('oracle', t)} MODIFY (${quoteIdent('oracle', c)} NUMBER(1));`,
  widenPkToBigint: (t, c) =>
    `ALTER TABLE ${quoteIdent('oracle', t)} MODIFY (${quoteIdent('oracle', c)} NUMBER(19));`,
  booleanTypeLabel: 'NUMBER(1)',
  hasStorageEngines: false,
  hasCharsets: false,
};

export function auditDialect(engine: DbEngine): AuditDialect {
  if (engine === 'postgres') return postgresDialect;
  if (engine === 'sqlserver') return sqlServerDialect;
  if (engine === 'oracle') return oracleDialect;
  return mysqlDialect;
}
