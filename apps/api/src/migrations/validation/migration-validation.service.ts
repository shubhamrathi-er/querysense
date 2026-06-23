import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MysqlAdapter } from './dialect/mysql.adapter';
import { buildSshConfig } from '../../common/db/mysql-pool';
import type { DialectAdapter, FkDetail } from './dialect/dialect-adapter.interface';
import {
  Severity,
  type Issue,
  type ValidationReport,
  type ValidationConfig,
  type SourceValidation,
  type SourceTableValidation,
  type TargetValidation,
  type SchemaComparison,
  type DataValidation,
  type DuplicateValidation,
  type ExecutionStep,
  type NullabilityFinding,
  type DuplicateRecommendation,
} from './types';
import { compareTableColumns } from './rules/schema-comparison';
import { analyzeDependencies } from './rules/dependency';
import { assessVolume } from './rules/volume';
import { computeReadiness, hasBlockers } from './rules/readiness';
import { intMax } from './rules/type-compatibility';
import { isReservedWord } from './rules/reserved-words';

export interface ValidateInput {
  sourceConnectionId: string;
  targetConnectionId: string;
  tables: string[];
  allowViews?: boolean;
  mode?: 'append' | 'overwrite';
}

const INT_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint']);
const CHAR_TYPES = new Set(['varchar', 'char']);

