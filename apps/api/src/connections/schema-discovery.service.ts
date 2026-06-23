import { Injectable, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { createMysqlPool, type SshConfig } from '../common/db/mysql-pool';

interface TableRow {
  tableName: string;
  tableComment: string;
  rowCount: number;
  tableType: string;
}

interface ColumnRow {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  isPrimaryKey: string;
  columnComment: string;
  ordinalPosition: number;
}

interface ForeignKeyRow {
  tableName: string;
  columnName: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface DiscoveredColumn {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable: string | null;
  referencesColumn: string | null;
  columnComment: string | null;
  ordinalPosition: number;
}

export interface DiscoveredTable {
  tableName: string;
  tableComment: string | null;
  rowCount: number;
  isView: boolean;
  columns: DiscoveredColumn[];
}

@Injectable()
export class SchemaDiscoveryService {
  private readonly logger = new Logger(SchemaDiscoveryService.name);

  async discoverSchema(config: {
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
    sslEnabled?: boolean;
    ssh?: SshConfig;
  }): Promise<DiscoveredTable[]> {
    const { pool, cleanup } = await createMysqlPool({
      host: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
      ssl: config.sslEnabled,
      ssh: config.ssh,
      connectionLimit: 2,
      connectTimeout: 10000,
    });

    try {
      // 1. Get all tables and views
      const [tableRows] = await pool.query<mysql.RowDataPacket[]>(
        `
        SELECT
          TABLE_NAME        AS tableName,
          COALESCE(TABLE_COMMENT, '') AS tableComment,
          COALESCE(TABLE_ROWS, 0)     AS rowCount,
          TABLE_TYPE        AS tableType
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME
      `,
        [config.databaseName],
      );

      if (tableRows.length === 0) return [];

      // 2. Get all columns in one query (efficient)
      const [columnRows] = await pool.query<mysql.RowDataPacket[]>(
        `
        SELECT
          TABLE_NAME       AS tableName,
          COLUMN_NAME      AS columnName,
          DATA_TYPE        AS dataType,
          IS_NULLABLE      AS isNullable,
          COLUMN_KEY       AS isPrimaryKey,
          COALESCE(COLUMN_COMMENT, '') AS columnComment,
          ORDINAL_POSITION AS ordinalPosition
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `,
        [config.databaseName],
      );

      // 3. Get all foreign keys
      const [fkRows] = await pool.query<mysql.RowDataPacket[]>(
        `
        SELECT
          TABLE_NAME              AS tableName,
          COLUMN_NAME             AS columnName,
          REFERENCED_TABLE_NAME   AS referencesTable,
          REFERENCED_COLUMN_NAME  AS referencesColumn
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `,
        [config.databaseName],
      );

      // 4. Build FK lookup map
      const fkMap = new Map<
        string,
        { referencesTable: string; referencesColumn: string }
      >();
      for (const fk of fkRows as ForeignKeyRow[]) {
        fkMap.set(`${fk.tableName}.${fk.columnName}`, {
          referencesTable: fk.referencesTable,
          referencesColumn: fk.referencesColumn,
        });
      }

      // 5. Group columns by table
      const columnsByTable = new Map<string, DiscoveredColumn[]>();
      for (const col of columnRows as ColumnRow[]) {
        const fkInfo = fkMap.get(`${col.tableName}.${col.columnName}`);
        const column: DiscoveredColumn = {
          columnName: col.columnName,
          dataType: col.dataType,
          isNullable: col.isNullable === 'YES',
          isPrimaryKey: col.isPrimaryKey === 'PRI',
          isForeignKey: !!fkInfo,
          referencesTable: fkInfo?.referencesTable ?? null,
          referencesColumn: fkInfo?.referencesColumn ?? null,
          columnComment: col.columnComment || null,
          ordinalPosition: col.ordinalPosition,
        };

        const existing = columnsByTable.get(col.tableName) ?? [];
        existing.push(column);
        columnsByTable.set(col.tableName, existing);
      }

      // 6. Assemble final result
      const tables: DiscoveredTable[] = (tableRows as TableRow[]).map(
        (table) => ({
          tableName: table.tableName,
          tableComment: table.tableComment || null,
          rowCount: table.rowCount,
          isView: table.tableType === 'VIEW',
          columns: columnsByTable.get(table.tableName) ?? [],
        }),
      );

      this.logger.log(
        `Discovered ${tables.length} tables in ${config.databaseName}`,
      );

      return tables;
    } finally {
      await cleanup();
    }
  }

  async testConnection(config: {
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
    sslEnabled?: boolean;
    ssh?: SshConfig;
  }): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    try {
      const tunneled = await createMysqlPool({
        host: config.host,
        port: config.port,
        database: config.databaseName,
        user: config.username,
        password: config.password,
        ssl: config.sslEnabled,
        ssh: config.ssh,
        connectionLimit: 1,
        connectTimeout: 8000,
      });
      cleanup = tunneled.cleanup;

      const conn = await tunneled.pool.getConnection();
      await conn.ping();
      conn.release();
      const latencyMs = Date.now() - start;

      return {
        success: true,
        message: `Connected successfully to ${config.databaseName}${config.ssh ? ' (via SSH tunnel)' : ''}`,
        latencyMs,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        latencyMs: Date.now() - start,
      };
    } finally {
      if (cleanup) await cleanup();
    }
  }
}
