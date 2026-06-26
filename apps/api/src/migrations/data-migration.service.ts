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
  type ColumnTransform,
  type MigrationConn,
  type MigrationDriver,
} from './drivers';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { MigrationValidationService } from './validation/migration-validation.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';

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
    private ai: AiOrchestratorService,
  ) {}

  // ─── Column mapping suggestion (AI + heuristic fallback) ──

  async suggestColumnMapping(
    workspaceId: string,
    dto: { sourceConnectionId: string; targetConnectionId: string; sourceTable: string; targetTable?: string },
  ): Promise<{
    source: Array<{ name: string; type: string }>;
    target: Array<{ name: string; type: string }>;
    mapping: Array<{ source: string; target: string | null }>;
    aiUsed: boolean;
  }> {
    const targetTable = dto.targetTable || dto.sourceTable;
    const [srcCols, tgtCols] = await Promise.all([
      this.validation.introspectColumns(workspaceId, dto.sourceConnectionId, dto.sourceTable),
      this.validation.introspectColumns(workspaceId, dto.targetConnectionId, targetTable),
    ]);
    const source = srcCols.map((c) => ({ name: c.name, type: c.columnType || c.dataType }));
    const target = tgtCols.map((c) => ({ name: c.name, type: c.columnType || c.dataType }));

    let mapping: Array<{ source: string; target: string | null }>;
    let aiUsed = true;
    try {
      mapping = await this.ai.suggestColumnMapping(dto.sourceTable, source, target);
      // Ensure every source column is represented (AI may omit some).
      const seen = new Set(mapping.map((m) => m.source));
      const heuristic = this.heuristicColumnMapping(source, target);
      for (const h of heuristic) if (!seen.has(h.source)) mapping.push(h);
    } catch {
      aiUsed = false;
      mapping = this.heuristicColumnMapping(source, target);
    }
    return { source, target, mapping, aiUsed };
  }

  /** Deterministic name-based fallback: exact → case-insensitive → normalised. */
  private heuristicColumnMapping(
    source: Array<{ name: string }>,
    target: Array<{ name: string }>,
  ): Array<{ source: string; target: string | null }> {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = new Map(target.map((t) => [t.name, t.name]));
    const ci = new Map(target.map((t) => [t.name.toLowerCase(), t.name]));
    const nm = new Map(target.map((t) => [norm(t.name), t.name]));
    return source.map((s) => ({
      source: s.name,
      target: exact.get(s.name) ?? ci.get(s.name.toLowerCase()) ?? nm.get(norm(s.name)) ?? null,
    }));
  }

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
      tableMappings?: Array<{ source: string; target: string }>;
      columnMappings?: Array<{ table: string; columns: Array<{ source: string; target: string }> }>;
      addColumns?: Array<{ table: string; columns: string[] }>;
      createMissingColumns?: boolean;
      rowFilters?: Array<{ table: string; where: string }>;
      incremental?: Array<{ table: string; column: string }>;
      transforms?: Array<{ table: string; columns: ColumnTransform[] }>;
    },
  ): Promise<{ sql: string; truncated: boolean; rowsIncluded: number }> {
    for (const f of dto.rowFilters ?? []) this.assertSafeFilter(f.where);
    const source = await this.load(dto.sourceConnectionId, workspaceId);
    const target = await this.load(dto.targetConnectionId, workspaceId);
    const engine = this.assertSameEngine(source, target);
    const driver = createMigrationDriver(
      engine,
      this.connOf(source),
      this.connOf(target),
    );
    await driver.openSource();

    // Some script steps must introspect the live target — adding missing columns
    // and computing an incremental watermark — so open it only when needed.
    const needTarget =
      (!dto.createTables &&
        (dto.createMissingColumns !== false || (dto.addColumns?.length ?? 0) > 0)) ||
      (dto.incremental?.length ?? 0) > 0;
    if (needTarget) await driver.openTarget();

    try {
      const ordered = await this.orderTables(driver, dto.tables);
      const targetOf = this.targetMapper(dto.tableMappings);
      const colMapOf = this.columnMapper(dto.columnMappings);
      const addColsOf = this.addColumnsMapper(dto.addColumns);
      const rowFilterOf = this.rowFilterMapper(dto.rowFilters);
      const incrementalOf = this.incrementalMapper(dto.incremental);
      const txOf = this.transformsMapper(dto.transforms);
      const parts: string[] = driver.scriptHeader(source.name, source.databaseName);
      let rowsIncluded = 0;
      let truncated = false;

      for (const table of ordered) {
        this.assertIdent(table);
        const target = targetOf(table);
        this.assertIdent(target);
        if (dto.createTables) {
          parts.push(...(await driver.scriptCreateTable(table, target)));
        } else if (needTarget) {
          // Target assumed to exist — add missing columns before the inserts.
          const add = addColsOf(table);
          if (add?.length) {
            add.forEach((c) => this.assertIdent(c));
            parts.push(...(await driver.scriptAddColumns(table, target, add)));
          } else if (dto.createMissingColumns !== false && !colMapOf(table)) {
            parts.push(...(await driver.scriptAddColumns(table, target)));
          }
        }
        if (dto.conflict === 'truncate') {
          parts.push(driver.scriptTruncate(target));
        }
        const where = needTarget
          ? await this.combineWhere(driver, target, rowFilterOf(table), incrementalOf(table))
          : rowFilterOf(table); // incremental needs the target; row filter doesn't
        const ins = await driver.scriptInserts(table, dto.conflict, SCRIPT_ROW_CAP, target, {
          columns: colMapOf(table),
          where,
          transforms: txOf(table),
        });
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
      tableMappings?: Array<{ source: string; target: string }>;
      columnMappings?: Array<{ table: string; columns: Array<{ source: string; target: string }> }>;
      addColumns?: Array<{ table: string; columns: string[] }>;
      createMissingColumns?: boolean;
      rowFilters?: Array<{ table: string; where: string }>;
      incremental?: Array<{ table: string; column: string }>;
      transforms?: Array<{ table: string; columns: ColumnTransform[] }>;
    },
    res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    // Reject unsafe row filters before doing any work.
    const badFilter = (dto.rowFilters ?? []).find((f) => !this.isSafeFilter(f.where));
    if (badFilter) {
      send('error', {
        message: `Invalid row filter for "${badFilter.table}" — use a single boolean expression (no ";" or SQL comments).`,
      });
      res.end();
      return;
    }

    // Pre-flight validation gate: never start if a BLOCKER is present.
    if (!dto.skipValidation) {
      try {
        const blockers = await this.validation.hasBlockingIssues(workspaceId, {
          sourceConnectionId: dto.sourceConnectionId,
          targetConnectionId: dto.targetConnectionId,
          tables: dto.tables,
          mode: dto.conflict === 'truncate' ? 'overwrite' : 'append',
          tableMappings: dto.tableMappings,
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
      const targetOf = this.targetMapper(dto.tableMappings);
      const colMapOf = this.columnMapper(dto.columnMappings);
      const addColsOf = this.addColumnsMapper(dto.addColumns);
      const rowFilterOf = this.rowFilterMapper(dto.rowFilters);
      const incrementalOf = this.incrementalMapper(dto.incremental);
      const txOf = this.transformsMapper(dto.transforms);
      const targetExisting = new Set(
        (await driver.targetBaseTables()).map((t) => t.name),
      );

      for (const table of ordered) {
        this.assertIdent(table);
        const target = targetOf(table);
        this.assertIdent(target);
        send('table', { table, status: 'start' });
        try {
          if (!targetExisting.has(target)) {
            if (dto.createTables) {
              await driver.createTableOnTarget(table, target);
              send('table', { table, status: 'created' });
            }
          } else {
            // Existing target — add missing columns before copy.
            const add = addColsOf(table);
            if (add?.length) {
              // Explicit per-column choices (from the mapping UI).
              add.forEach((c) => this.assertIdent(c));
              const added = await driver.addColumnsToTarget(table, target, add);
              if (added.length) send('table', { table, status: 'altered', columns: added });
            } else if (dto.createMissingColumns && !colMapOf(table)) {
              // Default: auto-create every source column missing on the target,
              // unless the user has explicitly mapped this table's columns.
              const added = await driver.addColumnsToTarget(table, target);
              if (added.length) send('table', { table, status: 'altered', columns: added });
            }
          }
          if (dto.conflict === 'truncate') {
            await driver.truncateTarget(target);
          }

          const where = await this.combineWhere(
            driver,
            target,
            rowFilterOf(table),
            incrementalOf(table),
          );
          const copied = await driver.copyTable(
            table,
            dto.conflict,
            (n, total) => send('progress', { table, copied: n, total }),
            target,
            { columns: colMapOf(table), where, transforms: txOf(table) },
          );

          const sourceRows = await driver.sourceCount(table);
          const targetRows = await driver.targetCount(target);
          report.push({ table, copied, sourceRows, targetRows, status: 'done' });
          send('table', { table, status: 'done', copied, sourceRows, targetRows, target });
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

  /** Build a source→target resolver from optional table mappings (identity by default). */
  private targetMapper(
    mappings?: Array<{ source: string; target: string }>,
  ): (table: string) => string {
    const map = new Map((mappings ?? []).map((m) => [m.source, m.target]));
    return (table: string) => map.get(table) ?? table;
  }

  /** Resolve a source table's explicit column map (undefined = copy all by name). */
  private columnMapper(
    mappings?: Array<{ table: string; columns: Array<{ source: string; target: string }> }>,
  ): (table: string) => Array<{ source: string; target: string }> | undefined {
    const map = new Map((mappings ?? []).map((m) => [m.table, m.columns]));
    return (table: string) => {
      const cols = map.get(table);
      return cols && cols.length > 0 ? cols : undefined;
    };
  }

  /** Resolve a source table's "create these missing columns on target" list. */
  private addColumnsMapper(
    addColumns?: Array<{ table: string; columns: string[] }>,
  ): (table: string) => string[] | undefined {
    const map = new Map((addColumns ?? []).map((a) => [a.table, a.columns]));
    return (table: string) => {
      const cols = map.get(table);
      return cols && cols.length > 0 ? cols : undefined;
    };
  }

  /** Resolve a source table's row-filter WHERE fragment (validated). */
  private rowFilterMapper(
    filters?: Array<{ table: string; where: string }>,
  ): (table: string) => string | undefined {
    const map = new Map((filters ?? []).map((f) => [f.table, f.where]));
    return (table: string) => {
      const w = map.get(table)?.trim();
      if (!w) return undefined;
      this.assertSafeFilter(w);
      return w;
    };
  }

  /** Resolve a source table's per-column transforms. */
  private transformsMapper(
    transforms?: Array<{
      table: string;
      columns: Array<{ column: string; op: ColumnTransform['op']; value?: string }>;
    }>,
  ): (table: string) => ColumnTransform[] | undefined {
    const map = new Map((transforms ?? []).map((t) => [t.table, t.columns]));
    return (table: string) => {
      const cols = map.get(table);
      return cols && cols.length > 0 ? cols : undefined;
    };
  }

  /** Resolve a source table's incremental watermark column. */
  private incrementalMapper(
    incremental?: Array<{ table: string; column: string }>,
  ): (table: string) => string | undefined {
    const map = new Map((incremental ?? []).map((i) => [i.table, i.column]));
    return (table: string) => map.get(table) || undefined;
  }

  /** A user WHERE fragment is safe if it's a single expression (no stacking/comments). */
  private isSafeFilter(where: string): boolean {
    return where.trim().length > 0 && where.length <= 2000 && !/;|--|\/\*|\*\//.test(where);
  }

  /** Guard a user-supplied WHERE fragment: no statement-stacking or comments. */
  private assertSafeFilter(where: string): void {
    if (!this.isSafeFilter(where)) {
      throw new BadRequestException(
        'Row filter must be a single boolean expression (no ";" or SQL comments).',
      );
    }
  }

  /** Combine a row filter and an incremental predicate into one WHERE fragment. */
  private async combineWhere(
    driver: MigrationDriver,
    targetTable: string,
    rowFilter: string | undefined,
    incrementalColumn: string | undefined,
  ): Promise<string | undefined> {
    const parts: string[] = [];
    if (rowFilter) parts.push(`(${rowFilter})`);
    if (incrementalColumn) {
      this.assertIdent(incrementalColumn);
      const pred = await driver.incrementalPredicate(targetTable, incrementalColumn);
      if (pred) parts.push(`(${pred})`);
    }
    return parts.length ? parts.join(' AND ') : undefined;
  }

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
