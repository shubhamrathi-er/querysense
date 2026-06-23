import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { buildSshConfig, type SshConfig } from '../common/db/mysql-pool';
import {
  DbEngine,
  normalizeEngine,
  isConnectQueryOnly,
  ENGINE_LABELS,
} from '../common/db/engine';
import {
  createMigrationDriver,
  SCRIPT_ROW_CAP,
  type Conflict,
  type MigrationConn,
  type MigrationDriver,
} from './drivers';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { MigrationValidationService } from './validation/migration-validation.service';

interface ConnInfo {
  engine: DbEngine;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  encryptedPassword: string;
  sslEnabled: boolean;
  name: string;
  ssh?: SshConfig;
}

const IDENT = /^[A-Za-z0-9_$]+$/;

@Injectable()
export class DataMigrationService {
  private readonly logger = new Logger(DataMigrationService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private validation: MigrationValidationService,
  ) {}

  // ─── Plan (dry-run preview) ──────────────────────────────

  async plan(workspaceId: string, sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      throw new BadRequestException('Source and target must be different.');
    }
    const source = await this.load(sourceId, workspaceId);
    const target = await this.load(targetId, workspaceId);
    const engine = this.assertSameEngine(source, target);
    const driver = createMigrationDriver(
      engine,
      this.connOf(source),
      this.connOf(target),
    );
    await driver.openSource();
    await driver.openTarget();