@Injectable()
export class MigrationValidationService {
  private readonly logger = new Logger(MigrationValidationService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  /** Quick gate used by the migration runner — true if a BLOCKER exists. */
  async hasBlockingIssues(workspaceId: string, input: ValidateInput): Promise<Issue[]> {
    const report = await this.validate(workspaceId, input);
    return report.allIssues.filter((i) => i.severity === Severity.BLOCKER);
  }

  async validate(workspaceId: string, input: ValidateInput): Promise<ValidationReport> {
    const config: ValidationConfig = {
      allowViews: input.allowViews ?? false,
      overwriteMode: input.mode === 'overwrite',
      mode: input.mode ?? 'append',
    };
    const src = await this.makeAdapter(input.sourceConnectionId, workspaceId);
    const tgt = await this.makeAdapter(input.targetConnectionId, workspaceId);
    await src.connect();
    await tgt.connect();

    const issues: Issue[] = [];
    const add = (i: Issue) => {
      issues.push(i);
      return i;
    };

    try {
      const sourceFks = await src.getForeignKeys();

      const sourceValidation = await this.phase1Source(src, sourceFks, input.tables, config, add);
      const targetValidation = await this.phase2Target(tgt, input.tables, config, add);
      const schemaComparison = await this.phase3Schema(src, tgt, input.tables, add);
      const dataValidation = await this.phase45Data(src, input.tables, schemaComparison, add);
      const duplicateValidation = await this.phase6Duplicates(src, tgt, input.tables, config, add);

      const dependencyAnalysis = analyzeDependencies(
        input.tables,
        sourceFks.map((f) => ({ table: f.table, refTable: f.refTable })),
      );

      const edgeCases = await this.phase8EdgeCases(
        src,
        input.tables,
        sourceValidation,
        dependencyAnalysis,
        config,
        targetValidation,
        add,
      );

      const totalRows = sourceValidation.tables.reduce((s, t) => s + t.rowCount, 0);
      const totalBytes = sourceValidation.tables.reduce((s, t) => s + t.sizeBytes, 0);
      const volume = assessVolume(totalRows, totalBytes);

      const executionPlan = this.phase11Plan(
        dependencyAnalysis,
        targetValidation,
        schemaComparison,
      );

      const migrationReadinessScore = computeReadiness(issues);
      const blockers = issues.filter((i) => i.severity === Severity.BLOCKER);
      const warnings = issues.filter((i) => i.severity === Severity.WARNING);

      const finalRecommendation = {
        proceed: blockers.length === 0,
        status: migrationReadinessScore.status,
        summary:
          blockers.length > 0
            ? `Migration blocked by ${blockers.length} blocker(s).`
            : issues.some((i) => i.severity === Severity.ERROR)
              ? `Migration is not recommended — ${issues.filter((i) => i.severity === Severity.ERROR).length} error(s) found.`
              : warnings.length > 0
                ? `Ready with ${warnings.length} warning(s).`
                : 'All checks passed — ready to migrate.',
        blockers,
        warnings,
      };

      return {
        sourceValidation,
        targetValidation,
        schemaComparison,
        dataValidation,
        duplicateValidation,
        dependencyAnalysis,
        executionPlan,
        riskAssessment: { ...volume, edgeCases },
        migrationReadinessScore,
        finalRecommendation,
        allIssues: issues,
      };
    } finally {
      await src.close();
      await tgt.close();
    }
  }

  // ── Phase 1 ──
  private async phase1Source(
    src: DialectAdapter,
    fks: FkDetail[],
    tables: string[],
    config: ValidationConfig,
    add: (i: Issue) => Issue,
  ): Promise<SourceValidation> {
    const sv: SourceValidation = {
      connectionActive: await src.ping(),
      databaseExists: false,
      selectPermission: false,
      tables: [],
      issues: [],
    };
    if (!sv.connectionActive) {
      sv.issues.push(add({ phase: 'source', code: 'SOURCE_CONN_INACTIVE', severity: Severity.BLOCKER, message: 'Source connection is not reachable.' }));
      return sv;
    }
    sv.databaseExists = await src.databaseExists();
    if (!sv.databaseExists) {
      sv.issues.push(add({ phase: 'source', code: 'SOURCE_DB_MISSING', severity: Severity.BLOCKER, message: 'Source database does not exist.' }));
    }
    const grants = await src.getGrants();
    sv.selectPermission = grants.select;
    if (!grants.select) {
      sv.issues.push(add({ phase: 'source', code: 'SELECT_PERMISSION_MISSING', severity: Severity.BLOCKER, message: 'User lacks SELECT permission on the source.' }));
    }

    for (const table of tables) {
      const exists = await src.tableExists(table);
      if (!exists) {
        add({ phase: 'source', code: 'SOURCE_TABLE_MISSING', severity: Severity.BLOCKER, table, message: `Source table "${table}" does not exist.` });
        sv.tables.push(this.emptySourceTable(table));
        continue;
      }
      const isView = await src.isView(table);
      const warnings: Issue[] = [];
      if (isView && !config.allowViews) {
        warnings.push(add({ phase: 'source', code: 'SOURCE_IS_VIEW', severity: Severity.BLOCKER, table, message: `"${table}" is a view; views are not migrated unless explicitly allowed.` }));
      }
      const cols = await src.getColumns(table);
      const pk = await src.getPrimaryKey(table);
      const tableFks = fks
        .filter((f) => f.table === table)
        .map((f) => ({ column: f.column, refTable: f.refTable, refColumn: f.refColumn }));
      const triggers = await src.getTriggers(table);
      const partitions = await src.getPartitions(table);
      const rowCount = await src.getRowCount(table);
      const sizeBytes = await src.getTableSizeBytes(table);

      const generatedColumns = cols.filter((c) => c.generated).map((c) => c.name);
      const autoIncrementColumns = cols.filter((c) => c.autoIncrement).map((c) => c.name);
      const blobTextColumns = cols.filter((c) => c.isBlob || c.isText).map((c) => c.name);

      if (pk.length === 0) warnings.push(add({ phase: 'source', code: 'NO_PRIMARY_KEY', severity: Severity.WARNING, table, message: `"${table}" has no primary key — skip/dedup and keyset copy are limited.` }));
      if (pk.length > 1) warnings.push(add({ phase: 'source', code: 'COMPOSITE_PK', severity: Severity.INFO, table, message: `"${table}" has a composite primary key.` }));
      if (triggers.length) warnings.push(add({ phase: 'source', code: 'TRIGGERS_PRESENT', severity: Severity.WARNING, table, message: `"${table}" has ${triggers.length} trigger(s); these are not migrated.` }));
      if (partitions.length) warnings.push(add({ phase: 'source', code: 'PARTITIONED', severity: Severity.WARNING, table, message: `"${table}" is partitioned.` }));
      if (generatedColumns.length) warnings.push(add({ phase: 'source', code: 'GENERATED_COLUMNS', severity: Severity.INFO, table, message: `Generated columns excluded from copy: ${generatedColumns.join(', ')}.` }));
      if (blobTextColumns.length) warnings.push(add({ phase: 'source', code: 'BLOB_TEXT_COLUMNS', severity: Severity.INFO, table, message: `Large column(s): ${blobTextColumns.join(', ')}.` }));
      if (rowCount > 5_000_000) warnings.push(add({ phase: 'source', code: 'VERY_LARGE_TABLE', severity: Severity.WARNING, table, message: `"${table}" has ~${rowCount.toLocaleString()} rows; expect a long migration.` }));

      sv.tables.push({
        tableName: table,
        exists: true,
        isView,
        rowCount,
        sizeBytes,
        primaryKey: pk,
        compositePrimaryKey: pk.length > 1,
        foreignKeys: tableFks,
        triggers,
        partitioned: partitions.length > 0,
        generatedColumns,
        autoIncrementColumns,
        blobTextColumns,
        warnings,
      });
    }
    return sv;
  }

  private emptySourceTable(table: string): SourceTableValidation {
    return {
      tableName: table, exists: false, isView: false, rowCount: 0, sizeBytes: 0,
      primaryKey: [], compositePrimaryKey: false, foreignKeys: [], triggers: [],
      partitioned: false, generatedColumns: [], autoIncrementColumns: [],
      blobTextColumns: [], warnings: [],
    };
  }

  // ── Phase 2 ──
  private async phase2Target(
    tgt: DialectAdapter,
    tables: string[],
    config: ValidationConfig,
    add: (i: Issue) => Issue,
  ): Promise<TargetValidation> {
    const connectionActive = await tgt.ping();
    const tv: TargetValidation = {
      connectionActive,
      databaseExists: false,
      permissions: { select: false, insert: false, update: false, delete: false, create: false },
      tables: [],
      issues: [],
    };
    if (!connectionActive) {
      tv.issues.push(add({ phase: 'target', code: 'TARGET_CONN_INACTIVE', severity: Severity.BLOCKER, message: 'Target connection is not reachable.' }));
      return tv;
    }
    tv.databaseExists = await tgt.databaseExists();
    if (!tv.databaseExists) {
      tv.issues.push(add({ phase: 'target', code: 'TARGET_DB_MISSING', severity: Severity.BLOCKER, message: 'Target database does not exist.' }));
    }
    tv.permissions = await tgt.getGrants();

    const tableExistence: boolean[] = [];
    for (const table of tables) {
      const exists = await tgt.tableExists(table);
      tableExistence.push(exists);
      tv.tables.push({ tableName: table, tableExists: exists, schemaExists: tv.databaseExists });
    }
    const anyMissing = tableExistence.some((e) => !e);

    if (!tv.permissions.insert) tv.issues.push(add({ phase: 'target', code: 'INSERT_PERMISSION_MISSING', severity: Severity.BLOCKER, message: 'User lacks INSERT permission on the target.' }));
    if (anyMissing && !tv.permissions.create) tv.issues.push(add({ phase: 'target', code: 'CREATE_PERMISSION_MISSING', severity: Severity.BLOCKER, message: 'Some target tables are missing and the user lacks CREATE permission.' }));
    if (config.overwriteMode && !tv.permissions.delete) tv.issues.push(add({ phase: 'target', code: 'DELETE_PERMISSION_MISSING', severity: Severity.BLOCKER, message: 'Overwrite mode requires DELETE permission on the target.' }));
    if (config.mode === 'append' && !tv.permissions.update) tv.issues.push(add({ phase: 'target', code: 'UPDATE_PERMISSION_MISSING', severity: Severity.WARNING, message: 'Upsert conflict handling requires UPDATE permission.' }));

    return tv;
  }

  // ── Phase 3 ──
  private async phase3Schema(
    src: DialectAdapter,
    tgt: DialectAdapter,
    tables: string[],
    add: (i: Issue) => Issue,
  ): Promise<SchemaComparison> {
    const out: SchemaComparison = { tables: [], issues: [] };
    for (const table of tables) {
      if (!(await src.tableExists(table))) continue;
      const targetExists = await tgt.tableExists(table);
      if (!targetExists) {
        add({ phase: 'schema', code: 'TARGET_TABLE_WILL_BE_CREATED', severity: Severity.INFO, table, message: `Target table "${table}" will be created from the source.` });
        out.tables.push({ tableName: table, targetExists: false, columns: [], issues: [] });
        continue;
      }
      const srcCols = await src.getColumns(table);
      const tgtCols = await tgt.getColumns(table);
      const { columns, issues } = compareTableColumns(table, srcCols, tgtCols);
      issues.forEach(add);
      out.tables.push({ tableName: table, targetExists: true, columns, issues });
      out.issues.push(...issues);
    }
    return out;
  }

  // ── Phase 4 + 5 ──
  private async phase45Data(
    src: DialectAdapter,
    tables: string[],
    schema: SchemaComparison,
    add: (i: Issue) => Issue,
  ): Promise<DataValidation> {
    const dv: DataValidation = { issues: [], nullability: [] };
    for (const tc of schema.tables) {
      if (!tc.targetExists) continue;
      for (const cc of tc.columns) {
        const s = cc.source;
        const t = cc.target;
        if (!s || !t) continue;

        // String length overflow (Phase 4.1)
        if (CHAR_TYPES.has(t.dataType) && t.length != null) {
          const maxLen = await src.maxCharLength(tc.tableName, s.name);
          if (maxLen != null && maxLen > t.length) {
            dv.issues.push(add({ phase: 'data', code: 'STRING_OVERFLOW', severity: Severity.BLOCKER, table: tc.tableName, column: s.name, message: `Longest value is ${maxLen} chars but target "${s.name}" holds ${t.length}.`, detail: { maxLen, targetLength: t.length } }));
          }
        }
        // Numeric overflow (Phase 4.2)
        if (INT_TYPES.has(t.dataType)) {
          const lim = intMax(t.dataType, t.unsigned);
          if (lim != null) {
            const mx = await src.maxNumeric(tc.tableName, s.name);
            if (mx != null && mx > lim) {
              dv.issues.push(add({ phase: 'data', code: 'NUMERIC_OVERFLOW', severity: Severity.BLOCKER, table: tc.tableName, column: s.name, message: `Max value ${mx.toString()} exceeds target ${t.dataType} limit ${lim.toString()}.` }));
            }
          }
        }
        // Nullability (Phase 5)
        if (s.nullable && !t.nullable) {
          const nullCount = await src.nullCount(tc.tableName, s.name);
          const severity = nullCount > 0 ? Severity.BLOCKER : Severity.WARNING;
          const finding: NullabilityFinding = { table: tc.tableName, column: s.name, nullCount, severity };
          dv.nullability.push(finding);
          if (nullCount > 0) {
            dv.issues.push(add({ phase: 'nullability', code: 'NULL_INTO_NOT_NULL', severity: Severity.BLOCKER, table: tc.tableName, column: s.name, message: `${nullCount} NULL value(s) cannot be inserted into NOT NULL target column "${s.name}".` }));
          }
        }
      }
    }
    return dv;
  }

  // ── Phase 6 ──
  private async phase6Duplicates(
    src: DialectAdapter,
    tgt: DialectAdapter,
    tables: string[],
    config: ValidationConfig,
    add: (i: Issue) => Issue,
  ): Promise<DuplicateValidation> {
    const out: DuplicateValidation = { tables: [], issues: [] };
    if (config.mode === 'overwrite') return out; // truncate clears the target
    for (const table of tables) {
      if (!(await tgt.tableExists(table))) continue;
      if (!(await src.tableExists(table))) continue;
      const pk = await src.getPrimaryKey(table);
      if (pk.length === 0) {
        out.tables.push({ tableName: table, duplicateCount: 0, sampled: false, sampleKeys: [], recommendation: 'SKIP' });
        continue;
      }
      const sample = await src.sampleKeys(table, pk, 10000);
      const probe = await tgt.probeDuplicates(table, pk, sample);
      const recommendation: DuplicateRecommendation = probe.count > 0 ? 'UPSERT' : 'SKIP';
      out.tables.push({ tableName: table, duplicateCount: probe.count, sampled: probe.sampled, sampleKeys: probe.sample, recommendation });
      if (probe.count > 0) {
        out.issues.push(add({ phase: 'duplicate', code: 'PK_CONFLICTS', severity: Severity.WARNING, table, message: `~${probe.count}${probe.sampled ? '+' : ''} rows already exist on the target (by PK); they will be ${config.mode === 'append' ? 'skipped or updated' : 'handled per conflict mode'}.`, detail: { sampleKeys: probe.sample } }));
      }
    }
    return out;
  }

  // ── Phase 8 ──
  private async phase8EdgeCases(
    src: DialectAdapter,
    tables: string[],
    source: SourceValidation,
    dep: ReturnType<typeof analyzeDependencies>,
    config: ValidationConfig,
    target: TargetValidation,
    add: (i: Issue) => Issue,
  ): Promise<Issue[]> {
    const edge: Issue[] = [];
    const push = (i: Issue) => { edge.push(i); add(i); };

    for (const t of dep.selfReferencing) push({ phase: 'constraint', code: 'SELF_REFERENCING_FK', severity: Severity.WARNING, table: t, message: `"${t}" has a self-referencing foreign key; rows must load in dependency order.` });
    for (const group of dep.circular) push({ phase: 'constraint', code: 'CIRCULAR_DEPENDENCY', severity: Severity.WARNING, message: `Circular FK dependency: ${group.join(' ↔ ')}. FK checks will be disabled during load.` });

    for (const table of tables) {
      if (isReservedWord(table)) push({ phase: 'constraint', code: 'RESERVED_TABLE_NAME', severity: Severity.WARNING, table, message: `"${table}" is a reserved SQL keyword.` });
      // routines / events / views referencing the table won't be migrated
      const [routines, events, views] = await Promise.all([
        src.getRoutinesReferencing(table),
        src.getEventsReferencing(table),
        src.getViewsReferencing(table),
      ]);
      if (routines.length) push({ phase: 'constraint', code: 'ROUTINE_DEPENDENCY', severity: Severity.INFO, table, message: `Stored routine(s) reference "${table}": ${routines.join(', ')} (not migrated).` });
      if (events.length) push({ phase: 'constraint', code: 'EVENT_DEPENDENCY', severity: Severity.INFO, table, message: `Event(s) reference "${table}" (not migrated).` });
      if (views.length) push({ phase: 'constraint', code: 'VIEW_DEPENDENCY', severity: Severity.INFO, table, message: `View(s) depend on "${table}": ${views.join(', ')}.` });
    }

    // Auto-increment collision risk: append into an existing table with an auto-inc PK.
    const targetExists = new Map(target.tables.map((t) => [t.tableName, t.tableExists]));
    for (const st of source.tables) {
      if (st.autoIncrementColumns.length && targetExists.get(st.tableName) && config.mode === 'append') {
        push({ phase: 'constraint', code: 'AUTO_INCREMENT_COLLISION_RISK', severity: Severity.WARNING, table: st.tableName, message: `"${st.tableName}" has AUTO_INCREMENT and the target already has rows; preserved IDs may collide.` });
      }
    }
    return edge;
  }

  // ── Phase 11 ──
  private phase11Plan(
    dep: ReturnType<typeof analyzeDependencies>,
    target: TargetValidation,
    schema: SchemaComparison,
  ): ExecutionStep[] {
    const missingTables = target.tables.filter((t) => !t.tableExists).map((t) => t.tableName);
    const missingCols = schema.tables
      .filter((t) => t.columns.some((c) => c.changes.some((ch) => ch.code === 'TARGET_COLUMN_MISSING')))
      .map((t) => t.tableName);
    const parents = dep.order.filter((t) => (dep.parents[t]?.length ?? 0) === 0);
    const children = dep.order.filter((t) => (dep.parents[t]?.length ?? 0) > 0);

    const steps: ExecutionStep[] = [];
    let n = 1;
    if (missingTables.length) steps.push({ step: n++, action: 'Create missing tables', tables: missingTables });
    if (missingCols.length) steps.push({ step: n++, action: 'Create missing columns', tables: missingCols });
    steps.push({ step: n++, action: 'Disable foreign key checks' });
    steps.push({ step: n++, action: 'Migrate parent / independent tables', tables: parents });
    if (children.length) steps.push({ step: n++, action: 'Migrate child tables', tables: children });
    steps.push({ step: n++, action: 'Re-enable foreign key checks' });
    steps.push({ step: n++, action: 'Validate row counts' });
    return steps;
  }

  // ── Phase 12: post-migration verification ──
  async verify(
    workspaceId: string,
    input: { sourceConnectionId: string; targetConnectionId: string; tables: string[] },
  ): Promise<import('./types').VerificationReport> {
    const src = await this.makeAdapter(input.sourceConnectionId, workspaceId);
    const tgt = await this.makeAdapter(input.targetConnectionId, workspaceId);
    await src.connect();
    await tgt.connect();
    try {
      const tables: import('./types').TableVerification[] = [];
      for (const table of input.tables) {
        const sourceRowCount = await src.getRowCount(table);
        const targetRowCount = (await tgt.tableExists(table)) ? await tgt.getRowCount(table) : 0;
        const sourceChecksum = await src.checksum(table);
        const targetChecksum = await tgt.checksum(table);
        const rowCountMatch = sourceRowCount === targetRowCount;
        const checksumMatch =
          sourceChecksum != null && targetChecksum != null
            ? sourceChecksum === targetChecksum
            : null;
        tables.push({
          table,
          sourceRowCount,
          targetRowCount,
          rowCountMatch,
          sourceChecksum,
          targetChecksum,
          checksumMatch,
          status: rowCountMatch && checksumMatch !== false ? 'OK' : 'MISMATCH',
        });
      }
      return {
        tables,
        status: tables.every((t) => t.status === 'OK') ? 'OK' : 'MISMATCH',
      };
    } finally {
      await src.close();
      await tgt.close();
    }
  }

  // ── helpers ──
  private async makeAdapter(connectionId: string, workspaceId: string): Promise<DialectAdapter> {
    const c = await this.prisma.databaseConnection.findFirst({
      where: { id: connectionId, workspaceId },
    });
    if (!c) throw new NotFoundException('Connection not found');
    // Strategy selection point — MySQL today; switch on engine for others.
    return new MysqlAdapter({
      host: c.host,
      port: c.port,
      database: c.databaseName,
      user: c.username,
      password: this.encryption.decrypt(c.encryptedPassword),
      sslEnabled: c.sslEnabled,
      ssh: buildSshConfig(c, (s) => this.encryption.decrypt(s)),
    });
  }
}

export { hasBlockers };
