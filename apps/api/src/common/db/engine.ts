/**
 * Database engine abstraction shared across the connection, schema, AI, and
 * migration features. querysense connects to *target* databases (the ones users
 * query) — historically MySQL only; this layer lets each feature branch on the
 * engine via small dialect helpers instead of scattering `if (engine === ...)`.
 */

export type DbEngine =
  | 'mysql'
  | 'mariadb'
  | 'postgres'
  | 'redshift'
  | 'sqlserver'
  | 'snowflake'
  | 'oracle';

export const DB_ENGINES: readonly DbEngine[] = [
  'mysql',
  'mariadb',
  'postgres',
  'redshift',
  'sqlserver',
  'snowflake',
  'oracle',
] as const;

/**
 * Default TCP port per engine, applied when the user omits one. Snowflake is
 * accessed over HTTPS (443) via its account identifier rather than host:port.
 */
export const DEFAULT_PORTS: Record<DbEngine, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgres: 5432,
  redshift: 5439,
  sqlserver: 1433,
  snowflake: 443,
  oracle: 1521,
};

/** MariaDB speaks the MySQL wire protocol and SQL dialect. */
export function isMysqlFamily(engine: DbEngine): boolean {
  return engine === 'mysql' || engine === 'mariadb';
}

/** Redshift is PostgreSQL wire-compatible (pg driver, "-quoting, $n params). */
export function isPostgresFamily(engine: DbEngine): boolean {
  return engine === 'postgres' || engine === 'redshift';
}

/** Engines that only support connect/query (no CSV import, audit, or migration). */
export function isConnectQueryOnly(engine: DbEngine): boolean {
  return engine === 'redshift' || engine === 'snowflake';
}

/** Human-facing engine names for UI labels and error messages. */
export const ENGINE_LABELS: Record<DbEngine, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgres: 'PostgreSQL',
  redshift: 'Amazon Redshift',
  sqlserver: 'SQL Server',
  snowflake: 'Snowflake',
  oracle: 'Oracle',
};

/**
 * Coerce arbitrary input (legacy null, "postgresql", casing) to a DbEngine.
 * Falls back to 'mysql' so pre-existing connection rows keep working.
 */
export function normalizeEngine(value: string | null | undefined): DbEngine {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'postgres' || v === 'postgresql' || v === 'pg') return 'postgres';
  if (v === 'sqlserver' || v === 'mssql' || v === 'sql_server' || v === 'sqlsrv') {
    return 'sqlserver';
  }
  if (v === 'mariadb' || v === 'maria') return 'mariadb';
  if (v === 'redshift') return 'redshift';
  if (v === 'snowflake' || v === 'sf') return 'snowflake';
  if (v === 'oracle' || v === 'oracledb' || v === 'oracle_db') return 'oracle';
  return 'mysql';
}

/**
 * Quote an identifier for the given engine. MySQL uses backticks; PostgreSQL
 * uses double quotes; SQL Server uses [brackets] (with `]` escaped by doubling).
 * Rejects characters that can't be safely escaped for the engine.
 */
export function quoteIdent(engine: DbEngine, name: string): string {
  if (name.includes('\0')) {
    throw new Error('Identifier contains a NUL byte');
  }
  if (isPostgresFamily(engine) || engine === 'snowflake' || engine === 'oracle') {
    // Snowflake & Oracle also use double-quoted identifiers (folding unquoted to
    // upper-case), so case-sensitive names must be quoted.
    return `"${name.replace(/"/g, '""')}"`;
  }
  if (engine === 'sqlserver') {
    return `[${name.replace(/]/g, ']]')}]`;
  }
  if (name.includes('`')) {
    throw new Error('MySQL identifier cannot contain a backtick');
  }
  return `\`${name}\``;
}

export type ParserDialect =
  | 'MySQL'
  | 'PostgreSQL'
  | 'transactsql'
  | 'redshift'
  | 'snowflake';

/** The dialect string node-sql-parser expects for this engine. */
export function parserDialect(engine: DbEngine): ParserDialect {
  if (engine === 'postgres') return 'PostgreSQL';
  if (engine === 'redshift') return 'redshift';
  if (engine === 'sqlserver') return 'transactsql';
  if (engine === 'snowflake') return 'snowflake';
  return 'MySQL';
}

/**
 * Candidate parser dialects to try, in order. node-sql-parser has no Oracle
 * grammar, so for Oracle we try the closest dialects and fail closed (reject)
 * if none parse — common Oracle SELECTs parse; Oracle-specific syntax is
 * rejected rather than wrongly allowed.
 */
export function parserDialectCandidates(engine: DbEngine): ParserDialect[] {
  if (engine === 'oracle') return ['transactsql', 'PostgreSQL', 'MySQL'];
  return [parserDialect(engine)];
}
