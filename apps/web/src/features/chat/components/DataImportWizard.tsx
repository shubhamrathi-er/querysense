'use client';

import { useMemo, useState } from 'react';
import {
  FileSpreadsheet, X, Table2, Plus, ArrowRight, ArrowLeft,
  Check, AlertCircle, Loader2, CheckCircle2, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import {
  inferColumnType,
  toIdentifier,
  applyRowFilter,
  describeFilter,
  NEW_TABLE_TYPES,
  NEW_TABLE_TYPE_LABELS,
  type ParsedCsv,
  type NewTableType,
  type FilterSpec,
} from '../lib/data-import';
import {
  useImportTargets,
  useCsvImport,
  useInterpretFilter,
} from '../hooks/useCsvImport';
import type {
  CsvColumnMapping,
  ImportTargetTable,
} from '../api/csv-import.api';

type Step = 'choose' | 'existing' | 'new' | 'done';

interface NewColumn {
  csvColumn: string;
  dbColumn: string;
  dbType: NewTableType;
}

interface Props {
  fileName: string;
  /** Source format label (e.g. CSV, JSON, XML, HTML, Excel) used throughout the UI. */
  format: string;
  parsed: ParsedCsv;
  connectionId: string;
  onClose: () => void;
  /** Excel only: available sheet names + active selection. */
  sheets?: string[];
  activeSheet?: string;
  onSheetChange?: (name: string) => void;
  /** Called once an import succeeds, so it can be recorded in chat history. */
  onImported?: (info: {
    fileName: string;
    format: string;
    sheet?: string;
    tableName: string;
    mode: 'existing' | 'new';
    result: import('../api/csv-import.api').CsvImportResult;
    context?: { instruction: string; description: string };
  }) => void;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function DataImportWizard({
  fileName,
  format,
  parsed,
  connectionId,
  onClose,
  sheets,
  activeSheet,
  onSheetChange,
  onImported,
}: Props) {
  const [step, setStep] = useState<Step>('choose');

  // Inferred schema for the "create new table" path.
  const inferred = useMemo<NewColumn[]>(
    () =>
      parsed.headers.map((header) => {
        const values = parsed.rows.map((r) => r[header]);
        return {
          csvColumn: header,
          dbColumn: toIdentifier(header),
          dbType: inferColumnType(values),
        };
      }),
    [parsed],
  );

  const [newTableName, setNewTableName] = useState('');
  const [newColumns, setNewColumns] = useState<NewColumn[]>(inferred);

  // Existing-table path state.
  const [selectedTable, setSelectedTable] = useState('');
  // DB column name -> CSV header (or '' for skip).
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // CSV headers with no matching column in the table → optionally add them.
  const [addColumns, setAddColumns] = useState<
    Record<string, { enabled: boolean; dbColumn: string; dbType: NewTableType }>
  >(() =>
    Object.fromEntries(
      inferred.map((c) => [
        c.csvColumn,
        { enabled: false, dbColumn: c.dbColumn, dbType: c.dbType },
      ]),
    ),
  );
  // DB columns chosen as the unique key for duplicate-skipping.
  const [uniqueKeys, setUniqueKeys] = useState<string[]>([]);

  // Optional context: a plain-language instruction → a row filter.
  const [contextText, setContextText] = useState('');
  const [filter, setFilter] = useState<FilterSpec | null>(null);
  const interpret = useInterpretFilter();

  // Rows after applying the context filter — used everywhere downstream.
  const workingRows = useMemo(
    () => applyRowFilter(parsed.rows, filter),
    [parsed.rows, filter],
  );
  const view: ParsedCsv = { headers: parsed.headers, rows: workingRows };

  const applyContext = async () => {
    const text = contextText.trim();
    if (!text) {
      setFilter(null);
      return;
    }
    try {
      const spec = await interpret.mutateAsync({
        columns: parsed.headers,
        sampleRows: parsed.rows.slice(0, 20),
        instruction: text,
      });
      setFilter(spec.conditions.length > 0 ? spec : null);
    } catch {
      // interpret.isError drives the error message in the UI.
    }
  };

  const clearContext = () => {
    setContextText('');
    setFilter(null);
  };

  const csvImport = useCsvImport();
  const { data: targets, isLoading: targetsLoading } = useImportTargets(
    connectionId,
    step === 'existing',
  );

  const targetTable: ImportTargetTable | undefined = targets?.find(
    (t) => t.tableName === selectedTable,
  );

  // CSV headers that don't correspond to any column in the chosen table.
  const existingColNames = new Set(
    targetTable?.columns.map((c) => c.columnName.toLowerCase()) ?? [],
  );
  const extraHeaders = targetTable
    ? parsed.headers.filter((h) => !existingColNames.has(toIdentifier(h)))
    : [];
  const enabledAdded = extraHeaders.filter((h) => addColumns[h]?.enabled);

  const handlePickTable = (tableName: string) => {
    setSelectedTable(tableName);
    setUniqueKeys([]);
    const table = targets?.find((t) => t.tableName === tableName);
    if (!table) return;
    // Auto-match DB columns to CSV headers by normalized name.
    const next: Record<string, string> = {};
    for (const col of table.columns) {
      if (col.isAutoIncrement) continue;
      const match = parsed.headers.find(
        (h) => toIdentifier(h) === col.columnName.toLowerCase(),
      );
      next[col.columnName] = match ?? '';
    }
    setMapping(next);
  };

  // ── Validation ───────────────────────────────────────────
  const newTableValid =
    IDENT_RE.test(newTableName) &&
    newColumns.every((c) => IDENT_RE.test(c.dbColumn)) &&
    new Set(newColumns.map((c) => c.dbColumn)).size === newColumns.length;

  const unmappedRequired =
    targetTable?.columns.filter((c) => c.isRequired && !mapping[c.columnName]) ??
    [];
  const mappedExisting = targetTable
    ? targetTable.columns
        .filter((c) => mapping[c.columnName])
        .map((c) => c.columnName)
    : [];
  const addedDbColumns = enabledAdded.map((h) => addColumns[h].dbColumn);
  const allTargets = [...mappedExisting, ...addedDbColumns];
  const addedValid = enabledAdded.every((h) =>
    IDENT_RE.test(addColumns[h].dbColumn),
  );
  const noDuplicateTargets = new Set(allTargets).size === allTargets.length;
  const existingValid =
    !!targetTable &&
    unmappedRequired.length === 0 &&
    allTargets.length > 0 &&
    addedValid &&
    noDuplicateTargets;

  // Only keys whose column is actually mapped can be used for dedupe.
  const effectiveUniqueKeys = uniqueKeys.filter((k) => mapping[k]);

  const runImport = async (mode: 'existing' | 'new') => {
    let tableName: string;
    let columns: CsvColumnMapping[];

    if (mode === 'new') {
      tableName = newTableName;
      columns = newColumns.map((c) => ({
        csvColumn: c.csvColumn,
        dbColumn: c.dbColumn,
        dbType: c.dbType,
      }));
    } else {
      tableName = selectedTable;
      columns = [
        // Map onto existing columns.
        ...Object.entries(mapping)
          .filter(([, csv]) => csv)
          .map(([dbColumn, csvColumn]) => ({ csvColumn, dbColumn })),
        // New columns to be added to the table (dbType signals "add").
        ...enabledAdded.map((h) => ({
          csvColumn: h,
          dbColumn: addColumns[h].dbColumn,
          dbType: addColumns[h].dbType,
        })),
      ];
    }

    const result = await csvImport.mutateAsync({
      connectionId,
      mode,
      tableName,
      columns,
      uniqueKeys: mode === 'existing' ? effectiveUniqueKeys : undefined,
      rows: workingRows,
    });
    setStep('done');
    onImported?.({
      fileName,
      format,
      sheet: activeSheet,
      tableName,
      mode,
      result,
      context: filter
        ? { instruction: contextText.trim(), description: describeFilter(filter) }
        : undefined,
    });
  };

  const result = csvImport.data;

  return (
    <div className="flex gap-3 max-w-4xl">
      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
      </div>

      <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl rounded-tl-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{fileName}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
              {format}
            </span>
            {sheets && sheets.length > 1 && onSheetChange && (
              <Select
                value={activeSheet ?? ''}
                onValueChange={onSheetChange}
                options={sheets.map((s) => ({ value: s, label: s }))}
                ariaLabel="Select sheet"
                className="max-w-[140px] shrink-0 px-1.5 py-1 text-xs"
              />
            )}
            <span className="text-xs text-muted-foreground shrink-0">
              {filter
                ? `${workingRows.length.toLocaleString()} of ${parsed.rows.length.toLocaleString()} rows`
                : `${parsed.rows.length.toLocaleString()} rows`}{' '}
              · {parsed.headers.length} columns
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-accent text-muted-foreground transition-colors shrink-0"
            aria-label="Close importer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {step === 'choose' && (
            <ChooseStep
              parsed={view}
              totalRows={parsed.rows.length}
              inferred={inferred}
              contextText={contextText}
              setContextText={setContextText}
              onApplyContext={() => void applyContext()}
              onClearContext={clearContext}
              filterActive={!!filter}
              filterDescription={describeFilter(filter)}
              interpreting={interpret.isPending}
              interpretError={interpret.isError}
              onExisting={() => setStep('existing')}
              onNew={() => {
                setNewColumns(inferred);
                setStep('new');
              }}
            />
          )}

          {step === 'existing' && (
            <ExistingStep
              format={format}
              parsed={view}
              targets={targets}
              loading={targetsLoading}
              selectedTable={selectedTable}
              targetTable={targetTable}
              mapping={mapping}
              setMapping={setMapping}
              onPickTable={handlePickTable}
              unmappedRequired={unmappedRequired}
              extraHeaders={extraHeaders}
              addColumns={addColumns}
              setAddColumns={setAddColumns}
              uniqueKeys={uniqueKeys}
              setUniqueKeys={setUniqueKeys}
              valid={existingValid}
              isImporting={csvImport.isPending}
              error={csvImport.error}
              onBack={() => setStep('choose')}
              onConfirm={() => void runImport('existing')}
            />
          )}

          {step === 'new' && (
            <NewStep
              format={format}
              parsed={view}
              tableName={newTableName}
              setTableName={setNewTableName}
              columns={newColumns}
              setColumns={setNewColumns}
              valid={newTableValid}
              isImporting={csvImport.isPending}
              error={csvImport.error}
              onBack={() => setStep('choose')}
              onConfirm={() => void runImport('new')}
            />
          )}

          {step === 'done' && result && (
            <DoneStep result={result} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: choose existing vs new ──────────────────────────

function ChooseStep({
  parsed,
  totalRows,
  inferred,
  contextText,
  setContextText,
  onApplyContext,
  onClearContext,
  filterActive,
  filterDescription,
  interpreting,
  interpretError,
  onExisting,
  onNew,
}: {
  parsed: ParsedCsv;
  totalRows: number;
  inferred: NewColumn[];
  contextText: string;
  setContextText: (v: string) => void;
  onApplyContext: () => void;
  onClearContext: () => void;
  filterActive: boolean;
  filterDescription: string;
  interpreting: boolean;
  interpretError: boolean;
  onExisting: () => void;
  onNew: () => void;
}) {
  const noRows = parsed.rows.length === 0;
  return (
    <div className="space-y-4">
      {/* Context / instructions */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Context / instructions{' '}
          <span className="text-muted-foreground/60">(optional)</span>
        </label>
        <div className="flex items-start gap-2">
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            placeholder="e.g. only import rows where status is approved"
            rows={2}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50 resize-none"
          />
          <button
            onClick={onApplyContext}
            disabled={interpreting || !contextText.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 shrink-0"
          >
            {interpreting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Apply
          </button>
        </div>

        {interpretError && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5" />
            Couldn&apos;t interpret that — try rephrasing, e.g. “status is
            approved”.
          </p>
        )}

        {filterActive && (
          <div className="flex items-start justify-between gap-2 bg-primary/5 border border-primary/15 rounded-lg px-3 py-2">
            <p className="text-xs text-foreground/85">
              Keeping rows where{' '}
              <span className="font-medium">{filterDescription}</span> —{' '}
              <span className="text-primary font-medium">
                {parsed.rows.length.toLocaleString()}
              </span>{' '}
              of {totalRows.toLocaleString()} rows match.
            </p>
            <button
              onClick={onClearContext}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">Where should this data go?</p>

      <PreviewTable parsed={parsed} inferred={inferred} />

      {noRows ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5" />
          No rows match the current context — clear or adjust it before
          importing.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onExisting}
            className="flex flex-col items-start gap-1.5 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors text-left"
          >
            <Table2 className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">Existing table</span>
            <span className="text-xs text-muted-foreground">
              Map columns onto a table that already exists.
            </span>
          </button>
          <button
            onClick={onNew}
            className="flex flex-col items-start gap-1.5 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-accent/40 transition-colors text-left"
          >
            <Plus className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium">New table</span>
            <span className="text-xs text-muted-foreground">
              Create a new table from the inferred schema.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 2a: existing table mapping ─────────────────────────

type AddColumnState = Record<
  string,
  { enabled: boolean; dbColumn: string; dbType: NewTableType }
>;

function ExistingStep({
  format,
  parsed,
  targets,
  loading,
  selectedTable,
  targetTable,
  mapping,
  setMapping,
  onPickTable,
  unmappedRequired,
  extraHeaders,
  addColumns,
  setAddColumns,
  uniqueKeys,
  setUniqueKeys,
  valid,
  isImporting,
  error,
  onBack,
  onConfirm,
}: {
  format: string;
  parsed: ParsedCsv;
  targets: ImportTargetTable[] | undefined;
  loading: boolean;
  selectedTable: string;
  targetTable: ImportTargetTable | undefined;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  onPickTable: (t: string) => void;
  unmappedRequired: ImportTargetTable['columns'];
  extraHeaders: string[];
  addColumns: AddColumnState;
  setAddColumns: (
    updater: (prev: AddColumnState) => AddColumnState,
  ) => void;
  uniqueKeys: string[];
  setUniqueKeys: (updater: (prev: string[]) => string[]) => void;
  valid: boolean;
  isImporting: boolean;
  error: unknown;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Target table
        </span>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tables…
          </div>
        ) : targets && targets.length > 0 ? (
          <Select
            value={selectedTable}
            onValueChange={onPickTable}
            placeholder="Select a table…"
            options={targets.map((t) => ({ value: t.tableName, label: t.tableName }))}
            ariaLabel="Select a table"
            className="w-full"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No tables found in this database.
          </p>
        )}
      </label>

      {targetTable && (
        <>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Column mapping{' '}
              <span className="text-muted-foreground/60">
                ({format} → {targetTable.tableName})
              </span>
            </p>
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
              {targetTable.columns
                .filter((c) => !c.isAutoIncrement)
                .map((col) => (
                  <div
                    key={col.columnName}
                    className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2"
                  >
                    <Select
                      value={mapping[col.columnName] || '__skip__'}
                      onValueChange={(v) =>
                        setMapping({ ...mapping, [col.columnName]: v === '__skip__' ? '' : v })
                      }
                      options={[
                        { value: '__skip__', label: '— skip —' },
                        ...parsed.headers.map((h) => ({ value: h, label: h })),
                      ]}
                      ariaLabel={`Map ${col.columnName}`}
                      className={cn(
                        'px-2 py-1.5 text-xs',
                        col.isRequired && !mapping[col.columnName] && 'border-amber-500/50',
                      )}
                    />

                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />

                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-mono truncate">
                        {col.columnName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 shrink-0">
                        {col.dataType}
                      </span>
                      {col.isRequired && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
                          required
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {extraHeaders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                New columns in {format}{' '}
                <span className="text-muted-foreground/60">
                  (not in {targetTable.tableName})
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground/70 mb-2">
                These {format} columns don&apos;t exist in the table. Add them as
                new columns or leave them out.
              </p>
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                {extraHeaders.map((header) => {
                  const cfg = addColumns[header];
                  if (!cfg) return null;
                  return (
                    <div
                      key={header}
                      className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={cfg.enabled}
                        onChange={(e) =>
                          setAddColumns((prev) => ({
                            ...prev,
                            [header]: { ...prev[header], enabled: e.target.checked },
                          }))
                        }
                        className="w-3.5 h-3.5 accent-emerald-500"
                      />
                      <span
                        className="text-xs font-mono text-muted-foreground truncate"
                        title={header}
                      >
                        {header}
                      </span>
                      <input
                        value={cfg.dbColumn}
                        disabled={!cfg.enabled}
                        onChange={(e) =>
                          setAddColumns((prev) => ({
                            ...prev,
                            [header]: { ...prev[header], dbColumn: e.target.value },
                          }))
                        }
                        className={cn(
                          'bg-background border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-primary/50 disabled:opacity-40',
                          cfg.enabled && !IDENT_RE.test(cfg.dbColumn)
                            ? 'border-amber-500/60'
                            : 'border-border',
                        )}
                      />
                      <Select
                        value={cfg.dbType}
                        disabled={!cfg.enabled}
                        onValueChange={(v) =>
                          setAddColumns((prev) => ({
                            ...prev,
                            [header]: {
                              ...prev[header],
                              dbType: v as NewTableType,
                            },
                          }))
                        }
                        options={NEW_TABLE_TYPES.map((t) => ({ value: t, label: NEW_TABLE_TYPE_LABELS[t] }))}
                        ariaLabel="Column type"
                        className="px-2 py-1.5 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(() => {
            const mappedCols = targetTable.columns.filter(
              (c) => mapping[c.columnName],
            );
            if (mappedCols.length === 0) return null;
            return (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Skip duplicates by{' '}
                  <span className="text-muted-foreground/60">(optional)</span>
                </p>
                <p className="text-[11px] text-muted-foreground/70 mb-2">
                  Pick the column(s) that uniquely identify a row. Rows whose
                  values already exist in the table — or repeat earlier in the
                  file — will be skipped.
                </p>
                <div className="flex flex-wrap gap-2">
                  {mappedCols.map((c) => {
                    const checked = uniqueKeys.includes(c.columnName);
                    return (
                      <label
                        key={c.columnName}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors',
                          checked
                            ? 'border-primary/50 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/30',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setUniqueKeys((prev) =>
                              e.target.checked
                                ? [...prev, c.columnName]
                                : prev.filter((k) => k !== c.columnName),
                            )
                          }
                          className="w-3.5 h-3.5 accent-primary"
                        />
                        <span className="font-mono">{c.columnName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {unmappedRequired.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5" />
              Map all required columns:{' '}
              {unmappedRequired.map((c) => c.columnName).join(', ')}
            </p>
          )}
        </>
      )}

      <ImportError error={error} />

      <StepFooter
        onBack={onBack}
        onConfirm={onConfirm}
        confirmLabel={`Insert ${parsed.rows.length.toLocaleString()} rows`}
        disabled={!valid}
        isImporting={isImporting}
      />
    </div>
  );
}

// ─── Step 2b: new table schema ───────────────────────────────

function NewStep({
  format,
  parsed,
  tableName,
  setTableName,
  columns,
  setColumns,
  valid,
  isImporting,
  error,
  onBack,
  onConfirm,
}: {
  format: string;
  parsed: ParsedCsv;
  tableName: string;
  setTableName: (v: string) => void;
  columns: NewColumn[];
  setColumns: (c: NewColumn[]) => void;
  valid: boolean;
  isImporting: boolean;
  error: unknown;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const updateCol = (idx: number, patch: Partial<NewColumn>) => {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  // Mirror the backend's primary-key handling for an accurate hint.
  const idCol = columns.find((c) => c.dbColumn.toLowerCase() === 'id');
  const idColumnNote = !idCol ? (
    <>
      An auto-increment <span className="font-mono">id</span> primary key is
      added automatically.
    </>
  ) : idCol.dbType === 'INT' || idCol.dbType === 'BIGINT' ? (
    <>
      Your <span className="font-mono">id</span> column will be the primary key.
    </>
  ) : (
    <>
      The table will be created without a primary key (the{' '}
      <span className="font-mono">id</span> column isn&apos;t an integer).
    </>
  );

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          New table name
        </span>
        <input
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="e.g. customers_2026"
          autoFocus
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50 font-mono"
        />
        {tableName && !IDENT_RE.test(tableName) && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Use letters, numbers and underscores; must not start with a number.
          </span>
        )}
      </label>

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Schema{' '}
          <span className="text-muted-foreground/60">
            ({format} → column · type)
          </span>
        </p>
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-1.5 bg-muted/30 text-[10px] font-semibold uppercase text-muted-foreground">
            <span>{format} column</span>
            <span>DB column</span>
            <span>Type</span>
          </div>
          {columns.map((col, idx) => {
            const dup =
              columns.filter((c) => c.dbColumn === col.dbColumn).length > 1;
            const invalid = !IDENT_RE.test(col.dbColumn) || dup;
            return (
              <div
                key={col.csvColumn}
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 px-3 py-2"
              >
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {col.csvColumn}
                </span>
                <input
                  value={col.dbColumn}
                  onChange={(e) => updateCol(idx, { dbColumn: e.target.value })}
                  className={cn(
                    'bg-background border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-primary/50',
                    invalid ? 'border-amber-500/60' : 'border-border',
                  )}
                />
                <Select
                  value={col.dbType}
                  onValueChange={(v) => updateCol(idx, { dbType: v as NewTableType })}
                  options={NEW_TABLE_TYPES.map((t) => ({ value: t, label: NEW_TABLE_TYPE_LABELS[t] }))}
                  ariaLabel="Column type"
                  className="px-2 py-1.5 text-xs"
                />
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-1.5">
          {idColumnNote}
        </p>
      </div>

      <ImportError error={error} />

      <StepFooter
        onBack={onBack}
        onConfirm={onConfirm}
        confirmLabel={`Create table & insert ${parsed.rows.length.toLocaleString()} rows`}
        disabled={!valid}
        isImporting={isImporting}
      />
    </div>
  );
}

// ─── Step 3: result ──────────────────────────────────────────

function DoneStep({
  result,
  onClose,
}: {
  result: import('../api/csv-import.api').CsvImportResult;
  onClose: () => void;
}) {
  const ok = result.rowsFailed === 0;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {ok ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {result.tableCreated
              ? `Created “${result.tableName}” and inserted `
              : `Inserted into “${result.tableName}” — `}
            {result.rowsInserted.toLocaleString()} row
            {result.rowsInserted !== 1 ? 's' : ''}.
          </p>
          {result.rowsSkipped > 0 && (
            <p className="text-xs text-muted-foreground">
              {result.rowsSkipped.toLocaleString()} duplicate row
              {result.rowsSkipped !== 1 ? 's' : ''} skipped.
            </p>
          )}
          {result.columnsAdded.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Added new column{result.columnsAdded.length !== 1 ? 's' : ''}:{' '}
              <span className="font-mono text-foreground/80">
                {result.columnsAdded.join(', ')}
              </span>
            </p>
          )}
          {result.rowsFailed > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {result.rowsFailed.toLocaleString()} row
              {result.rowsFailed !== 1 ? 's' : ''} failed.
            </p>
          )}
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="rounded-lg bg-muted/30 border border-border p-2.5 space-y-1 max-h-32 overflow-y-auto">
          {result.errors.map((e, i) => (
            <p key={i} className="text-[11px] font-mono text-muted-foreground">
              {e}
            </p>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The schema was refreshed — you can now query this table in chat.
      </p>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Check className="w-3.5 h-3.5" /> Done
        </button>
      </div>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────

function PreviewTable({
  parsed,
  inferred,
}: {
  parsed: ParsedCsv;
  inferred: NewColumn[];
}) {
  const typeByHeader = new Map(inferred.map((c) => [c.csvColumn, c.dbType]));
  const preview = parsed.rows.slice(0, 5);
  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            {parsed.headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left whitespace-nowrap">
                <span className="font-semibold">{h}</span>
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">
                  {typeByHeader.get(h)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i} className={cn('border-b border-border/40', i % 2 === 1 && 'bg-muted/10')}>
              {parsed.headers.map((h) => (
                <td
                  key={h}
                  className="px-3 py-1.5 font-mono whitespace-nowrap max-w-[180px] truncate"
                >
                  {row[h] === null ? (
                    <span className="text-muted-foreground/50 italic">∅</span>
                  ) : (
                    String(row[h])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepFooter({
  onBack,
  onConfirm,
  confirmLabel,
  disabled,
  isImporting,
}: {
  onBack: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  disabled: boolean;
  isImporting: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-1">
      <button
        onClick={onBack}
        disabled={isImporting}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground disabled:opacity-50"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <button
        onClick={onConfirm}
        disabled={disabled || isImporting}
        className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
      >
        {isImporting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Check className="w-3.5 h-3.5" />
        )}
        {isImporting ? 'Importing…' : confirmLabel}
      </button>
    </div>
  );
}

function ImportError({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error
      ? // axios errors surface the API message under response.data
        ((error as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? error.message)
      : 'Import failed';
  return (
    <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 text-xs text-destructive">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}
