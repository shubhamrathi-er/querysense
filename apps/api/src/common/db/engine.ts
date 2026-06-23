/**
 * Database engine abstraction shared across the connection, schema, AI, and
 * migration features. querysense connects to *target* databases (the ones users
 * query) — historically MySQL only; this layer lets each feature branch on the
 * engine via small dialect helpers instead of scattering `if (engine === ...)`.
 */

export type DbEngine = 'mysql' | 'postgres';

export const DB_ENGINES: readonly DbEngine[] = ['mysql', 'postgres'] as const;

/** Default TCP port per engine, applied when the user omits one. */
export const DEFAULT_PORTS: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
};

/**
 * Coerce arbitrary input (legacy null, "postgresql", casing) to a DbEngine.
 * Falls back to 'mysql' so pre-existing connection rows keep working.
 */
export function normalizeEngine(value: string | null | undefined): DbEngine {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'postgres' || v === 'postgresql' || v === 'pg') return 'postgres';
  return 'mysql';
}

/**
 * Quote an identifier for the given engine. MySQL uses backticks; PostgreSQL
 * uses double quotes (with `"` escaped by doubling). Rejects characters that
 * can't be safely escaped for the engine.
 */
export function quoteIdent(engine: DbEngine, name: string): string {
  if (name.includes('\0')) {
    throw new Error('Identifier contains a NUL byte');
  }
  if (engine === 'postgres') {
    return `"${name.replace(/"/g, '""')}"`;
  }
  if (name.includes('`')) {
    throw new Error('MySQL identifier cannot contain a backtick');
  }
  return `\`${name}\``;
}

/** The dialect string node-sql-parser expects for this engine. */
export function parserDialect(engine: DbEngine): 'MySQL' | 'PostgreSQL' {
  return engine === 'postgres' ? 'PostgreSQL' : 'MySQL';
}
