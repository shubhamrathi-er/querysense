import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  createPool,
  type SqlClient,
  type SqlExecutor,
  buildSshConfig,
} from '../common/db/mysql-pool';
import { DbEngine, normalizeEngine } from '../common/db/engine';
import { CsvDialect, csvDialect } from './csv-import-dialect';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ConnectionsService } from './connections.service';
import { CsvImportDto } from './dto/csv-import.dto';

export interface ImportTargetColumn {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isAutoIncrement: boolean;
  hasDefault: boolean;
  /** No default, not nullable, not auto-increment → a value must be supplied. */
  isRequired: boolean;
}

export interface ImportTargetTable {
  tableName: string;
  columns: ImportTargetColumn[];
}

export interface CsvImportResult {
  tableName: string;
  mode: 'existing' | 'new';
  tableCreated: boolean;
  /** Columns added to an existing table because the CSV introduced them. */
  columnsAdded: string[];
  rowsInserted: number;
  /** Rows skipped as duplicates of the chosen unique keys. */
  rowsSkipped: number;
  rowsFailed: number;
  errors: string[];
}

/** Per-request context: the live client and the engine's DDL dialect. */
interface ImportCtx {
  client: SqlClient;
  d: CsvDialect;
  engine: DbEngine;
  databaseName: string;
}

const INSERT_CHUNK_SIZE = 500;

