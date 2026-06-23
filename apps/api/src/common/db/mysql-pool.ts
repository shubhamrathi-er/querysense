import * as mysql from 'mysql2/promise';
import * as net from 'net';
import { Client } from 'ssh2';

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
