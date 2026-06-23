import { Injectable, Logger } from '@nestjs/common';
import {
  createPool,
  type SqlClient,
  type SshConfig,
} from '../common/db/mysql-pool';
import { DbEngine, normalizeEngine } from '../common/db/engine';

interface TableRow {
  tableName: string;
  tableComment: string;
  rowCount: number | string;
  tableType: string;
}

interface ColumnRow {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  isPrimaryKey?: string;
  columnComment: string;
  ordinalPosition: number | string;
}

interface ForeignKeyRow {
  tableName: string;
  columnName: string;
  referencesTable: string;
  referencesColumn: string;
}

interface KeyRow {
  tableName: string;
  columnName: string;
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

export interface DiscoveryConfig {
  engine?: DbEngine | string | null;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslEnabled?: boolean;
  ssh?: SshConfig;
}

/**
 * The PostgreSQL schema we introspect. Postgres databases hold multiple schemas;
 * we scope to the conventional `public` schema to mirror MySQL's single-database
 * model. (A future enhancement could let users pick the schema.)
 */
const PG_SCHEMA = 'public';
/** The SQL Server schema we introspect (the conventional default). */
const SS_SCHEMA = 'dbo';

@Injectable()
export class SchemaDiscoveryService {
  private readonly logger = new Logger(SchemaDiscoveryService.name);

  private poolConfig(config: DiscoveryConfig, limit: number, timeout: number) {
    return {
      host: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
      ssl: config.sslEnabled,
      ssh: config.ssh,
      connectionLimit: limit,
      connectTimeout: timeout,
    };
  }

  async discoverSchema(config: DiscoveryConfig): Promise<DiscoveredTable[]> {
    const engine = normalizeEngine(config.engine);
    const client = await createPool(engine, this.poolConfig(config, 2, 10000));

    try {
      const tables =
        engine === 'postgres'
          ? await this.discoverPostgres(client)
          : engine === 'sqlserver'
            ? await this.discoverSqlServer(client)
            : await this.discoverMysql(client, config.databaseName);

      this.logger.log(
        `Discovered ${tables.length} tables in ${config.databaseName} (${engine})`,
      );
      return tables;
    } finally {
      await client.cleanup();
    }
  }

  private async discoverMysql(
    client: SqlClient,
    databaseName: string,
  ): Promise<DiscoveredTable[]> {
    const tableRows = await client.query<TableRow>(
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
      [databaseName],
    );
    if (tableRows.length === 0) return [];

    const columnRows = await client.query<ColumnRow>(
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
      [databaseName],
    );

    const fkRows = await client.query<ForeignKeyRow>(
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
      [databaseName],
    );

    return this.assemble(
      tableRows,
      columnRows,
      fkRows,
      (c) => c.isPrimaryKey === 'PRI',
    );
  }

  private async discoverPostgres(
    client: SqlClient,
  ): Promise<DiscoveredTable[]> {
    const tableRows = await client.query<TableRow>(
      `
      SELECT
        t.table_name AS "tableName",
        COALESCE(obj_description(pc.oid), '') AS "tableComment",
        COALESCE(st.n_live_tup, 0) AS "rowCount",
        t.table_type AS "tableType"
      FROM information_schema.tables t
      LEFT JOIN pg_namespace pn ON pn.nspname = t.table_schema
      LEFT JOIN pg_class pc ON pc.relname = t.table_name AND pc.relnamespace = pn.oid
      LEFT JOIN pg_stat_user_tables st
        ON st.relname = t.table_name AND st.schemaname = t.table_schema
      WHERE t.table_schema = $1
      ORDER BY t.table_name
    `,
      [PG_SCHEMA],
    );
    if (tableRows.length === 0) return [];

    const columnRows = await client.query<ColumnRow>(
      `
      SELECT
        c.table_name AS "tableName",
        c.column_name AS "columnName",
        c.data_type AS "dataType",
        c.is_nullable AS "isNullable",
        c.ordinal_position AS "ordinalPosition",
        COALESCE(col_description(pc.oid, c.ordinal_position), '') AS "columnComment"
      FROM information_schema.columns c
      LEFT JOIN pg_namespace pn ON pn.nspname = c.table_schema
      LEFT JOIN pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = pn.oid
      WHERE c.table_schema = $1
      ORDER BY c.table_name, c.ordinal_position
    `,
      [PG_SCHEMA],
    );

    const pkRows = await client.query<KeyRow>(
      `
      SELECT kcu.table_name AS "tableName", kcu.column_name AS "columnName"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
    `,
      [PG_SCHEMA],
    );

    const fkRows = await client.query<ForeignKeyRow>(
      `
      SELECT
        kcu.table_name AS "tableName",
        kcu.column_name AS "columnName",
        ccu.table_name AS "referencesTable",
        ccu.column_name AS "referencesColumn"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
    `,
      [PG_SCHEMA],
    );

    const pkSet = new Set(pkRows.map((r) => `${r.tableName}.${r.columnName}`));
    return this.assemble(tableRows, columnRows, fkRows, (c) =>
      pkSet.has(`${c.tableName}.${c.columnName}`),
    );
  }

