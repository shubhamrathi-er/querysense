import * as mysql from 'mysql2/promise';
import { Pool as PgPool } from 'pg';
import * as net from 'net';
import { Client } from 'ssh2';
import { DbEngine } from './engine';

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
}

export interface PoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  connectionLimit?: number;
  connectTimeout?: number;
  /** When set, the MySQL connection is tunnelled through this SSH host. */
  ssh?: SshConfig;
}

export interface TunneledPool {
  pool: mysql.Pool;
  cleanup: () => Promise<void>;
}

interface SshConnectionSource {
  sshEnabled?: boolean | null;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUsername?: string | null;
  sshPrivateKey?: string | null;
  sshPassphrase?: string | null;
  sshPassword?: string | null;
}

/** Build a (decrypted) SSH config from a connection record, or undefined. */
export function buildSshConfig(
  c: SshConnectionSource,
  decrypt: (s: string) => string,
): SshConfig | undefined {
  if (!c.sshEnabled || !c.sshHost || !c.sshUsername) return undefined;
  return {
    host: c.sshHost,
    port: c.sshPort ?? 22,
    username: c.sshUsername,
    privateKey: c.sshPrivateKey ? decrypt(c.sshPrivateKey) : undefined,
    passphrase: c.sshPassphrase ? decrypt(c.sshPassphrase) : undefined,
    password: c.sshPassword ? decrypt(c.sshPassword) : undefined,
  };
}

/**
 * Open an SSH tunnel and a local TCP forwarder, so callers can connect to the
 * returned 127.0.0.1:port as if it were the remote DB. Returns a close().
 */
async function openSshTunnel(
  ssh: SshConfig,
  destHost: string,
  destPort: number,
): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const client = new Client();

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    client.once('ready', () => {
      client.removeListener('error', onError);
      resolve();
    });
    client.once('error', onError);
    client.connect({
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.username,
      privateKey: ssh.privateKey || undefined,
      passphrase: ssh.passphrase || undefined,
      password: ssh.password || undefined,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
    });
  });

  const server = net.createServer((socket) => {
    client.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      destHost,
      destPort,
      (err, stream) => {
        if (err) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
        stream.on('error', () => socket.destroy());
        socket.on('error', () => stream.end());
      },
    );
  });
  server.on('error', () => {
    /* keep the tunnel alive even if one local socket errors */
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  const close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    client.end();
  };

  return { host: '127.0.0.1', port, close };
}

/**
 * Create a mysql2 pool, transparently tunnelling through SSH when configured.
 * Always pair with the returned cleanup() (ends the pool and the tunnel).
 */
export async function createMysqlPool(cfg: PoolConfig): Promise<TunneledPool> {
  let tunnel: { host: string; port: number; close: () => Promise<void> } | null =
    null;
  let host = cfg.host;
  let port = cfg.port;

  if (cfg.ssh) {
    tunnel = await openSshTunnel(cfg.ssh, cfg.host, cfg.port);
    host = tunnel.host;
    port = tunnel.port;
  }

  const pool = mysql.createPool({
    host,
    port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: cfg.connectionLimit ?? 3,
    connectTimeout: cfg.connectTimeout ?? 10000,
  });

  const cleanup = async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    if (tunnel) await tunnel.close();
  };

  return { pool, cleanup };
}

export interface TunneledPgPool {
  pool: PgPool;
  cleanup: () => Promise<void>;
}

/**
 * Create a node-postgres pool, transparently tunnelling through SSH when
 * configured. Mirrors createMysqlPool(); always pair with cleanup().
 */
export async function createPostgresPool(
  cfg: PoolConfig,
): Promise<TunneledPgPool> {
  let tunnel: { host: string; port: number; close: () => Promise<void> } | null =
    null;
  let host = cfg.host;
  let port = cfg.port;

  if (cfg.ssh) {
    tunnel = await openSshTunnel(cfg.ssh, cfg.host, cfg.port);
    host = tunnel.host;
    port = tunnel.port;
  }

  const pool = new PgPool({
    host,
    port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    max: cfg.connectionLimit ?? 3,
    connectionTimeoutMillis: cfg.connectTimeout ?? 10000,
  });
  // A pool-level error handler is mandatory for pg; without it an idle-client
  // error (e.g. server restart) crashes the process.
  pool.on('error', () => {
    /* swallow; the failing client is removed from the pool automatically */
  });

  const cleanup = async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    if (tunnel) await tunnel.close();
  };

  return { pool, cleanup };
}

