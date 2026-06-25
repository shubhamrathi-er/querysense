'use client';

import { useMemo, useRef, useState } from 'react';
import {
  X, ArrowRight, ArrowLeft, ArrowDown, Database, Loader2, Download, Copy, Check,
  AlertTriangle, CheckCircle2, Play, FileCode, ShieldAlert, ShieldCheck, Info, ListOrdered,
  Lock, Zap, Clock, Table2, Settings2, Search, GitCompare, ChevronRight, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { engineLabel, type DatabaseEngine, type Connection } from '@/features/connections/types';
import { EngineIcon } from './EngineIcon';
import { SchemaDiff } from './SchemaDiff';
import { useWorkspaceStore } from '@/stores/workspace.store';
import {
  usePlanMigration,
  useGenerateScript,
  useValidateMigration,
} from '../hooks/useMigration';
import { migrationsApi, type RunPayload, type ColumnInfo } from '../api/migrations.api';
import type {
  MigrationPlan, Conflict, ScriptResult, RunReportRow, TableState,
  ValidationReport, ValidationIssue, Severity,
} from '../types';

interface Props {
  onClose: () => void;
}

type Step = 'select' | 'configure' | 'validate' | 'script' | 'run';

// Shared column template so the header and every row align exactly:
// checkbox · source table · target table · source rows · target rows · status.
const TABLE_GRID =
  'grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_3.75rem_3.75rem_4.75rem] items-center gap-2';

const CONFLICT_DESC: Record<Conflict, string> = {
  skip: 'Existing rows in the target with the same primary key will be skipped.',
  upsert: 'Existing rows with the same primary key will be updated in place.',
  truncate: 'All existing rows in the selected target tables are deleted before loading.',
};

const SEV_COLOR: Record<Severity, string> = {
  BLOCKER: 'text-red-600 dark:text-red-400',
  ERROR: 'text-red-600 dark:text-red-400',
  WARNING: 'text-amber-600 dark:text-amber-400',
  INFO: 'text-muted-foreground',
};

export function MigrationWizard({ onClose }: Props) {
  const { data: connections } = useConnections();
  const { currentWorkspace } = useWorkspaceStore();
  // Connect/query-only engines (Redshift, Snowflake) are excluded — data
  // migration isn't supported for them yet.
  const active = (connections ?? []).filter(
    (c) =>
      c.status === 'ACTIVE' &&
      c.engine !== 'redshift' &&
      c.engine !== 'snowflake',
  );

  const [step, setStep] = useState<Step>('select');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');

  // Migration is same-engine only. Constrain the pickers so a MySQL↔PostgreSQL
  // pair can't even be selected (the API would reject it anyway).
  const engineOf = (id: string) => active.find((c) => c.id === id)?.engine;
  const sourceEngine = engineOf(sourceId);
  const targetEngine = engineOf(targetId);
  const selectSource = (id: string) => {
    setSourceId(id);
    if (targetId && engineOf(targetId) !== engineOf(id)) setTargetId('');
  };
  const selectTarget = (id: string) => {
    setTargetId(id);
    if (sourceId && engineOf(sourceId) !== engineOf(id)) setSourceId('');
  };

  const plan = usePlanMigration();
  const script = useGenerateScript();
  const validate = useValidateMigration();
  const confirm = useConfirm();
  const toast = useToast();
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);

  const [planData, setPlanData] = useState<MigrationPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createTables, setCreateTables] = useState(true);
  const [createMissingColumns, setCreateMissingColumns] = useState(true);
  const [conflict, setConflict] = useState<Conflict>('skip');
  const [tableSearch, setTableSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<'all' | 'new' | 'existing'>('all');
  // Per-source-table target name (manual table mapping); identity unless renamed.
  const [tableTargets, setTableTargets] = useState<Record<string, string>>({});
  // Column mapping (manual): which table's panel is open, fetched columns, and the map.
  const [colPanel, setColPanel] = useState<string | null>(null);
  const [colData, setColData] = useState<Record<string, { source: ColumnInfo[]; target: ColumnInfo[] }>>({});
  const [colLoading, setColLoading] = useState<string | null>(null);
  const [columnMaps, setColumnMaps] = useState<Record<string, Array<{ source: string; target: string | null }>>>({});

  const [scriptResult, setScriptResult] = useState<ScriptResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Run state
  const [running, setRunning] = useState(false);
  const [tableStates, setTableStates] = useState<Record<string, TableState>>({});
  const [report, setReport] = useState<RunReportRow[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const orderedSelected = useMemo(
    () => (planData?.order ?? []).filter((t) => selected.has(t)),
    [planData, selected],
  );

  const planRows = (planData?.tables ?? []).reduce((s, t) => s + t.sourceRows, 0);
  const planNew = (planData?.tables ?? []).filter((t) => !t.existsOnTarget).length;
  const planExisting = (planData?.tables ?? []).filter((t) => t.existsOnTarget).length;
  const visibleTables = (planData?.tables ?? []).filter((t) => {
    if (tableFilter === 'new' && t.existsOnTarget) return false;
    if (tableFilter === 'existing' && !t.existsOnTarget) return false;
    if (tableSearch && !t.tableName.toLowerCase().includes(tableSearch.toLowerCase())) return false;
    return true;
  });

  // Only send entries where the target name was actually changed from the source.
  const buildMappings = () =>
    orderedSelected
      .map((t) => ({ source: t, target: (tableTargets[t] ?? t).trim() }))
      .filter((m) => m.target && m.target !== m.source);

  // Only tables the user explicitly configured get a column map (others copy all).
  const buildColumnMappings = () =>
    orderedSelected
      .filter((t) => columnMaps[t])
      .map((t) => ({
        table: t,
        columns: columnMaps[t]
          .filter((c) => c.target)
          .map((c) => ({ source: c.source, target: c.target as string })),
      }))
      .filter((m) => m.columns.length > 0);

  // Columns mapped to a target that doesn't exist yet ⇒ create them (ALTER ADD).
  const buildAddColumns = () =>
    orderedSelected
      .filter((t) => columnMaps[t] && colData[t])
      .map((t) => {
        const existing = new Set(colData[t].target.map((c) => c.name));
        return {
          table: t,
          columns: columnMaps[t].filter((c) => c.target && !existing.has(c.target)).map((c) => c.source),
        };
      })
      .filter((m) => m.columns.length > 0);

  const payload = (): RunPayload => ({
    sourceConnectionId: sourceId,
    targetConnectionId: targetId,
    tables: orderedSelected,
    createTables,
    createMissingColumns,
    conflict,
    tableMappings: buildMappings(),
    columnMappings: buildColumnMappings(),
    addColumns: buildAddColumns(),
  });

  const loadColumns = async (table: string) => {
    setColLoading(table);
    try {
      const r = await migrationsApi.suggestColumns(currentWorkspace?.id ?? '', {
        sourceConnectionId: sourceId,
        targetConnectionId: targetId,
        sourceTable: table,
        targetTable: (tableTargets[table] ?? table).trim() || table,
      });
      setColData((d) => ({ ...d, [table]: { source: r.source, target: r.target } }));
      // Default an unmatched source column to "create on target" (target = its own
      // name), not ignore — migrations should carry data across by default.
      const withCreateDefault = r.mapping.map((m) => ({
        source: m.source,
        target: m.target ?? m.source,
      }));
      setColumnMaps((m) => ({ ...m, [table]: withCreateDefault }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setColLoading(null);
    }
  };

  const toggleColPanel = (table: string) => {
    if (colPanel === table) { setColPanel(null); return; }
    setColPanel(table);
    if (!colData[table]) void loadColumns(table);
  };

  const setColTarget = (table: string, source: string, target: string | null) =>
    setColumnMaps((m) => ({
      ...m,
      [table]: (m[table] ?? []).map((c) => (c.source === source ? { ...c, target } : c)),
    }));

  const handlePreview = () => {
    plan.mutate(
      { source: sourceId, target: targetId },
      {
        onSuccess: (p) => {
          setPlanData(p);
          setSelected(new Set(p.tables.map((t) => t.tableName)));
          setStep('configure');
        },
      },
    );
  };

  const handleGenerateScript = () => {
    script.mutate(payload(), {
      onSuccess: (r) => {
        setScriptResult(r);
        setStep('script');
      },
    });
  };

  const handleValidate = () => {
    validate.mutate(
      {
        sourceConnectionId: sourceId,
        targetConnectionId: targetId,
        tables: orderedSelected,
        mode: conflict === 'truncate' ? 'overwrite' : 'append',
        tableMappings: buildMappings(),
      },
      {
        onSuccess: (r) => {
          setValidationReport(r);
          setStep('validate');
        },
        onError: (e) => toast.error(errMsg(e)),
      },
    );
  };

  const handleRun = async (skipValidation = false) => {
    const targetName = planData?.target.name ?? 'the target';
    const ok = await confirm({
      title: conflict === 'truncate' ? 'Truncate & load' : 'Run migration',
      description:
        conflict === 'truncate'
          ? `TRUNCATE will DELETE all existing rows in the selected tables on "${targetName}" before loading. This cannot be undone. Continue?`
          : `This will write data into "${targetName}". Continue?`,
      confirmLabel: 'Run migration',
      variant: conflict === 'truncate' ? 'danger' : 'default',
    });
    if (!ok) return;

    setStep('run');
    setRunning(true);
    setReport(null);
    setRunError(null);
    setTableStates(
      Object.fromEntries(
        orderedSelected.map((t) => [t, { status: 'pending', copied: 0, total: 0 }]),
      ),
    );

    cancelRef.current = migrationsApi.run(currentWorkspace?.id ?? '', { ...payload(), skipValidation }, {
      onTable: (e) => {
        const table = String(e['table']);
        setTableStates((prev) => ({
          ...prev,
          [table]: {
            ...prev[table],
            status: e['status'] as TableState['status'],
            sourceRows: e['sourceRows'] as number | undefined,
            targetRows: e['targetRows'] as number | undefined,
            copied: (e['copied'] as number) ?? prev[table]?.copied ?? 0,
            error: e['error'] as string | undefined,
          },
        }));
      },
      onProgress: (table, copied, total) =>
        setTableStates((prev) => ({
          ...prev,
          [table]: { ...prev[table], status: 'start', copied, total },
        })),
      onDone: (r) => {
        setReport(r);
        setRunning(false);
        const total = r.reduce((s, x) => s + x.copied, 0);
        const issues = r.some((x) => x.status === 'error' || x.sourceRows !== x.targetRows);
        if (issues) toast.info(`Migration finished — ${total.toLocaleString()} rows copied; some tables need review.`);
        else toast.success(`Migration complete — ${total.toLocaleString()} rows copied.`);
      },
      onError: (msg) => {
        setRunError(msg);
        setRunning(false);
        toast.error(msg);
      },
    });
  };

  const copyScript = async () => {
    if (!scriptResult) return;
    await navigator.clipboard.writeText(scriptResult.sql);
    setCopied(true);
    toast.success('Migration script copied.');
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadScript = () => {
    if (!scriptResult) return;
    const blob = new Blob([scriptResult.sql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migration.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (t: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-md shadow-[#5B4FF7]/30">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">Migrate data</h2>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Same-engine copy
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Copy tables and data from one connection to another.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                cancelRef.current?.();
                onClose();
              }}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Stepper step={step} />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 'select' && (
            <div className="space-y-5">
              {/* Source */}
              <ConnectionPicker
                title="Source connection"
                subtitle="Select the database you want to copy data from."
                value={sourceId}
                onChange={selectSource}
                onClear={() => setSourceId('')}
                options={active}
                exclude={targetId}
                engineFilter={targetEngine}
              />

              {/* Flow indicator */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                  <ArrowDown className="h-4 w-4" />
                </div>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Target */}
              <ConnectionPicker
                title="Target connection"
                subtitle="Select the database you want to copy data to."
                value={targetId}
                onChange={selectTarget}
                onClear={() => setTargetId('')}
                options={active}
                exclude={sourceId}
                engineFilter={sourceEngine}
              />

              {/* Same-engine validation note */}
              <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/[0.05] px-4 py-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-foreground/80">
                  <span className="font-medium text-foreground">Source and target must use the same database engine.</span>{' '}
                  Cross-engine migration (e.g. MySQL → PostgreSQL) isn&apos;t supported.
                </p>
              </div>

              {/* Benefits at a glance */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Benefit icon={Lock} title="Secure & private" desc="Encrypted; never leaves your environment." />
                <Benefit icon={Table2} title="Schema & data" desc="Tables, indexes and rows are migrated." />
                <Benefit icon={Zap} title="Reliable & safe" desc="Runs with real-time progress." />
                <Benefit icon={Clock} title="No downtime" desc="Existing databases stay unaffected." />
              </div>

              {/* Advanced options (configured on the next step) */}
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3">
                <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Advanced options</p>
                  <p className="text-xs text-muted-foreground">
                    Choose specific tables, conflict handling and create-table behaviour after preview.
                  </p>
                </div>
                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Next step</span>
              </div>

              {plan.isError && <p className="text-xs text-destructive">{errMsg(plan.error)}</p>}

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border pt-4">
                <button
                  onClick={() => { cancelRef.current?.(); onClose(); }}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePreview}
                  disabled={!sourceId || !targetId || sourceId === targetId || plan.isPending}
                  className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#5B4FF7]/30 transition-shadow hover:shadow-lg hover:shadow-[#5B4FF7]/40 disabled:opacity-40 disabled:shadow-none"
                >
                  {plan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Preview migration
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          )}

          {step === 'configure' && planData && (
            <div className="space-y-5">
              {/* Summary at a glance */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryStat icon={Table2} tint="primary" value={planData.tables.length} label="Tables" sub="In the plan" />
                <SummaryStat icon={FileCode} tint="sky" value={planRows.toLocaleString()} label="Total rows" sub="To be migrated" />
                <SummaryStat icon={CheckCircle2} tint="emerald" value={planNew} label="New tables" sub="Created on target" />
                <SummaryStat icon={Database} tint="violet" value={planExisting} label="Existing" sub="Already on target" />
              </div>

              {/* Source → Target overview */}
              <div className="flex items-center gap-4 rounded-xl border border-border bg-card/60 p-4">
                <Endpoint label="Source" engine={sourceEngine} name={planData.source.name} db={planData.source.database} />
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                  <ArrowRight className="h-4 w-4" />
                </div>
                <Endpoint label="Target" engine={targetEngine} name={planData.target.name} db={planData.target.database} align="right" />
              </div>

              {/* Migration options */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">Create missing tables</p>
                      <button
                        onClick={() => setCreateTables((v) => !v)}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
                          createTables ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {createTables ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">Tables that don’t exist on the target will be created.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">Create missing columns</p>
                      <button
                        onClick={() => setCreateMissingColumns((v) => !v)}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
                          createMissingColumns ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {createMissingColumns ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">Source columns absent on an existing target table are added automatically. Override per-column below.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">On conflict</p>
                      <Select
                        value={conflict}
                        onValueChange={(v) => setConflict(v as Conflict)}
                        options={[
                          { value: 'skip', label: 'Skip existing (by PK)' },
                          { value: 'upsert', label: 'Upsert (update existing)' },
                          { value: 'truncate', label: 'Truncate & load' },
                        ]}
                        ariaLabel="Conflict strategy"
                        className="px-2 py-0.5 text-xs"
                      />
                    </div>
                    <p className={cn('mt-0.5 text-xs', conflict === 'truncate' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                      {CONFLICT_DESC[conflict]}
                    </p>
                  </div>
                </div>
              </div>

              {/* Objects table */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2.5">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder="Search tables…"
                      className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary/40"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <FilterTab active={tableFilter === 'all'} onClick={() => setTableFilter('all')}>All ({planData.tables.length})</FilterTab>
                    <FilterTab active={tableFilter === 'new'} onClick={() => setTableFilter('new')}>New ({planNew})</FilterTab>
                    <FilterTab active={tableFilter === 'existing'} onClick={() => setTableFilter('existing')}>Existing ({planExisting})</FilterTab>
                  </div>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    Select all
                    <input
                      type="checkbox"
                      checked={selected.size === planData.tables.length && planData.tables.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(planData.tables.map((t) => t.tableName)) : new Set())
                      }
                      className="accent-primary"
                    />
                  </label>
                </div>

                <div className={cn(TABLE_GRID, 'px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground')}>
                  <span />
                  <span>Source table</span>
                  <span>Target table</span>
                  <span className="text-right">Src rows</span>
                  <span className="text-right">Tgt rows</span>
                  <span className="text-center">Status</span>
                </div>
                <div className="max-h-[34vh] overflow-y-auto">
                  {visibleTables.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">No tables match this filter.</p>
                  ) : (
                    visibleTables.map((t) => {
                      const target = tableTargets[t.tableName] ?? t.tableName;
                      const renamed = target.trim() !== '' && target.trim() !== t.tableName;
                      const mapped = (columnMaps[t.tableName] ?? []).filter((c) => c.target).length;
                      const ignored = (columnMaps[t.tableName] ?? []).filter((c) => !c.target).length;
                      return (
                        <div key={t.tableName} className="border-t border-border/40">
                          <div className={cn(TABLE_GRID, 'px-3 py-2 text-xs hover:bg-accent/30')}>
                            <input type="checkbox" checked={selected.has(t.tableName)} onChange={() => toggle(t.tableName)} className="accent-primary" />
                            <span className="flex min-w-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleColPanel(t.tableName)}
                                aria-label={`Map columns for ${t.tableName}`}
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                              >
                                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', colPanel === t.tableName && 'rotate-90')} />
                              </button>
                              <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <button type="button" onClick={() => toggle(t.tableName)} className="truncate text-left font-mono text-foreground">
                                {t.tableName}
                              </button>
                              {ignored > 0 && (
                                <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground" title={`${mapped} mapped, ${ignored} ignored`}>
                                  {mapped}/{mapped + ignored} cols
                                </span>
                              )}
                            </span>
                            <input
                              value={target}
                              onChange={(e) => setTableTargets((m) => ({ ...m, [t.tableName]: e.target.value }))}
                              aria-label={`Target table for ${t.tableName}`}
                              spellCheck={false}
                              className={cn(
                                'w-full rounded border bg-background px-1.5 py-1 font-mono text-[11px] outline-none focus:border-primary/40',
                                renamed ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
                              )}
                            />
                            <span className="text-right tabular-nums text-muted-foreground">{t.sourceRows.toLocaleString()}</span>
                            <span className="text-right tabular-nums text-muted-foreground">{!renamed && t.existsOnTarget ? (t.targetRows ?? 0).toLocaleString() : '—'}</span>
                            <span className="flex justify-center">
                              {renamed ? (
                                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">Renamed</span>
                              ) : t.existsOnTarget ? (
                                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">Existing</span>
                              ) : (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">New</span>
                              )}
                            </span>
                          </div>
                          {colPanel === t.tableName && (
                            <ColumnMapPanel
                              table={t.tableName}
                              data={colData[t.tableName]}
                              map={columnMaps[t.tableName]}
                              loading={colLoading === t.tableName}
                              onSuggest={() => void loadColumns(t.tableName)}
                              onSet={(src, tgt) => setColTarget(t.tableName, src, tgt)}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border pt-4">
                <button onClick={() => setStep('select')} className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateScript}
                    disabled={orderedSelected.length === 0 || script.isPending}
                    className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    {script.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode className="h-4 w-4" />}
                    Generate script
                  </button>
                  <button
                    onClick={handleValidate}
                    disabled={orderedSelected.length === 0 || validate.isPending}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#5B4FF7]/30 transition-shadow hover:shadow-lg hover:shadow-[#5B4FF7]/40 disabled:opacity-40 disabled:shadow-none"
                  >
                    {validate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Validate &amp; review
                  </button>
                </div>
              </div>
              {script.isError && <p className="text-xs text-destructive">{errMsg(script.error)}</p>}
              {validate.isError && <p className="text-xs text-destructive">{errMsg(validate.error)}</p>}
            </div>
          )}

          {step === 'validate' && validationReport && (
            <div className="space-y-4">
              <div className="flex items-center gap-5">
                <div className="text-center shrink-0">
                  <div className={cn('text-4xl font-bold', scoreColor(validationReport.migrationReadinessScore.score))}>
                    {validationReport.migrationReadinessScore.score}
                  </div>
                  <div className="text-[10px] text-muted-foreground">/ 100</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={validationReport.migrationReadinessScore.status} />
                    <span className="text-sm">{validationReport.finalRecommendation.summary}</span>
                  </div>
                  <div className="flex gap-3 mt-1.5 text-xs">
                    <span className="text-red-600 dark:text-red-400">{validationReport.migrationReadinessScore.blockers.length} blockers</span>
                    <span className="text-red-600 dark:text-red-400">{validationReport.allIssues.filter((i) => i.severity === 'ERROR').length} errors</span>
                    <span className="text-amber-600 dark:text-amber-400">{validationReport.migrationReadinessScore.warnings.length} warnings</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {validationReport.riskAssessment.classification} · {validationReport.riskAssessment.totalRows.toLocaleString()} rows · ~{formatDuration(validationReport.riskAssessment.estimatedDurationSeconds)} · {validationReport.riskAssessment.recommendedStrategy.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 max-h-[38vh] overflow-y-auto">
                {validationReport.allIssues.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" /> No issues — ready to migrate.
                  </p>
                ) : (
                  validationReport.allIssues.map((iss, i) => <IssueRow key={i} issue={iss} />)
                )}
              </div>

              {validationReport.schemaComparison && validationReport.schemaComparison.tables.length > 0 && (
                <details className="text-xs" open>
                  <summary className="mb-2 flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                    <GitCompare className="h-3.5 w-3.5" /> Schema diff ({validationReport.schemaComparison.tables.length} table{validationReport.schemaComparison.tables.length !== 1 ? 's' : ''})
                  </summary>
                  <div className="max-h-[40vh] overflow-y-auto pr-1">
                    <SchemaDiff report={validationReport} />
                  </div>
                </details>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5" /> Execution plan ({validationReport.executionPlan.length} steps)
                </summary>
                <ol className="mt-2 space-y-1 pl-5 text-muted-foreground list-decimal">
                  {validationReport.executionPlan.map((s) => (
                    <li key={s.step}>
                      {s.action}
                      {s.tables && s.tables.length > 0 && (
                        <span className="text-muted-foreground/60"> — {s.tables.length} table(s)</span>
                      )}
                    </li>
                  ))}
                </ol>
              </details>

              {!validationReport.finalRecommendation.proceed && (
                <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <ShieldAlert className="w-3.5 h-3.5" /> Migration is blocked — resolve all blocker issues before running.
                </p>
              )}

              <div className="flex items-center justify-between">
                <button onClick={() => setStep('configure')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-muted-foreground">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={handleGenerateScript} disabled={script.isPending} className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border border-border hover:bg-accent disabled:opacity-40">
                    {script.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />} Generate script
                  </button>
                  <button
                    onClick={() => handleRun(true)}
                    disabled={!validationReport.finalRecommendation.proceed}
                    title={!validationReport.finalRecommendation.proceed ? 'Resolve blockers first' : undefined}
                    className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                  >
                    <Play className="w-4 h-4" /> Run migration
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'script' && scriptResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {scriptResult.rowsIncluded.toLocaleString()} rows included
                  {scriptResult.truncated && <span className="text-amber-600 dark:text-amber-400"> · capped (large tables truncated — use Run for full copy)</span>}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => void copyScript()} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" /> : <Copy className="w-3.5 h-3.5" />} Copy
                  </button>
                  <button onClick={downloadScript} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20">
                    <Download className="w-3.5 h-3.5" /> Download .sql
                  </button>
                </div>
              </div>
              <pre className="bg-background border border-border rounded-lg p-3 text-[11px] font-mono overflow-auto max-h-[55vh] whitespace-pre">
                {scriptResult.sql}
              </pre>
              <button onClick={() => setStep('configure')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-muted-foreground">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            </div>
          )}

          {step === 'run' && (
            <div className="space-y-3">
              {runError && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {runError}
                </div>
              )}
              <div className="space-y-1.5">
                {orderedSelected.map((t) => {
                  const s = tableStates[t];
                  const pct = s?.total ? Math.min(100, Math.round((s.copied / s.total) * 100)) : 0;
                  const mismatch = s?.status === 'done' && s.sourceRows !== undefined && s.sourceRows !== s.targetRows;
                  return (
                    <div key={t} className="border border-border rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono truncate flex items-center gap-1.5">
                          <StatusIcon status={s?.status} />
                          {t}
                        </span>
                        <span className="text-muted-foreground">
                          {s?.status === 'done'
                            ? `${(s.targetRows ?? 0).toLocaleString()} / ${(s.sourceRows ?? 0).toLocaleString()} rows${mismatch ? ' ⚠' : ''}`
                            : s?.status === 'error'
                              ? <span className="text-destructive">{s.error}</span>
                              : `${(s?.copied ?? 0).toLocaleString()}${s?.total ? ` / ${s.total.toLocaleString()}` : ''}`}
                        </span>
                      </div>
                      {s?.status === 'start' && (
                        <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {report && (
                <div className="flex items-center gap-2 text-sm pt-1">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                  Migration complete — {report.reduce((s, r) => s + r.copied, 0).toLocaleString()} rows copied across {report.length} tables.
                  {report.some((r) => r.status === 'error' || r.sourceRows !== r.targetRows) && (
                    <span className="text-amber-600 dark:text-amber-400">Some tables need review.</span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {running ? (
                  <button onClick={() => { cancelRef.current?.(); setRunning(false); }} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-muted-foreground">
                    Cancel
                  </button>
                ) : (
                  <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                    Done
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STEPPER = [
  { label: 'Select connections', desc: 'Choose source & target' },
  { label: 'Review plan', desc: 'Preview what will be copied' },
  { label: 'Confirm & run', desc: 'Start migration' },
];

function Stepper({ step }: { step: Step }) {
  // Select (0) → Review plan / configure (1) → Confirm & run / validate·script·run (2).
  const current = step === 'select' ? 0 : step === 'configure' ? 1 : 2;
  return (
    <div className="mt-8 flex items-center">
      {STEPPER.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done && 'bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white',
                  active && 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/30',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div className="hidden sm:block">
                <p className={cn('text-xs font-semibold leading-tight', active || done ? 'text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">{s.desc}</p>
              </div>
            </div>
            {i < STEPPER.length - 1 && (
              <div className={cn('mx-3 h-px flex-1', done ? 'bg-primary/40' : 'bg-border')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Benefit({ icon: Icon, title, desc }: { icon: typeof Lock; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-2 text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
    </div>
  );
}

const STAT_TINT: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

function SummaryStat({
  icon: Icon, tint, value, label, sub,
}: {
  icon: typeof Table2;
  tint: keyof typeof STAT_TINT;
  value: string | number;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card/60 p-3.5">
      <div className={cn('flex h-14 w-14 items-center justify-center rounded-lg', STAT_TINT[tint])}>
        <Icon className="h-8 w-8" />
      </div>
      <div>
        <p className="text-xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Endpoint({
  label, engine, name, db, align = 'left',
}: {
  label: string;
  engine?: DatabaseEngine;
  name: string;
  db: string;
  align?: 'left' | 'right';
}) {
  const right = align === 'right';
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-3', right && 'flex-row-reverse text-right')}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
        <EngineIcon engine={engine} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{engineLabel(engine)} · {db}</p>
      </div>
    </div>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

const IGNORE = '__ignore__';
const CREATE = '__create__';

function ColumnMapPanel({
  data,
  map,
  loading,
  onSuggest,
  onSet,
}: {
  table: string;
  data?: { source: ColumnInfo[]; target: ColumnInfo[] };
  map?: Array<{ source: string; target: string | null }>;
  loading: boolean;
  onSuggest: () => void;
  onSet: (source: string, target: string | null) => void;
}) {
  const targetOf = (col: string) => map?.find((m) => m.source === col)?.target ?? null;
  const existing = new Set((data?.target ?? []).map((c) => c.name));

  return (
    <div className="border-t border-border/40 bg-muted/20 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Column mapping {data && <span className="font-normal normal-case">· map, ignore, or create on target</span>}
        </span>
        <button
          type="button"
          onClick={onSuggest}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-primary" />}
          AI suggest
        </button>
      </div>

      {loading && !data ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-muted/60" />
          ))}
        </div>
      ) : !data ? (
        <p className="py-2 text-center text-xs text-muted-foreground">Couldn’t load columns.</p>
      ) : (
        <div className="space-y-1">
          {data.source.map((sc) => {
            const tgt = targetOf(sc.name);
            // tgt set but not an existing target column ⇒ it will be created.
            const willCreate = !!tgt && !existing.has(tgt);
            const selectValue = tgt == null ? IGNORE : willCreate ? CREATE : tgt;
            return (
              <div key={sc.name} className="grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-foreground">{sc.name}</span>
                  <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{sc.type}</code>
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <select
                  value={selectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    onSet(sc.name, v === IGNORE ? null : v === CREATE ? sc.name : v);
                  }}
                  className={cn(
                    'w-full rounded border bg-background px-1.5 py-1 font-mono text-[11px] outline-none focus:border-primary/40',
                    willCreate
                      ? 'border-violet-500/40 text-violet-600 dark:text-violet-400'
                      : tgt
                        ? 'border-border text-foreground'
                        : 'border-amber-500/40 text-amber-600 dark:text-amber-400',
                  )}
                >
                  <option value={IGNORE}>— Ignore (don’t copy) —</option>
                  {data.target.map((tc) => (
                    <option key={tc.name} value={tc.name}>
                      {tc.name} ({tc.type})
                    </option>
                  ))}
                  <option value={CREATE}>➕ Create “{sc.name}” on target</option>
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STATUS_TONE: Record<Connection['status'], string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ERROR: 'bg-red-500/10 text-red-600 dark:text-red-400',
  DISCONNECTED: 'bg-muted text-muted-foreground',
};

function ConnectionPicker({
  title, subtitle, value, onChange, onClear, options, exclude, engineFilter,
}: {
  title: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  options: Connection[];
  exclude: string;
  engineFilter?: DatabaseEngine;
}) {
  const choices = options
    .filter((o) => o.id !== exclude)
    .filter((o) => !engineFilter || o.engine === engineFilter);
  const selected = options.find((o) => o.id === value);

  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mb-2 text-xs text-muted-foreground">{subtitle}</p>

      {selected ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
              <EngineIcon engine={selected.engine} className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{selected.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {engineLabel(selected.engine)} · {selected.databaseName} · {selected.host}
              </p>
            </div>
            <button
              onClick={onClear}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Change
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Table2 className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{selected._count?.schemaMetadata ?? 0}</span> tables
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{engineLabel(selected.engine)}</span>
            </span>
            <span className={cn('ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[selected.status])}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {selected.status.charAt(0) + selected.status.slice(1).toLowerCase()}
            </span>
          </div>
        </div>
      ) : (
        <Select
          value={value}
          onValueChange={onChange}
          placeholder={choices.length ? 'Select a connection…' : 'No eligible connections'}
          options={choices.map((o) => ({ value: o.id, label: `${o.name} · ${o.databaseName}` }))}
          ariaLabel={title}
          className="w-full"
        />
      )}
    </div>
  );
}

function StatusIcon({ status }: { status?: TableState['status'] }) {
  if (status === 'done') return <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />;
  if (status === 'error') return <AlertTriangle className="w-3 h-3 text-destructive" />;
  if (status === 'start' || status === 'created') return <Loader2 className="w-3 h-3 animate-spin text-primary" />;
  return <span className="w-3 h-3 rounded-full border border-border inline-block" />;
}

function errMsg(error: unknown): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (error instanceof Error ? error.message : 'Something went wrong')
  );
}

function scoreColor(s: number): string {
  return s >= 85 ? 'text-green-600 dark:text-green-400' : s >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function StatusBadge({ status }: { status: ValidationReport['migrationReadinessScore']['status'] }) {
  const map: Record<string, string> = {
    READY: 'bg-green-500/10 text-green-600 dark:text-green-400',
    READY_WITH_WARNINGS: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    NOT_READY: 'bg-red-500/10 text-red-600 dark:text-red-400',
  };
  return (
    <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded', map[status])}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const Icon =
    issue.severity === 'BLOCKER' || issue.severity === 'ERROR'
      ? AlertTriangle
      : issue.severity === 'WARNING'
        ? ShieldAlert
        : Info;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
      <Icon className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', SEV_COLOR[issue.severity])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[10px] font-semibold uppercase', SEV_COLOR[issue.severity])}>
            {issue.severity}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">{issue.code}</span>
          {issue.table && (
            <span className="text-[11px] font-mono text-muted-foreground">
              {issue.table}
              {issue.column ? `.${issue.column}` : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground/85 mt-0.5">{issue.message}</p>
      </div>
    </div>
  );
}