    try {
      const sTables = await driver.sourceBaseTables();
      const tExisting = new Map(
        (await driver.targetBaseTables()).map((t) => [t.name, t.rows]),
      );
      const fks = await driver.sourceForeignKeys();
      const order = this.topoOrder(sTables.map((t) => t.name), fks);
      const rank = new Map(order.map((n, i) => [n, i]));

      const tables = sTables
        .map((t) => ({
          tableName: t.name,
          sourceRows: t.rows,
          existsOnTarget: tExisting.has(t.name),
          targetRows: tExisting.get(t.name) ?? null,
        }))
        .sort((a, b) => rank.get(a.tableName)! - rank.get(b.tableName)!);

      return {
        source: { id: sourceId, name: source.name, database: source.databaseName },
        target: { id: targetId, name: target.name, database: target.databaseName },
        engine,
        order,
        tables,
      };
    } finally {
      await driver.close();
    }
  }

  // ─── Script generation ───────────────────────────────────

  async generateScript(
    workspaceId: string,
    dto: {
      sourceConnectionId: string;
      targetConnectionId: string;
      tables: string[];
      createTables: boolean;
      conflict: Conflict;
    },
  ): Promise<{ sql: string; truncated: boolean; rowsIncluded: number }> {
    const source = await this.load(dto.sourceConnectionId, workspaceId);
    const target = await this.load(dto.targetConnectionId, workspaceId);
    const engine = this.assertSameEngine(source, target);
    const driver = createMigrationDriver(
      engine,
      this.connOf(source),
      this.connOf(target),
    );
    await driver.openSource();

    try {
      const ordered = await this.orderTables(driver, dto.tables);
      const parts: string[] = driver.scriptHeader(source.name, source.databaseName);
      let rowsIncluded = 0;
      let truncated = false;

      for (const table of ordered) {
        this.assertIdent(table);
        if (dto.createTables) {
          parts.push(...(await driver.scriptCreateTable(table)));
        }
        if (dto.conflict === 'truncate') {
          parts.push(driver.scriptTruncate(table));
        }
        const ins = await driver.scriptInserts(table, dto.conflict, SCRIPT_ROW_CAP);
        parts.push(...ins.lines);
        rowsIncluded += ins.rows;
        truncated = truncated || ins.truncated;
      }

      parts.push(...driver.scriptFooter());
      return { sql: parts.join('\n'), truncated, rowsIncluded };
    } finally {
      await driver.close();
    }
  }

  // ─── Direct copy (SSE) ───────────────────────────────────

  async run(
    workspaceId: string,
    dto: {
      sourceConnectionId: string;
      targetConnectionId: string;
      tables: string[];
      createTables: boolean;
      conflict: Conflict;
      skipValidation?: boolean;
    },
    res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    // Pre-flight validation gate: never start if a BLOCKER is present.
    if (!dto.skipValidation) {
      try {
        const blockers = await this.validation.hasBlockingIssues(workspaceId, {
          sourceConnectionId: dto.sourceConnectionId,
          targetConnectionId: dto.targetConnectionId,
          tables: dto.tables,
          mode: dto.conflict === 'truncate' ? 'overwrite' : 'append',
        });
        if (blockers.length > 0) {
          send('error', {
            message: `Migration blocked by ${blockers.length} validation blocker(s).`,
            blockers,
          });
          res.end();
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Pre-flight validation could not complete: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    let driver: MigrationDriver | null = null;
    const report: Array<{
      table: string;
      copied: number;
      sourceRows: number;
      targetRows: number;
      status: string;
      error?: string;
    }> = [];

    try {
      if (dto.sourceConnectionId === dto.targetConnectionId) {
        throw new BadRequestException('Source and target must be different.');
      }
      const source = await this.load(dto.sourceConnectionId, workspaceId);
      const target = await this.load(dto.targetConnectionId, workspaceId);
      const engine = this.assertSameEngine(source, target);
      driver = createMigrationDriver(
        engine,
        this.connOf(source),
        this.connOf(target),
      );
      await driver.openSource();
      await driver.openTarget();

      const ordered = await this.orderTables(driver, dto.tables);
      const targetExisting = new Set(
        (await driver.targetBaseTables()).map((t) => t.name),
      );

      for (const table of ordered) {
        this.assertIdent(table);
        send('table', { table, status: 'start' });
        try {
          if (dto.createTables && !targetExisting.has(table)) {
            await driver.createTableOnTarget(table);
            send('table', { table, status: 'created' });
          }
          if (dto.conflict === 'truncate') {
            await driver.truncateTarget(table);
          }

          const copied = await driver.copyTable(
            table,
            dto.conflict,
            (n, total) => send('progress', { table, copied: n, total }),
          );

          const sourceRows = await driver.sourceCount(table);
          const targetRows = await driver.targetCount(table);
          report.push({ table, copied, sourceRows, targetRows, status: 'done' });
          send('table', { table, status: 'done', copied, sourceRows, targetRows });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'copy failed';
          report.push({ table, copied: 0, sourceRows: 0, targetRows: 0, status: 'error', error: msg });
          send('table', { table, status: 'error', error: msg });
        }
      }

      send('done', { report });
      res.end();
    } catch (err) {
      send('error', {
        message: err instanceof Error ? err.message : 'Migration failed',
      });
      res.end();
    } finally {
      if (driver) await driver.close();
    }
  }

  // ─── Orchestration helpers (engine-agnostic) ─────────────

  private async orderTables(
    driver: MigrationDriver,
    selected: string[],
  ): Promise<string[]> {
    const set = new Set(selected);
    const fks = (await driver.sourceForeignKeys()).filter(
      (f) => set.has(f.table) && set.has(f.refTable),
    );
    return this.topoOrder(selected, fks);
  }

  /** Parents (referenced) before children. Cycles are appended in input order. */
  private topoOrder(
    tables: string[],
    fks: Array<{ table: string; refTable: string }>,
  ): string[] {
    const deps = new Map<string, Set<string>>();
    tables.forEach((t) => deps.set(t, new Set()));
    for (const f of fks) {
      if (f.table !== f.refTable && deps.has(f.table) && deps.has(f.refTable)) {
        deps.get(f.table)!.add(f.refTable);
      }
    }
    const out: string[] = [];
    const done = new Set<string>();
    while (out.length < tables.length) {
      const ready = tables.filter(
        (t) => !done.has(t) && [...deps.get(t)!].every((d) => done.has(d)),
      );
      if (ready.length === 0) {
        for (const t of tables) if (!done.has(t)) { out.push(t); done.add(t); }
        break;
      }
      for (const t of ready) {
        out.push(t);
        done.add(t);
      }
    }
    return out;
  }

  private assertIdent(name: string) {
    if (!IDENT.test(name)) {
      throw new BadRequestException(`Invalid table name "${name}".`);
    }
  }

  /**
   * Migration is same-engine only: it clones structure and copies rows but does
   * not translate types/DDL across engines. Cross-engine pairs are rejected.
   */
  private assertSameEngine(source: ConnInfo, target: ConnInfo): DbEngine {
    if (source.engine !== target.engine) {
      throw new BadRequestException(
        `Cross-engine migration is not supported: "${source.name}" is ` +
          `${source.engine} but "${target.name}" is ${target.engine}. ` +
          `Source and target must use the same database engine.`,
      );
    }
    if (isConnectQueryOnly(source.engine)) {
      throw new BadRequestException(
        `Data migration is not yet supported for ${ENGINE_LABELS[source.engine]} connections.`,
      );
    }
    return source.engine;
  }

  private async load(connectionId: string, workspaceId: string): Promise<ConnInfo> {
    const c = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!c) throw new NotFoundException('Connection not found');
    return {
      engine: normalizeEngine(c.engine),
      host: c.host,
      port: c.port,
      databaseName: c.databaseName,
      username: c.username,
      encryptedPassword: c.encryptedPassword,
      sslEnabled: c.sslEnabled,
      name: c.name,
      ssh: buildSshConfig(c, (s) => this.encryption.decrypt(s)),
    };
  }

  /** Resolve a stored connection into the decrypted shape a driver needs. */
  private connOf(c: ConnInfo): MigrationConn {
    return {
      host: c.host,
      port: c.port,
      database: c.databaseName,
      user: c.username,
      password: this.encryption.decrypt(c.encryptedPassword),
      sslEnabled: c.sslEnabled,
      ssh: c.ssh,
    };
  }
}
