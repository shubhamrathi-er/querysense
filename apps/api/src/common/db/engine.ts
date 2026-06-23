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
  | 'snowflake';

export const DB_ENGINES: readonly DbEngine[] = [
  'mysql',
  'mariadb',
  'postgres',
  'redshift',
  'sqlserver',
  'snowflake',
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
  if (isPostgresFamily(engine) || engine === 'snowflake') {
    // Snowflake also uses double-quoted identifiers (and folds unquoted to upper).
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

/** The dialect string node-sql-parser expects for this engine. */
export function parserDialect(
  engine: DbEngine,
): 'MySQL' | 'PostgreSQL' | 'transactsql' | 'redshift' | 'snowflake' {
  if (engine === 'postgres') return 'PostgreSQL';
  if (engine === 'redshift') return 'redshift';
  if (engine === 'sqlserver') return 'transactsql';
  if (engine === 'snowflake') return 'snowflake';
  return 'MySQL';
}
