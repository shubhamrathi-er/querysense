import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { createMysqlPool, buildSshConfig } from '../common/db/mysql-pool';
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

/** MySQL types we permit when creating a brand-new table from a CSV. */
const ALLOWED_NEW_TYPES = new Set<string>([
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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INSERT_CHUNK_SIZE = 500;

@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private connectionsService: ConnectionsService,
  ) {}

  /** Escape and validate a SQL identifier (table or column name). */
  private ident(name: string): string {
    if (!IDENTIFIER.test(name)) {
      throw new BadRequestException(
        `Invalid identifier "${name}". Use letters, numbers and underscores only.`,
      );
    }
    return `\`${name}\``;
  }

  private async createPool(connectionId: string, workspaceId: string) {
    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException('Connection not found');

    const { pool, cleanup } = await createMysqlPool({
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

    return { pool, cleanup, databaseName: connection.databaseName };
  }

  /**
   * Live introspection of base tables (not views) so the UI can show the user
   * exactly which columns exist and which are required for an insert.
   */
  async getImportTargets(
    connectionId: string,
    workspaceId: string,
  ): Promise<ImportTargetTable[]> {
    const { pool, cleanup, databaseName } = await this.createPool(
      connectionId,
      workspaceId,
    );

    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
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
        [databaseName],
      );

      const byTable = new Map<string, ImportTargetColumn[]>();
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        const tableName = String(r['tableName']);
        const isNullable = String(r['isNullable']).toUpperCase() === 'YES';
        const extra = String(r['extra'] ?? '').toLowerCase();
        const isAutoIncrement = extra.includes('auto_increment');
        const hasDefault =
          r['columnDefault'] !== null || extra.includes('default_generated');

        const col: ImportTargetColumn = {
          columnName: String(r['columnName']),
          dataType: String(r['columnType']),
          isNullable,
          isAutoIncrement,
          hasDefault,
          isRequired: !isNullable && !hasDefault && !isAutoIncrement,
        };

        const list = byTable.get(tableName) ?? [];
        list.push(col);
        byTable.set(tableName, list);
      }

      return [...byTable.entries()].map(([tableName, columns]) => ({
        tableName,
        columns,
      }));
    } finally {
      await cleanup();
    }
  }

  async importCsv(
    connectionId: string,
    workspaceId: string,
    dto: CsvImportDto,
  ): Promise<CsvImportResult> {
    if (dto.columns.length === 0) {
      throw new BadRequestException('At least one column mapping is required.');
    }

    // Validate identifiers up-front so we fail before touching the DB.
    const escTable = this.ident(dto.tableName);
    for (const m of dto.columns) {
      this.ident(m.dbColumn);
    }

    // Guard against duplicate target columns.
    const dbColumns = dto.columns.map((c) => c.dbColumn);
    if (new Set(dbColumns).size !== dbColumns.length) {
      throw new BadRequestException(
        'The same target column is mapped more than once.',
      );
    }

    const { pool, cleanup } = await this.createPool(connectionId, workspaceId);
    let tableCreated = false;
    let columnsAdded: string[] = [];

    try {
      if (dto.mode === 'new') {
        await this.createTable(pool, escTable, dto);
        tableCreated = true;
      } else {
        columnsAdded = await this.prepareExistingTable(pool, escTable, dto);
      }

      // Skip rows that already exist (by the chosen unique keys) before inserting.
      let rowsToInsert = dto.rows;
      let rowsSkipped = 0;
      if (dto.mode === 'existing' && dto.uniqueKeys && dto.uniqueKeys.length) {
        const filtered = await this.filterDuplicates(
          pool,
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
        pool,
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
      // The data transaction already rolled back. DDL (CREATE/ALTER) auto-commits
      // in MySQL and can't be rolled back, so undo it explicitly to leave the
      // database exactly as it was before the import.
      await this.revertSchemaChanges(pool, escTable, tableCreated, columnsAdded);
      throw err;
    } finally {
      await cleanup();
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
    pool: mysql.Pool,
    escTable: string,
    tableCreated: boolean,
    columnsAdded: string[],
  ): Promise<void> {
    try {
      if (tableCreated) {
        await pool.query(`DROP TABLE IF EXISTS ${escTable}`);
      } else if (columnsAdded.length) {
        for (const col of columnsAdded) {
          await pool.query(
            `ALTER TABLE ${escTable} DROP COLUMN ${this.ident(col)}`,
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
    pool: mysql.Pool,
    escTable: string,
    dto: CsvImportDto,
  ): Promise<void> {
    const [existing] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
      [dto.tableName],
    );
    if (existing.length > 0) {
      throw new ConflictException(
        `Table "${dto.tableName}" already exists. Choose a different name or insert into the existing table.`,
      );
    }

    // If the data already carries its own `id` column, don't inject a synthetic
    // one (that would be a duplicate column name). Promote an integer `id` to the
    // primary key; otherwise leave it as a regular column.
    const idColumn = dto.columns.find(
      (m) => m.dbColumn.toLowerCase() === 'id',
    );
    const idIsInteger =
      !!idColumn &&
      ['INT', 'BIGINT'].includes((idColumn.dbType ?? '').toUpperCase());

    const colDefs = dto.columns.map((m) => {
      const type = (m.dbType ?? 'TEXT').toUpperCase();
      if (!ALLOWED_NEW_TYPES.has(type)) {
        throw new BadRequestException(
          `Unsupported column type "${m.dbType}" for column "${m.dbColumn}".`,
        );
      }
      if (m.dbColumn.toLowerCase() === 'id' && idIsInteger) {
        return `${this.ident(m.dbColumn)} ${type} NOT NULL PRIMARY KEY`;
      }
      return `${this.ident(m.dbColumn)} ${type} NULL`;
    });

    const lines: string[] = [];
    if (!idColumn) {
      // No id in the data — add an auto-increment surrogate key.
      lines.push('  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY');
    }
    lines.push(...colDefs.map((d) => `  ${d}`));

    const createSql =
      `CREATE TABLE ${escTable} (\n` +
      lines.join(',\n') +
      `\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

    await pool.query(createSql);
  }

  /**
   * Validate the mapping against an existing table and, for any mapped column
   * the CSV introduces that the table doesn't have yet, add it via ALTER TABLE.
   * A mapping entry targeting a missing column MUST carry a `dbType` (that's the
   * UI's signal that the user opted to add it). Returns the columns added.
   */
  private async prepareExistingTable(
    pool: mysql.Pool,
    escTable: string,
    dto: CsvImportDto,
  ): Promise<string[]> {
    const [cols] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS columnName, IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS columnDefault, EXTRA AS extra
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [dto.tableName],
    );

    if (cols.length === 0) {
      throw new NotFoundException(
        `Table "${dto.tableName}" does not exist in this database.`,
      );
    }

    const existingNames = new Set(
      cols.map((c) => String((c as Record<string, unknown>)['columnName'])),
    );

    // Add any mapped columns that don't exist yet (new columns from the CSV).
    const columnsAdded: string[] = [];
    for (const m of dto.columns) {
      if (existingNames.has(m.dbColumn)) continue;

      const type = (m.dbType ?? '').toUpperCase();
      if (!ALLOWED_NEW_TYPES.has(type)) {
        throw new BadRequestException(
          `Column "${m.dbColumn}" does not exist in table "${dto.tableName}". ` +
            `Provide a valid type to add it, or remove it from the mapping.`,
        );
      }

      // New columns are nullable so existing rows remain valid.
      await pool.query(
        `ALTER TABLE ${escTable} ADD COLUMN ${this.ident(m.dbColumn)} ${type} NULL`,
      );
      existingNames.add(m.dbColumn);
      columnsAdded.push(m.dbColumn);
    }

    // Every pre-existing required column (NOT NULL, no default, not auto-increment)
    // must be mapped. Newly-added columns are nullable, so never required.
    const mapped = new Set(dto.columns.map((c) => c.dbColumn));
    for (const c of cols) {
      const r = c as Record<string, unknown>;
      const name = String(r['columnName']);
      const isNullable = String(r['isNullable']).toUpperCase() === 'YES';
      const extra = String(r['extra'] ?? '').toLowerCase();
      const hasDefault =
        r['columnDefault'] !== null || extra.includes('default_generated');
      const isAutoIncrement = extra.includes('auto_increment');
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
    pool: mysql.Pool,
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
    const escKeyCols = keyMap.map((k) => this.ident(k.dbColumn));
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

      let sql: string;
      let params: unknown[];
      if (escKeyCols.length === 1) {
        sql = `SELECT ${selectCols} FROM ${escTable} WHERE ${escKeyCols[0]} IN (?)`;
        params = [chunk.map((t) => t[0])];
      } else {
        sql = `SELECT ${selectCols} FROM ${escTable} WHERE (${escKeyCols.join(
          ', ',
        )}) IN (?)`;
        params = [chunk];
      }

      const [found] = await pool.query<mysql.RowDataPacket[]>(sql, params);
      for (const fr of found) {
        const r = fr as Record<string, unknown>;
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
    pool: mysql.Pool,
    escTable: string,
    dto: CsvImportDto,
    rows: Record<string, string | null>[],
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const escCols = dto.columns.map((m) => this.ident(m.dbColumn));
    const insertSql = `INSERT INTO ${escTable} (${escCols.join(', ')}) VALUES ?`;

    const toRowValues = (row: Record<string, string | null>): unknown[] =>
      dto.columns.map((m) => {
        const raw = row[m.csvColumn];
        // Treat empty / whitespace-only cells as NULL.
        if (raw === undefined || raw === null) return null;
        if (typeof raw === 'string' && raw.trim() === '') return null;
        return raw;
      });

    // A transaction must run on a single dedicated connection, not the pool.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let inserted = 0;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
        try {
          await conn.query(insertSql, [chunk.map(toRowValues)]);
          inserted += chunk.length;
        } catch (chunkErr) {
          // Pinpoint the offending row for a useful message. These probe
          // inserts are discarded by the rollback below.
          let detail =
            chunkErr instanceof Error ? chunkErr.message : 'insert failed';
          let rowNum = i + 1;
          for (let j = 0; j < chunk.length; j++) {
            try {
              await conn.query(insertSql, [[toRowValues(chunk[j])]]);
            } catch (rowErr) {
              rowNum = i + j + 1;
              detail = rowErr instanceof Error ? rowErr.message : detail;
              break;
            }
          }
          throw new BadRequestException(
            `Import aborted at row ${rowNum}: ${detail}. No rows were inserted.`,
          );
        }
      }

      await conn.commit();
      return inserted;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // Connection may already be unusable — nothing more we can do.
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}