/**
 * Engine-agnostic SQL client. `query()` returns rows directly (normalising the
 * mysql2 `[rows, fields]` tuple vs pg `{ rows }` shape) so call sites that share
 * otherwise-identical SQL don't have to branch on the driver. Identifier quoting
 * and dialect-specific SQL still differ — see quoteIdent() and the per-feature
 * introspectors/adapters.
 */
/** Query + bulk-insert surface available both on a pool and inside a transaction. */
export interface SqlExecutor {
  readonly engine: DbEngine;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  /**
   * Insert many rows in one statement. `table` and `columns` must be
   * already-quoted SQL identifier fragments (see quoteIdent). Returns the row
   * count. Abstracts mysql2's `VALUES ?` vs pg's `($1,$2),...` placeholder forms.
   */
  bulkInsert(
    table: string,
    columns: string[],
    rows: unknown[][],
  ): Promise<number>;
}

export interface SqlClient extends SqlExecutor {
  ping(): Promise<void>;
  cleanup(): Promise<void>;
  /** Run `fn` inside a transaction on a single dedicated connection. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

function mysqlBulkInsert(
  q: (sql: string, params?: unknown[]) => Promise<unknown>,
) {
  return async (table: string, columns: string[], rows: unknown[][]) => {
    if (rows.length === 0) return 0;
    await q(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [rows]);
    return rows.length;
  };
}

function pgBulkInsert(
  q: (sql: string, params?: unknown[]) => Promise<unknown>,
) {
  return async (table: string, columns: string[], rows: unknown[][]) => {
    if (rows.length === 0) return 0;
    const width = columns.length;
    const tuples = rows
      .map(
        (_, ri) =>
          `(${columns.map((__, ci) => `$${ri * width + ci + 1}`).join(', ')})`,
      )
      .join(', ');
    await q(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples}`,
      rows.flat(),
    );
    return rows.length;
  };
}

/**
 * Create a normalised SqlClient for the given engine. Note: parameter
 * placeholders are NOT translated — MySQL uses `?`, Postgres uses `$1`. Callers
 * that parameterise must use the right placeholder for the engine (most
 * introspection SQL inlines validated identifiers and takes no params).
 */
export async function createPool(
  engine: DbEngine,
  cfg: PoolConfig,
): Promise<SqlClient> {
  if (engine === 'postgres') {
    const { pool, cleanup } = await createPostgresPool(cfg);
    const query = async <T>(sql: string, params?: unknown[]) =>
      (await pool.query(sql, params)).rows as T[];
    return {
      engine,
      query,
      bulkInsert: pgBulkInsert((s, p) => pool.query(s, p)),
      ping: async () => {
        await pool.query('SELECT 1');
      },
      cleanup,
      transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>) => {
        const client = await pool.connect();
        const txQuery = async <U>(sql: string, params?: unknown[]) =>
          (await client.query(sql, params)).rows as U[];
        try {
          await client.query('BEGIN');
          const result = await fn({
            engine,
            query: txQuery,
            bulkInsert: pgBulkInsert((s, p) => client.query(s, p)),
          });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* connection may be unusable */
          }
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }

  const { pool, cleanup } = await createMysqlPool(cfg);
  const query = async <T>(sql: string, params?: unknown[]) => {
    const [rows] = await pool.query(sql, params);
    return rows as T[];
  };
  return {
    engine,
    query,
    bulkInsert: mysqlBulkInsert((s, p) => pool.query(s, p)),
    ping: async () => {
      const conn = await pool.getConnection();
      try {
        await conn.ping();
      } finally {
        conn.release();
      }
    },
    cleanup,
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>) => {
      const conn = await pool.getConnection();
      const txQuery = async <U>(sql: string, params?: unknown[]) => {
        const [rows] = await conn.query(sql, params);
        return rows as U[];
      };
      try {
        await conn.beginTransaction();
        const result = await fn({
          engine,
          query: txQuery,
          bulkInsert: mysqlBulkInsert((s, p) => conn.query(s, p)),
        });
        await conn.commit();
        return result;
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          /* connection may be unusable */
        }
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}
