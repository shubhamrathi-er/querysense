import * as mysql from 'mysql2/promise';
import { Pool as PgPool } from 'pg';
import * as mssql from 'mssql';
import * as snowflake from 'snowflake-sdk';
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

export interface TunneledMssqlPool {
  pool: mssql.ConnectionPool;
  cleanup: () => Promise<void>;
}

/**
 * Create a SQL Server (mssql) connection pool, transparently tunnelling through
 * SSH when configured. Mirrors createMysqlPool(); always pair with cleanup().
 */
export async function createSqlServerPool(
  cfg: PoolConfig,
): Promise<TunneledMssqlPool> {
  let tunnel: { host: string; port: number; close: () => Promise<void> } | null =
    null;
  let server = cfg.host;
  let port = cfg.port;

  if (cfg.ssh) {
    tunnel = await openSshTunnel(cfg.ssh, cfg.host, cfg.port);
    server = tunnel.host;
    port = tunnel.port;
  }

  const pool = new mssql.ConnectionPool({
    server,
    port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: !!cfg.ssl,
      trustServerCertificate: true,
    },
    pool: { max: cfg.connectionLimit ?? 3, min: 0 },
    connectionTimeout: cfg.connectTimeout ?? 10000,
    requestTimeout: 30000,
  });
  pool.on('error', () => {
    /* swallow idle-client errors */
  });
  await pool.connect();

  const cleanup = async () => {
    try {
      await pool.close();
    } catch {
      /* ignore */
    }
    if (tunnel) await tunnel.close();
  };

  return { pool, cleanup };
}

export interface SnowflakeHandle {
  execute<T = Record<string, unknown>>(
    sqlText: string,
    binds?: unknown[],
  ): Promise<T[]>;
  cleanup: () => Promise<void>;
}

/**
 * Connect to Snowflake via its account identifier (stored in cfg.host). Uses a
 * single connection (no SSH); warehouse/schema/role come from the user's
 * defaults. Connect/query only — no bulk insert or transactions are wired.
 */
export async function createSnowflakePool(
  cfg: PoolConfig,
): Promise<SnowflakeHandle> {
  const conn = snowflake.createConnection({
    account: cfg.host,
    username: cfg.user,
    password: cfg.password,
    database: cfg.database,
    application: 'querysense',
  });
  await new Promise<void>((resolve, reject) =>
    conn.connect((err) => (err ? reject(err) : resolve())),
  );

  const execute = <T>(sqlText: string, binds: unknown[] = []) =>
    new Promise<T[]>((resolve, reject) => {
      conn.execute({
        sqlText,
        binds: binds as snowflake.Binds,
        complete: (err, _stmt, rows) =>
          err ? reject(err) : resolve((rows ?? []) as T[]),
      });
    });

  const cleanup = () =>
    new Promise<void>((resolve) => conn.destroy(() => resolve()));

  return { execute, cleanup };
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

/** Bind positional params (@p0, @p1, …) onto an mssql Request, inferring types
 *  so NULLs, dates, buffers and numbers round-trip correctly. */
function mssqlBind(req: mssql.Request, params: unknown[]): void {
  params.forEach((v, i) => {
    const name = `p${i}`;
    if (v === null || v === undefined) req.input(name, mssql.NVarChar, null);
    else if (typeof v === 'boolean') req.input(name, mssql.Bit, v);
    else if (typeof v === 'bigint') req.input(name, mssql.BigInt, v.toString());
    else if (typeof v === 'number')
      Number.isInteger(v)
        ? req.input(name, mssql.BigInt, v)
        : req.input(name, mssql.Float, v);
    else if (v instanceof Date) req.input(name, mssql.DateTime2, v);
    else if (Buffer.isBuffer(v)) req.input(name, mssql.VarBinary(mssql.MAX), v);
    else if (typeof v === 'object')
      req.input(name, mssql.NVarChar(mssql.MAX), JSON.stringify(v));
    else req.input(name, mssql.NVarChar(mssql.MAX), String(v));
  });
}

/** mssql query executor over a request factory; returns the recordset rows. */
function mssqlExec(makeRequest: () => mssql.Request) {
  return async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    const req = makeRequest();
    mssqlBind(req, params);
    const res = await req.query(sql);
    return (res.recordset ?? []) as T[];
  };
}

/** SQL Server bulk insert. Respects the 1000-row VALUES limit and 2100-param
 *  cap per statement by sub-chunking. */
function mssqlBulkInsert(
  exec: (sql: string, params?: unknown[]) => Promise<unknown>,
) {
  return async (table: string, columns: string[], rows: unknown[][]) => {
    if (rows.length === 0) return 0;
    const width = Math.max(1, columns.length);
    const perStmt = Math.max(1, Math.min(1000, Math.floor(2100 / width)));
    let total = 0;
    for (let i = 0; i < rows.length; i += perStmt) {
      const chunk = rows.slice(i, i + perStmt);
      const tuples = chunk
        .map(
          (_, ri) =>
            `(${columns.map((__, ci) => `@p${ri * width + ci}`).join(', ')})`,
        )
        .join(', ');
      await exec(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples}`,
        chunk.flat(),
      );
      total += chunk.length;
    }
    return total;
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
  if (engine === 'postgres' || engine === 'redshift') {
    // Redshift is PostgreSQL wire-compatible, so it uses the same pg driver.
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

  if (engine === 'snowflake') {
    const sf = await createSnowflakePool(cfg);
    const unsupported = (): never => {
      throw new Error(
        'This operation is not supported for Snowflake (connect/query only).',
      );
    };
    return {
      engine,
      query: <T>(sql: string, params?: unknown[]) => sf.execute<T>(sql, params),
      bulkInsert: () => Promise.reject(unsupported()),
      ping: async () => {
        await sf.execute('SELECT 1');
      },
      cleanup: sf.cleanup,
      transaction: () => Promise.reject(unsupported()),
    };
  }

  if (engine === 'sqlserver') {
    const { pool, cleanup } = await createSqlServerPool(cfg);
    const exec = mssqlExec(() => pool.request());
    return {
      engine,
      query: exec,
      bulkInsert: mssqlBulkInsert(exec),
      ping: async () => {
        await pool.request().query('SELECT 1');
      },
      cleanup,
      transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>) => {
        const tx = new mssql.Transaction(pool);
        await tx.begin();
        const texec = mssqlExec(() => new mssql.Request(tx));
        try {
          const result = await fn({
            engine,
            query: texec,
            bulkInsert: mssqlBulkInsert(texec),
          });
          await tx.commit();
          return result;
        } catch (err) {
          try {
            await tx.rollback();
          } catch {
            /* transaction may already be aborted */
          }
          throw err;
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
