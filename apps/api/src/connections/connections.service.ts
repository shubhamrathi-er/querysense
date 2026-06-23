import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { SchemaDiscoveryService } from './schema-discovery.service';
import { createPool, buildSshConfig } from '../common/db/mysql-pool';
import {
  DEFAULT_PORTS,
  normalizeEngine,
  quoteIdent,
} from '../common/db/engine';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private schemaDiscovery: SchemaDiscoveryService,
    private ai: AiOrchestratorService,
  ) {}

  /** Decrypted SSH config from a connection record (or undefined). */
  private sshFor(c: Parameters<typeof buildSshConfig>[0]) {
    return buildSshConfig(c, (s) => this.encryption.decrypt(s));
  }

  /** Encrypt the SSH secret fields from a create/update DTO. */
  private encryptSshSecrets(dto: {
    sshPassword?: string;
    sshPrivateKey?: string;
    sshPassphrase?: string;
  }) {
    return {
      ...(dto.sshPassword !== undefined
        ? { sshPassword: dto.sshPassword ? this.encryption.encrypt(dto.sshPassword) : null }
        : {}),
      ...(dto.sshPrivateKey !== undefined
        ? { sshPrivateKey: dto.sshPrivateKey ? this.encryption.encrypt(dto.sshPrivateKey) : null }
        : {}),
      ...(dto.sshPassphrase !== undefined
        ? { sshPassphrase: dto.sshPassphrase ? this.encryption.encrypt(dto.sshPassphrase) : null }
        : {}),
    };
  }

  private readonly publicSelect = {
    id: true,
    name: true,
    engine: true,
    host: true,
    port: true,
    databaseName: true,
    username: true,
    sslEnabled: true,
    status: true,
    sshEnabled: true,
    sshHost: true,
    sshPort: true,
    sshUsername: true,
    lastTestedAt: true,
    lastSyncedAt: true,
    createdAt: true,
  } as const;

  async findAll(workspaceId: string) {
    return this.prisma.databaseConnection.findMany({
      where: { workspaceId },
      select: {
        ...this.publicSelect,
        // Never return encryptedPassword or SSH secrets
        _count: {
          select: { schemaMetadata: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(connectionId: string, workspaceId: string) {
    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: {
        schemaMetadata: {
          include: {
            columns: {
              orderBy: { ordinalPosition: 'asc' },
            },
          },
          orderBy: { tableName: 'asc' },
        },
        modules: {
          orderBy: [{ ordinal: 'asc' }, { name: 'asc' }],
        },
      },
    });

    if (!connection) throw new NotFoundException('Connection not found');
    // Strip password + SSH secrets before returning
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      encryptedPassword: _p,
      sshPassword: _s1,
      sshPrivateKey: _s2,
      sshPassphrase: _s3,
      ...safe
    } = connection;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    // rowCount is BigInt in Prisma — convert so it serializes to JSON.
    return {
      ...safe,
      schemaMetadata: safe.schemaMetadata.map((table) => ({
        ...table,
        rowCount: table.rowCount === null ? null : Number(table.rowCount),
      })),
    };
  }

  async create(workspaceId: string, dto: CreateConnectionDto) {
    const encryptedPassword = this.encryption.encrypt(dto.password);
    const engine = normalizeEngine(dto.engine);

    return this.prisma.databaseConnection.create({
      data: {
        workspaceId,
        name: dto.name,
        engine,
        host: dto.host,
        port: dto.port ?? DEFAULT_PORTS[engine],
        databaseName: dto.databaseName,
        username: dto.username,
        encryptedPassword,
        sslEnabled: dto.sslEnabled ?? false,
        status: 'PENDING',
        sshEnabled: dto.sshEnabled ?? false,
        sshHost: dto.sshHost ?? null,
        sshPort: dto.sshPort ?? 22,
        sshUsername: dto.sshUsername ?? null,
        ...this.encryptSshSecrets(dto),
      },
      select: this.publicSelect,
    });
  }

  async update(
    connectionId: string,
    workspaceId: string,
    dto: UpdateConnectionDto,
  ) {
    await this.assertExists(connectionId, workspaceId);

    const { password, sshPassword, sshPrivateKey, sshPassphrase, ...rest } = dto;
    const data: Prisma.DatabaseConnectionUpdateInput = {
      ...rest,
      ...(password
        ? { encryptedPassword: this.encryption.encrypt(password) }
        : {}),
      ...this.encryptSshSecrets({ sshPassword, sshPrivateKey, sshPassphrase }),
    };

    return this.prisma.databaseConnection.update({
      where: { id: connectionId },
      data,
      select: this.publicSelect,
    });
  }

  async delete(connectionId: string, workspaceId: string) {
    await this.assertExists(connectionId, workspaceId);
    return this.prisma.databaseConnection.delete({
      where: { id: connectionId },
    });
  }

  async testConnection(dto: TestConnectionDto) {
    const engine = normalizeEngine(dto.engine);
    return this.schemaDiscovery.testConnection({
      engine,
      host: dto.host,
      port: dto.port ?? DEFAULT_PORTS[engine],
      databaseName: dto.databaseName,
      username: dto.username,
      password: dto.password,
      sslEnabled: dto.sslEnabled,
      ssh:
        dto.sshEnabled && dto.sshHost && dto.sshUsername
          ? {
              host: dto.sshHost,
              port: dto.sshPort ?? 22,
              username: dto.sshUsername,
              privateKey: dto.sshPrivateKey,
              passphrase: dto.sshPassphrase,
              password: dto.sshPassword,
            }
          : undefined,
    });
  }

  async testExistingConnection(connectionId: string, workspaceId: string) {
    const connection = await this.assertExists(connectionId, workspaceId);
    const password = this.encryption.decrypt(connection.encryptedPassword);

    const result = await this.schemaDiscovery.testConnection({
      engine: connection.engine,
      host: connection.host,
      port: connection.port,
      databaseName: connection.databaseName,
      username: connection.username,
      password,
      sslEnabled: connection.sslEnabled,
      ssh: this.sshFor(connection),
    });

    // Update status
    await this.prisma.databaseConnection.update({
      where: { id: connectionId },
      data: {
        status: result.success ? 'ACTIVE' : 'ERROR',
        lastTestedAt: new Date(),
      },
    });

    return result;
  }

  async syncSchema(connectionId: string, workspaceId: string) {
    const connection = await this.assertExists(connectionId, workspaceId);
    const password = this.encryption.decrypt(connection.encryptedPassword);

    this.logger.log(`Starting schema sync for connection: ${connection.name}`);

    const tables = await this.schemaDiscovery.discoverSchema({
      engine: connection.engine,
      host: connection.host,
      port: connection.port,
      databaseName: connection.databaseName,
      username: connection.username,
      password,
      sslEnabled: connection.sslEnabled,
      ssh: this.sshFor(connection),
    });

    // Upsert each table's metadata
    for (const table of tables) {
      const schemaRecord = await this.prisma.schemaMetadata.upsert({
        where: {
          connectionId_tableName: {
            connectionId,
            tableName: table.tableName,
          },
        },
        create: {
          connectionId,
          tableName: table.tableName,
          tableComment: table.tableComment,
          rowCount: table.rowCount,
          isView: table.isView,
        },
        update: {
          tableComment: table.tableComment,
          rowCount: table.rowCount,
          isView: table.isView,
          updatedAt: new Date(),
        },
      });

      // Preserve descriptions + sample values across re-syncs (match by name).
      const existingCols = await this.prisma.columnMetadata.findMany({
        where: { schemaMetadataId: schemaRecord.id },
        select: { columnName: true, aiDescription: true, sampleValues: true },
      });
      const preserved = new Map(
        existingCols.map((c) => [
          c.columnName,
          { aiDescription: c.aiDescription, sampleValues: c.sampleValues },
        ]),
      );

      // Delete old columns and re-insert fresh ones (keeping descriptions)
      await this.prisma.columnMetadata.deleteMany({
        where: { schemaMetadataId: schemaRecord.id },
      });

      await this.prisma.columnMetadata.createMany({
        data: table.columns.map((col) => {
          const prev = preserved.get(col.columnName);
          return {
            schemaMetadataId: schemaRecord.id,
            columnName: col.columnName,
            dataType: col.dataType,
            isNullable: col.isNullable,
            isPrimaryKey: col.isPrimaryKey,
            isForeignKey: col.isForeignKey,
            referencesTable: col.referencesTable,
            referencesColumn: col.referencesColumn,
            columnComment: col.columnComment,
            ordinalPosition: col.ordinalPosition,
            aiDescription: prev?.aiDescription ?? null,
            sampleValues: prev?.sampleValues ?? undefined,
          };
        }),
      });
    }

    // Update last synced time and status
    await this.prisma.databaseConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    this.logger.log(
      `Schema sync complete: ${tables.length} tables for ${connection.name}`,
    );

    return {
      tablesDiscovered: tables.length,
      syncedAt: new Date(),
    };
  }

  // ─── Descriptions (Phase 2) ──────────────────────────────

  /** AI-generate descriptions for a table and its columns; persist + return it. */
  async describeTable(
    connectionId: string,
    workspaceId: string,
    tableName: string,
  ) {
    const connection = await this.assertExists(connectionId, workspaceId);
    const table = await this.prisma.schemaMetadata.findFirst({
      where: { connectionId, tableName },
      include: { columns: { orderBy: { ordinalPosition: 'asc' } } },
    });
    if (!table) {
      throw new NotFoundException(
        `Table "${tableName}" not found. Sync the schema first.`,
      );
    }

    // Best-effort sample values from the live database.
    const samples = await this.fetchSampleValues(
      connection,
      tableName,
      table.columns.map((c) => c.columnName),
    ).catch(() => ({}) as Record<string, string[]>);

    const aiResult = await this.ai.generateTableDescription({
      tableName: table.tableName,
      isView: table.isView,
      columns: table.columns.map((c) => ({
        name: c.columnName,
        dataType: c.dataType,
        isPrimaryKey: c.isPrimaryKey,
        isForeignKey: c.isForeignKey,
        references: c.referencesTable
          ? `${c.referencesTable}.${c.referencesColumn}`
          : null,
        sampleValues: samples[c.columnName],
      })),
    });

    await this.prisma.schemaMetadata.update({
      where: { id: table.id },
      data: { aiDescription: aiResult.description || null },
    });

    for (const col of table.columns) {
      const desc = aiResult.columns[col.columnName];
      const sv = samples[col.columnName];
      const data: Prisma.ColumnMetadataUpdateInput = {};
      // Fill description only if empty — never clobber an existing one.
      if (desc && !col.aiDescription) data.aiDescription = desc;
      if (sv && sv.length) data.sampleValues = sv;
      if (Object.keys(data).length > 0) {
        await this.prisma.columnMetadata.update({
          where: { id: col.id },
          data,
        });
      }
    }

    return this.getTable(connectionId, tableName);
  }

  /** Save a human-edited table description (overrides the AI one). */
  async updateTableDescription(
    connectionId: string,
    workspaceId: string,
    tableName: string,
    description: string,
  ) {
    await this.assertExists(connectionId, workspaceId);
    const table = await this.prisma.schemaMetadata.findFirst({
      where: { connectionId, tableName },
    });
    if (!table) throw new NotFoundException(`Table "${tableName}" not found.`);

    await this.prisma.schemaMetadata.update({
      where: { id: table.id },
      data: { businessDescription: description.trim() || null },
    });
    return this.getTable(connectionId, tableName);
  }

  /** Save a human-edited column description. */
  async updateColumnDescription(
    connectionId: string,
    workspaceId: string,
    tableName: string,
    columnName: string,
    description: string,
  ) {
    await this.assertExists(connectionId, workspaceId);
    const table = await this.prisma.schemaMetadata.findFirst({
      where: { connectionId, tableName },
      include: { columns: true },
    });
    if (!table) throw new NotFoundException(`Table "${tableName}" not found.`);
    const col = table.columns.find((c) => c.columnName === columnName);
    if (!col) throw new NotFoundException(`Column "${columnName}" not found.`);

    await this.prisma.columnMetadata.update({
      where: { id: col.id },
      data: { aiDescription: description.trim() || null },
    });
    return this.getTable(connectionId, tableName);
  }

  private async getTable(connectionId: string, tableName: string) {
    const table = await this.prisma.schemaMetadata.findFirst({
      where: { connectionId, tableName },
      include: { columns: { orderBy: { ordinalPosition: 'asc' } } },
    });
    if (!table) throw new NotFoundException('Table not found');
    return {
      ...table,
      rowCount: table.rowCount === null ? null : Number(table.rowCount),
    };
  }

  // ─── Modules (Phase 3) ───────────────────────────────────

  private listModules(connectionId: string) {
    return this.prisma.schemaModule.findMany({
      where: { connectionId },
      orderBy: [{ ordinal: 'asc' }, { name: 'asc' }],
    });
  }

  /** AI-suggest a grouping of tables into modules; assigns ungrouped tables. */
  async suggestModules(connectionId: string, workspaceId: string) {
    await this.assertExists(connectionId, workspaceId);

    const tables = await this.prisma.schemaMetadata.findMany({
      where: { connectionId },
      include: {
        columns: { select: { isForeignKey: true, referencesTable: true } },
      },
    });
    if (tables.length === 0) {
      throw new NotFoundException('No tables found. Sync the schema first.');
    }

    const aiInput = tables.map((t) => ({
      tableName: t.tableName,
      references: [
        ...new Set(
          t.columns
            .filter((c) => c.isForeignKey && c.referencesTable)
            .map((c) => c.referencesTable as string),
        ),
      ],
    }));

    const suggestions = await this.ai.suggestModules(aiInput);

    const existing = await this.prisma.schemaModule.findMany({
      where: { connectionId },
    });
    const byName = new Map(existing.map((m) => [m.name.toLowerCase(), m]));
    let ordinal = existing.length;
    const ungrouped = new Set(
      tables.filter((t) => !t.moduleId).map((t) => t.tableName),
    );

    for (const sug of suggestions) {
      let mod = byName.get(sug.name.toLowerCase());
      if (!mod) {
        mod = await this.prisma.schemaModule.create({
          data: {
            connectionId,
            name: sug.name,
            description: sug.description || null,
            ordinal: ordinal++,
          },
        });
        byName.set(sug.name.toLowerCase(), mod);
      }
      // Only assign tables that aren't already grouped (preserve manual edits).
      const toAssign = sug.tables.filter((tn) => ungrouped.has(tn));
      if (toAssign.length) {
        await this.prisma.schemaMetadata.updateMany({
          where: { connectionId, tableName: { in: toAssign } },
          data: { moduleId: mod.id },
        });
      }
    }

    return this.listModules(connectionId);
  }

  async createModule(connectionId: string, workspaceId: string, name: string) {
    await this.assertExists(connectionId, workspaceId);
    const count = await this.prisma.schemaModule.count({
      where: { connectionId },
    });
    try {
      await this.prisma.schemaModule.create({
        data: { connectionId, name: name.trim(), ordinal: count },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          `A module named "${name.trim()}" already exists.`,
        );
      }
      throw err;
    }
    return this.listModules(connectionId);
  }

  async updateModule(
    connectionId: string,
    workspaceId: string,
    moduleId: string,
    data: { name?: string; description?: string },
  ) {
    await this.assertExists(connectionId, workspaceId);
    await this.assertModule(connectionId, moduleId);
    await this.prisma.schemaModule.update({
      where: { id: moduleId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description.trim() || null }
          : {}),
      },
    });
    return this.listModules(connectionId);
  }

  async deleteModule(
    connectionId: string,
    workspaceId: string,
    moduleId: string,
  ) {
    await this.assertExists(connectionId, workspaceId);
    await this.assertModule(connectionId, moduleId);
    // onDelete: SetNull releases the tables back to "ungrouped".
    await this.prisma.schemaModule.delete({ where: { id: moduleId } });
    return this.listModules(connectionId);
  }

  /** Assign (or clear, with null) a table's module. */
  async assignTableModule(
    connectionId: string,
    workspaceId: string,
    tableName: string,
    moduleId: string | null,
  ) {
    await this.assertExists(connectionId, workspaceId);
    if (moduleId) await this.assertModule(connectionId, moduleId);

    const table = await this.prisma.schemaMetadata.findFirst({
      where: { connectionId, tableName },
    });
    if (!table) throw new NotFoundException(`Table "${tableName}" not found.`);

    await this.prisma.schemaMetadata.update({
      where: { id: table.id },
      data: { moduleId },
    });
    return this.listModules(connectionId);
  }

  private async assertModule(connectionId: string, moduleId: string) {
    const mod = await this.prisma.schemaModule.findFirst({
      where: { id: moduleId, connectionId },
    });
    if (!mod) throw new NotFoundException('Module not found');
    return mod;
  }

  /** Pull up to 5 distinct short sample values per column from the live table. */
  private async fetchSampleValues(
    connection: Parameters<typeof buildSshConfig>[0] & {
      engine: string;
      host: string;
      port: number;
      databaseName: string;
      username: string;
      encryptedPassword: string;
      sslEnabled: boolean;
    },
    tableName: string,
    columnNames: string[],
  ): Promise<Record<string, string[]>> {
    if (!/^[A-Za-z0-9_$]+$/.test(tableName)) return {};

    const engine = normalizeEngine(connection.engine);
    const client = await createPool(engine, {
      host: connection.host,
      port: connection.port,
      database: connection.databaseName,
      user: connection.username,
      password: this.encryption.decrypt(connection.encryptedPassword),
      ssl: connection.sslEnabled,
      ssh: this.sshFor(connection),
      connectionLimit: 2,
      connectTimeout: 8000,
    });

    try {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdent(engine, tableName)} LIMIT 20`,
      );
      const sets: Record<string, Set<string>> = {};
      for (const name of columnNames) sets[name] = new Set();

      for (const row of rows) {
        const r = row as Record<string, unknown>;
        for (const name of columnNames) {
          const v = r[name];
          if (v === null || v === undefined) continue;
          const s = String(v);
          if (s.length <= 60 && sets[name].size < 5) sets[name].add(s);
        }
      }

      const out: Record<string, string[]> = {};
      for (const name of columnNames) out[name] = [...sets[name]];
      return out;
    } finally {
      await client.cleanup();
    }
  }

  private async assertExists(connectionId: string, workspaceId: string) {
    const connection = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }
}