  private async discoverSqlServer(
    client: SqlClient,
  ): Promise<DiscoveredTable[]> {
    const tableRows = await client.query<TableRow>(
      `SELECT t.TABLE_NAME AS tableName,
              t.TABLE_TYPE AS tableType,
              ISNULL((SELECT SUM(p.rows) FROM sys.partitions p
                      WHERE p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
                        AND p.index_id IN (0, 1)), 0) AS [rowCount],
              '' AS tableComment
       FROM INFORMATION_SCHEMA.TABLES t
       WHERE t.TABLE_SCHEMA = @p0
       ORDER BY t.TABLE_NAME`,
      [SS_SCHEMA],
    );
    if (tableRows.length === 0) return [];

    const columnRows = await client.query<ColumnRow>(
      `SELECT c.TABLE_NAME AS tableName,
              c.COLUMN_NAME AS columnName,
              c.DATA_TYPE AS dataType,
              c.IS_NULLABLE AS isNullable,
              c.ORDINAL_POSITION AS ordinalPosition,
              '' AS columnComment
       FROM INFORMATION_SCHEMA.COLUMNS c
       WHERE c.TABLE_SCHEMA = @p0
       ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
      [SS_SCHEMA],
    );

    const pkRows = await client.query<KeyRow>(
      `SELECT ku.TABLE_NAME AS tableName, ku.COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
         ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @p0`,
      [SS_SCHEMA],
    );

    const fkRows = await client.query<ForeignKeyRow>(
      `SELECT OBJECT_NAME(fk.parent_object_id) AS tableName,
              pc.name AS columnName,
              OBJECT_NAME(fk.referenced_object_id) AS referencesTable,
              rc.name AS referencesColumn
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE SCHEMA_NAME(fk.schema_id) = @p0`,
      [SS_SCHEMA],
    );

    const pkSet = new Set(pkRows.map((r) => `${r.tableName}.${r.columnName}`));
    return this.assemble(tableRows, columnRows, fkRows, (c) =>
      pkSet.has(`${c.tableName}.${c.columnName}`),
    );
  }

  /** Shared assembly of the per-engine row sets into DiscoveredTable[]. */
  private assemble(
    tableRows: TableRow[],
    columnRows: ColumnRow[],
    fkRows: ForeignKeyRow[],
    isPk: (c: ColumnRow) => boolean,
  ): DiscoveredTable[] {
    const fkMap = new Map<
      string,
      { referencesTable: string; referencesColumn: string }
    >();
    for (const fk of fkRows) {
      fkMap.set(`${fk.tableName}.${fk.columnName}`, {
        referencesTable: fk.referencesTable,
        referencesColumn: fk.referencesColumn,
      });
    }

    const columnsByTable = new Map<string, DiscoveredColumn[]>();
    for (const col of columnRows) {
      const fkInfo = fkMap.get(`${col.tableName}.${col.columnName}`);
      const column: DiscoveredColumn = {
        columnName: col.columnName,
        dataType: col.dataType,
        isNullable: col.isNullable === 'YES',
        isPrimaryKey: isPk(col),
        isForeignKey: !!fkInfo,
        referencesTable: fkInfo?.referencesTable ?? null,
        referencesColumn: fkInfo?.referencesColumn ?? null,
        columnComment: col.columnComment || null,
        ordinalPosition: Number(col.ordinalPosition),
      };
      const existing = columnsByTable.get(col.tableName) ?? [];
      existing.push(column);
      columnsByTable.set(col.tableName, existing);
    }

    return tableRows.map((table) => ({
      tableName: table.tableName,
      tableComment: table.tableComment || null,
      rowCount: Number(table.rowCount),
      isView: table.tableType === 'VIEW',
      columns: columnsByTable.get(table.tableName) ?? [],
    }));
  }

  async testConnection(
    config: DiscoveryConfig,
  ): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const engine = normalizeEngine(config.engine);
    const start = Date.now();
    let client: SqlClient | null = null;

    try {
      client = await createPool(engine, this.poolConfig(config, 1, 8000));
      await client.ping();
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
      if (client) await client.cleanup();
    }
  }
}