@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private connectionsService: ConnectionsService,
  ) {}

  private async openCtx(
    connectionId: string,
    workspaceId: string,
  ): Promise<ImportCtx> {
    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException('Connection not found');

    const engine = normalizeEngine(connection.engine);
    const client = await createPool(engine, {
      host: connection.host,
      port: connection.port,
      database: connection.databaseName,
      user: connection.username,
      password: this.encryption.decrypt(connection.encryptedPassword),
      ssl: connection.sslEnabled,
      ssh: buildSshConfig(connection, (s) => this.encryption.decrypt(s)),
      connectionLimit: 3,
      connectTimeout: 10000,
    });

    return {
      client,
      engine,
      d: csvDialect(engine),
      databaseName: connection.databaseName,
    };
  }

  /**
   * Live introspection of base tables (not views) so the UI can show the user
   * exactly which columns exist and which are required for an insert.
   */
  async getImportTargets(
    connectionId: string,
    workspaceId: string,
  ): Promise<ImportTargetTable[]> {
    const ctx = await this.openCtx(connectionId, workspaceId);

    try {
      const rows =
        ctx.engine === 'postgres'
          ? await this.pgImportTargets(ctx)
          : await this.mysqlImportTargets(ctx);

      const byTable = new Map<string, ImportTargetColumn[]>();
      for (const col of rows) {
        const list = byTable.get(col.tableName) ?? [];
        list.push(col.column);
        byTable.set(col.tableName, list);
      }

      return [...byTable.entries()].map(([tableName, columns]) => ({
        tableName,
        columns,
      }));
    } finally {
      await ctx.client.cleanup();
    }
  }

  private async mysqlImportTargets(ctx: ImportCtx) {
    const rows = await ctx.client.query<Record<string, unknown>>(
      `
      SELECT
        c.TABLE_NAME      AS tableName,
        c.COLUMN_NAME     AS columnName,
        c.COLUMN_TYPE     AS columnType,
        c.IS_NULLABLE     AS isNullable,
        c.COLUMN_DEFAULT  AS columnDefault,
        c.EXTRA           AS extra
      FROM information_schema.COLUMNS c
      JOIN information_schema.TABLES t
        ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
       AND t.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = ?
        AND t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
      `,
      [ctx.databaseName],
    );
    return rows.map((r) => {
      const isNullable = String(r['isNullable']).toUpperCase() === 'YES';
      const extra = String(r['extra'] ?? '').toLowerCase();
      const isAutoIncrement = extra.includes('auto_increment');
      const hasDefault =
        r['columnDefault'] !== null || extra.includes('default_generated');
      return {
        tableName: String(r['tableName']),
        column: {
          columnName: String(r['columnName']),
          dataType: String(r['columnType']),
          isNullable,
          isAutoIncrement,
          hasDefault,
          isRequired: !isNullable && !hasDefault && !isAutoIncrement,
        } satisfies ImportTargetColumn,
      };
    });
  }

  private async pgImportTargets(ctx: ImportCtx) {
    const rows = await ctx.client.query<Record<string, unknown>>(
      `
      SELECT
        c.table_name AS "tableName",
        c.column_name AS "columnName",
        c.data_type AS "dataType",
        c.character_maximum_length AS "charLen",
        c.is_nullable AS "isNullable",
        c.column_default AS "columnDefault",
        c.is_identity AS "isIdentity"
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = current_schema()
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
      `,
    );
    return rows.map((r) => {
      const isNullable = String(r['isNullable']).toUpperCase() === 'YES';
      const def = r['columnDefault'];
      const isAutoIncrement =
        String(r['isIdentity'] ?? '').toUpperCase() === 'YES' ||
        /nextval\(/i.test(String(def ?? ''));
      const hasDefault = def !== null || isAutoIncrement;
      const charLen = r['charLen'];
      const dataType =
        charLen !== null && charLen !== undefined
          ? `${String(r['dataType'])}(${Number(charLen)})`
          : String(r['dataType']);
      return {
        tableName: String(r['tableName']),
        column: {
          columnName: String(r['columnName']),
          dataType,
          isNullable,
          isAutoIncrement,
          hasDefault,
          isRequired: !isNullable && !hasDefault && !isAutoIncrement,
        } satisfies ImportTargetColumn,
      };
    });
  }

  async importCsv(
    connectionId: string,
    workspaceId: string,
    dto: CsvImportDto,
  ): Promise<CsvImportResult> {
    if (dto.columns.length === 0) {
      throw new BadRequestException('At least one column mapping is required.');
    }

    const ctx = await this.openCtx(connectionId, workspaceId);

    // Validate identifiers up-front so we fail before touching the DB.
    const escTable = ctx.d.ident(dto.tableName);
    for (const m of dto.columns) {
      ctx.d.ident(m.dbColumn);
    }

    // Guard against duplicate target columns.
    const dbColumns = dto.columns.map((c) => c.dbColumn);
    if (new Set(dbColumns).size !== dbColumns.length) {
      throw new BadRequestException(
        'The same target column is mapped more than once.',
      );
    }

    let tableCreated = false;
    let columnsAdded: string[] = [];

    try {
      if (dto.mode === 'new') {
        await this.createTable(ctx, escTable, dto);
        tableCreated = true;
      } else {
        columnsAdded = await this.prepareExistingTable(ctx, escTable, dto);
      }

      // Skip rows that already exist (by the chosen unique keys) before inserting.
      let rowsToInsert = dto.rows;
      let rowsSkipped = 0;
      if (dto.mode === 'existing' && dto.uniqueKeys && dto.uniqueKeys.length) {
        const filtered = await this.filterDuplicates(
          ctx,
          escTable,
          dto,
          dto.uniqueKeys,
        );
        rowsToInsert = filtered.rows;
        rowsSkipped = filtered.skipped;
      }

      // All-or-nothing: every batch inserts inside one transaction. If any batch
      // fails the whole transaction is rolled back — no partial data lands.
      const rowsInserted = await this.insertRowsAtomic(
        ctx,
        escTable,
        dto,
        rowsToInsert,
      );

      this.logger.log(
        `CSV import into ${dto.tableName}: ${rowsInserted} inserted, ${rowsSkipped} skipped` +
          (columnsAdded.length
            ? `, added columns: ${columnsAdded.join(', ')}`
            : ''),
      );

      return {
        tableName: dto.tableName,
        mode: dto.mode,
        tableCreated,
        columnsAdded,
        rowsInserted,
        rowsSkipped,
        rowsFailed: 0,
        errors: [],
      };
    } catch (err) {
      // The data transaction already rolled back. DDL (CREATE/ALTER) ran outside
      // a transaction, so undo it explicitly to leave the database exactly as it
      // was before the import.
      await this.revertSchemaChanges(ctx, escTable, tableCreated, columnsAdded);
      throw err;
    } finally {
      await ctx.client.cleanup();
      // Refresh stored schema metadata so the new/updated table is queryable
      // in chat right away. Best-effort — never fail the import on a sync error.
      try {
        await this.connectionsService.syncSchema(connectionId, workspaceId);
      } catch (err) {
        this.logger.warn(
          `Schema re-sync after CSV import failed: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
  }

  /** Undo CREATE TABLE / ADD COLUMN done earlier in a now-failed import. */
  private async revertSchemaChanges(
    ctx: ImportCtx,
    escTable: string,
    tableCreated: boolean,
    columnsAdded: string[],
  ): Promise<void> {
    try {
      if (tableCreated) {
        await ctx.client.query(`DROP TABLE IF EXISTS ${escTable}`);
      } else if (columnsAdded.length) {
        for (const col of columnsAdded) {
          await ctx.client.query(
            `ALTER TABLE ${escTable} DROP COLUMN ${ctx.d.ident(col)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to revert schema after import error: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  private async createTable(
    ctx: ImportCtx,
    escTable: string,
    dto: CsvImportDto,
  ): Promise<void> {
    const exists = await ctx.client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = ${ctx.d.currentSchemaExpr()} AND table_name = ${this.ph(ctx, 1)} LIMIT 1`,
      [dto.tableName],
    );
    if (exists.length > 0) {
      throw new ConflictException(
        `Table "${dto.tableName}" already exists. Choose a different name or insert into the existing table.`,
      );
    }

    // If the data already carries its own `id` column, don't inject a synthetic
    // one (that would be a duplicate column name). Promote an integer `id` to the
    // primary key; otherwise leave it as a regular column.
    const idColumn = dto.columns.find((m) => m.dbColumn.toLowerCase() === 'id');
    const idIsInteger =
      !!idColumn &&
      ['INT', 'BIGINT'].includes((idColumn.dbType ?? '').toUpperCase());

    const colDefs = dto.columns.map((m) => {
      const canonical = (m.dbType ?? 'TEXT').toUpperCase();
      if (!ctx.d.isAllowedType(canonical)) {
        throw new BadRequestException(
          `Unsupported column type "${m.dbType}" for column "${m.dbColumn}".`,
        );
      }
      const type = ctx.d.sqlType(canonical);
      if (m.dbColumn.toLowerCase() === 'id' && idIsInteger) {
        return `${ctx.d.ident(m.dbColumn)} ${type} NOT NULL PRIMARY KEY`;
      }
      return `${ctx.d.ident(m.dbColumn)} ${type} NULL`;
    });

    const lines: string[] = [];
    if (!idColumn) {
      // No id in the data — add an auto-increment surrogate key.
      lines.push(`  ${ctx.d.surrogateKeyDef()}`);
    }
    lines.push(...colDefs.map((d) => `  ${d}`));

    const createSql =
      `CREATE TABLE ${escTable} (\n` +
      lines.join(',\n') +
      `\n)${ctx.d.createTableTail()}`;

    await ctx.client.query(createSql);
  }

  /**
   * Validate the mapping against an existing table and, for any mapped column
   * the CSV introduces that the table doesn't have yet, add it via ALTER TABLE.
   * A mapping entry targeting a missing column MUST carry a `dbType` (that's the
   * UI's signal that the user opted to add it). Returns the columns added.
   */
  private async prepareExistingTable(
    ctx: ImportCtx,
    escTable: string,
    dto: CsvImportDto,
  ): Promise<string[]> {
    const cols = await ctx.client.query<Record<string, unknown>>(
      `SELECT column_name AS "columnName", is_nullable AS "isNullable",
              column_default AS "columnDefault", ${this.identityExpr(ctx)} AS "isAuto"
       FROM information_schema.columns
       WHERE table_schema = ${ctx.d.currentSchemaExpr()} AND table_name = ${this.ph(ctx, 1)}`,
      [dto.tableName],
    );

    if (cols.length === 0) {
      throw new NotFoundException(
        `Table "${dto.tableName}" does not exist in this database.`,
      );
    }

    const existingNames = new Set(cols.map((c) => String(c['columnName'])));

    // Add any mapped columns that don't exist yet (new columns from the CSV).
    const columnsAdded: string[] = [];
    for (const m of dto.columns) {
      if (existingNames.has(m.dbColumn)) continue;

      const canonical = (m.dbType ?? '').toUpperCase();
      if (!ctx.d.isAllowedType(canonical)) {
        throw new BadRequestException(
          `Column "${m.dbColumn}" does not exist in table "${dto.tableName}". ` +
            `Provide a valid type to add it, or remove it from the mapping.`,
        );
      }

      // New columns are nullable so existing rows remain valid.
      await ctx.client.query(
        `ALTER TABLE ${escTable} ADD COLUMN ${ctx.d.ident(m.dbColumn)} ${ctx.d.sqlType(canonical)} NULL`,
      );
      existingNames.add(m.dbColumn);
      columnsAdded.push(m.dbColumn);
    }

    // Every pre-existing required column (NOT NULL, no default, not auto-increment)
    // must be mapped. Newly-added columns are nullable, so never required.
    const mapped = new Set(dto.columns.map((c) => c.dbColumn));
    for (const c of cols) {
      const name = String(c['columnName']);
      const isNullable = String(c['isNullable']).toUpperCase() === 'YES';
      const hasDefault = c['columnDefault'] !== null;
      const isAutoIncrement = this.isAutoFlag(ctx, c['isAuto']);
      const required = !isNullable && !hasDefault && !isAutoIncrement;

      if (required && !mapped.has(name)) {
        throw new BadRequestException(
          `Required column "${name}" is not mapped to any CSV column.`,
        );
      }
    }

    return columnsAdded;
  }

  /**
   * Drop rows whose unique-key tuple already exists in the table, or that
   * repeat an earlier row in the same file. Keys are matched on the CSV values
   * mapped to the chosen DB key columns.
   */
  private async filterDuplicates(
    ctx: ImportCtx,
    escTable: string,
    dto: CsvImportDto,
    uniqueKeys: string[],
  ): Promise<{ rows: Record<string, string | null>[]; skipped: number }> {
    // Map each chosen DB key column back to its source CSV column.
    const keyMap = uniqueKeys.map((dbColumn) => {
      const m = dto.columns.find((c) => c.dbColumn === dbColumn);
      if (!m) {
        throw new BadRequestException(
          `Unique key "${dbColumn}" is not part of the column mapping.`,
        );
      }
      return { dbColumn, csvColumn: m.csvColumn };
    });

    const norm = (v: string | null | undefined): string | null => {
      if (v === undefined || v === null) return null;
      const s = typeof v === 'string' ? v : String(v);
      return s.trim() === '' ? null : s;
    };
    const tupleOf = (row: Record<string, string | null>): (string | null)[] =>
      keyMap.map((k) => norm(row[k.csvColumn]));

    // Distinct key tuples present in the CSV — only these need an existence check.
    const csvTuples = new Map<string, (string | null)[]>();
    for (const row of dto.rows) {
      const t = tupleOf(row);
      csvTuples.set(JSON.stringify(t), t);
    }

    // Query which of those tuples already exist. NULLs never match in SQL, so
    // tuples containing a NULL key are not worth querying.
    const escKeyCols = keyMap.map((k) => ctx.d.ident(k.dbColumn));
    const existing = new Set<string>();
    const queryable = [...csvTuples.values()].filter((t) =>
      t.every((v) => v !== null),
    );

    const CHUNK = 1000;
    for (let i = 0; i < queryable.length; i += CHUNK) {
      const chunk = queryable.slice(i, i + CHUNK);
      const selectCols = escKeyCols
        .map((c, idx) => `${c} AS k${idx}`)
        .join(', ');

      const { whereSql, params } = this.buildKeyExistence(
        ctx,
        escKeyCols,
        chunk,
      );
      const sql = `SELECT ${selectCols} FROM ${escTable} WHERE ${whereSql}`;

      const found = await ctx.client.query<Record<string, unknown>>(sql, params);
      for (const r of found) {
        const tuple = escKeyCols.map((_, idx) => {
          const v = r[`k${idx}`];
          return v === null || v === undefined ? null : String(v);
        });
        existing.add(JSON.stringify(tuple));
      }
    }

    // Keep rows whose key is neither already in the DB nor seen earlier in the file.
    const seen = new Set<string>();
    const rows: Record<string, string | null>[] = [];
    let skipped = 0;
    for (const row of dto.rows) {
      const key = JSON.stringify(tupleOf(row));
      if (existing.has(key) || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      rows.push(row);
    }

    return { rows, skipped };
  }

  /**
   * Insert every batch inside a single transaction. If any batch fails, the
   * whole transaction is rolled back so the table ends up with no new rows.
   * Returns the number of rows inserted (all of them, on success).
   */
  private async insertRowsAtomic(
    ctx: ImportCtx,
    escTable: string,
    dto: CsvImportDto,
    rows: Record<string, string | null>[],
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const escCols = dto.columns.map((m) => ctx.d.ident(m.dbColumn));
    const toRowValues = (row: Record<string, string | null>): unknown[] =>
      dto.columns.map((m) => {
        const raw = row[m.csvColumn];
        // Treat empty / whitespace-only cells as NULL.
        if (raw === undefined || raw === null) return null;
        if (typeof raw === 'string' && raw.trim() === '') return null;
        return raw;
      });

    return ctx.client.transaction(async (tx: SqlExecutor) => {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
        try {
          await tx.bulkInsert(escTable, escCols, chunk.map(toRowValues));
          inserted += chunk.length;
        } catch (chunkErr) {
          const detail =
            chunkErr instanceof Error ? chunkErr.message : 'insert failed';
          // MySQL lets us keep probing in the same transaction to pinpoint the
          // bad row (the probe rows are discarded by the rollback). Postgres
          // aborts the transaction on the first error, so we can only report the
          // chunk range there.
          let rowNum = i + 1;
          if (ctx.engine === 'mysql') {
            for (let j = 0; j < chunk.length; j++) {
              try {
                await tx.bulkInsert(escTable, escCols, [toRowValues(chunk[j])]);
              } catch {
                rowNum = i + j + 1;
                break;
              }
            }
          }
          throw new BadRequestException(
            `Import aborted at row ${rowNum}: ${detail}. No rows were inserted.`,
          );
        }
      }
      return inserted;
    });
  }

  // ─── small dialect helpers ───────────────────────────────

  /** Positional placeholder for the engine (`?` for MySQL, `$n` for Postgres). */
  private ph(ctx: ImportCtx, n: number): string {
    return ctx.engine === 'postgres' ? `$${n}` : '?';
  }

  /** information_schema expression that reveals an auto-increment/identity column. */
  private identityExpr(ctx: ImportCtx): string {
    return ctx.engine === 'postgres' ? 'is_identity' : 'extra';
  }

  private isAutoFlag(ctx: ImportCtx, value: unknown): boolean {
    if (ctx.engine === 'postgres') {
      return String(value ?? '').toUpperCase() === 'YES';
    }
    return String(value ?? '')
      .toLowerCase()
      .includes('auto_increment');
  }

  /** Build the WHERE clause + params that test which key tuples already exist. */
  private buildKeyExistence(
    ctx: ImportCtx,
    escKeyCols: string[],
    chunk: (string | null)[][],
  ): { whereSql: string; params: unknown[] } {
    if (ctx.engine === 'mysql') {
      // mysql2 expands a nested array for IN (?).
      if (escKeyCols.length === 1) {
        return {
          whereSql: `${escKeyCols[0]} IN (?)`,
          params: [chunk.map((t) => t[0])],
        };
      }
      return {
        whereSql: `(${escKeyCols.join(', ')}) IN (?)`,
        params: [chunk],
      };
    }

    // Postgres: explicit positional placeholders.
    const width = escKeyCols.length;
    if (width === 1) {
      const placeholders = chunk.map((_, i) => `$${i + 1}`).join(', ');
      return {
        whereSql: `${escKeyCols[0]} IN (${placeholders})`,
        params: chunk.map((t) => t[0]),
      };
    }
    const tuples = chunk
      .map(
        (_, ri) =>
          `(${escKeyCols.map((__, ci) => `$${ri * width + ci + 1}`).join(', ')})`,
      )
      .join(', ');
    return {
      whereSql: `(${escKeyCols.join(', ')}) IN (${tuples})`,
      params: chunk.flat(),
    };
  }
}
