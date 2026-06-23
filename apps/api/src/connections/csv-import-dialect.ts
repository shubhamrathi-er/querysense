import { BadRequestException } from '@nestjs/common';
import { DbEngine, quoteIdent } from '../common/db/engine';

/**
 * Per-engine DDL for creating tables / adding columns during CSV import.
 *
 * The UI sends canonical MySQL-style type tokens (INT, DOUBLE, DATETIME, …);
 * we validate against that canonical set and translate to the engine's real DDL
 * type via sqlType(). This keeps the import UI engine-agnostic.
 */
const CANONICAL_TYPES = new Set<string>([
  'INT',
  'BIGINT',
  'DOUBLE',
  'DECIMAL(18,4)',
  'VARCHAR(255)',
  'TEXT',
  'DATE',
  'DATETIME',
  'BOOLEAN',
]);

const PG_TYPE_MAP: Record<string, string> = {
  INT: 'INTEGER',
  BIGINT: 'BIGINT',
  DOUBLE: 'DOUBLE PRECISION',
  'DECIMAL(18,4)': 'NUMERIC(18,4)',
  'VARCHAR(255)': 'VARCHAR(255)',
  TEXT: 'TEXT',
  DATE: 'DATE',
  DATETIME: 'TIMESTAMP',
  BOOLEAN: 'BOOLEAN',
};

const SS_TYPE_MAP: Record<string, string> = {
  INT: 'INT',
  BIGINT: 'BIGINT',
  DOUBLE: 'FLOAT',
  'DECIMAL(18,4)': 'DECIMAL(18,4)',
  'VARCHAR(255)': 'NVARCHAR(255)',
  TEXT: 'NVARCHAR(MAX)',
  DATE: 'DATE',
  DATETIME: 'DATETIME2',
  BOOLEAN: 'BIT',
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CsvDialect {
  readonly engine: DbEngine;
  /** Validate + quote a table/column identifier. */
  ident(name: string): string;
  /** Is this (canonical, upper-cased) type allowed for a new column? */
  isAllowedType(canonical: string): boolean;
  /** Translate a canonical type token to this engine's DDL type. */
  sqlType(canonical: string): string;
  /** Auto-increment surrogate primary-key column definition. */
  surrogateKeyDef(): string;
  /** Trailing clause for CREATE TABLE (storage engine/charset for MySQL). */
  createTableTail(): string;
  /** SQL expression for "the current schema/database". */
  currentSchemaExpr(): string;
}

function ident(engine: DbEngine, name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new BadRequestException(
      `Invalid identifier "${name}". Use letters, numbers and underscores only.`,
    );
  }
  return quoteIdent(engine, name);
}

const mysql: CsvDialect = {
  engine: 'mysql',
  ident: (n) => ident('mysql', n),
  isAllowedType: (t) => CANONICAL_TYPES.has(t),
  sqlType: (t) => t,
  surrogateKeyDef: () => '`id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
  createTableTail: () => ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  currentSchemaExpr: () => 'DATABASE()',
};

const postgres: CsvDialect = {
  engine: 'postgres',
  ident: (n) => ident('postgres', n),
  isAllowedType: (t) => CANONICAL_TYPES.has(t),
  sqlType: (t) => PG_TYPE_MAP[t] ?? t,
  surrogateKeyDef: () => '"id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
  createTableTail: () => '',
  currentSchemaExpr: () => 'current_schema()',
};

const sqlserver: CsvDialect = {
  engine: 'sqlserver',
  ident: (n) => ident('sqlserver', n),
  isAllowedType: (t) => CANONICAL_TYPES.has(t),
  sqlType: (t) => SS_TYPE_MAP[t] ?? t,
  surrogateKeyDef: () => '[id] BIGINT IDENTITY(1,1) PRIMARY KEY',
  createTableTail: () => '',
  currentSchemaExpr: () => 'SCHEMA_NAME()',
};

export function csvDialect(engine: DbEngine): CsvDialect {
  if (engine === 'postgres') return postgres;
  if (engine === 'sqlserver') return sqlserver;
  return mysql;
}
