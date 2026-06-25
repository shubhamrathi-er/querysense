'use client';

import { useState } from 'react';
import {
  Table2, KeyRound, ArrowRight, Check, AlertTriangle, PlusCircle, MinusCircle,
  Hash, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ValidationReport, TableSchemaComparison, ColumnComparison, ColumnSummary,
  IndexComparison, ForeignKeyRef,
} from '../types';

type ColStatus = 'match' | 'changed' | 'source-only' | 'target-only';

function colStatus(c: ColumnComparison): ColStatus {
  if (c.source && !c.target) return 'source-only';
  if (!c.source && c.target) return 'target-only';
  return c.changes.length > 0 ? 'changed' : 'match';
}

function typeOf(s: ColumnSummary | null): string {
  if (!s) return '—';
  return s.columnType || s.dataType || '—';
}

const TONE: Record<string, string> = {
  muted: 'bg-muted text-muted-foreground',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', TONE[tone])}>
      {children}
    </span>
  );
}

export function SchemaDiff({ report }: { report: ValidationReport }) {
  const tables = report.schemaComparison?.tables ?? [];
  const srcTable = (t: string) => report.sourceValidation?.tables.find((x) => x.tableName === t);
  const pkOf = (t: string) => srcTable(t)?.primaryKey ?? [];
  const fkOf = (t: string) => srcTable(t)?.foreignKeys ?? [];

  if (tables.length === 0) {
    return <p className="text-xs text-muted-foreground">Schema comparison is unavailable for this plan.</p>;
  }

  const newTables = tables.filter((t) => !t.targetExists).length;
  const changedTables = tables.filter(
    (t) => t.targetExists && t.columns.some((c) => colStatus(c) !== 'match'),
  ).length;
  const identicalTables = tables.length - newTables - changedTables;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="muted">{tables.length} tables</Badge>
        {newTables > 0 && <Badge tone="emerald">{newTables} new</Badge>}
        {changedTables > 0 && <Badge tone="amber">{changedTables} with changes</Badge>}
        {identicalTables > 0 && <Badge tone="sky">{identicalTables} identical</Badge>}
      </div>

      <div className="space-y-2">
        {tables.map((t) => (
          <TableDiff key={t.tableName} table={t} pk={pkOf(t.tableName)} fks={fkOf(t.tableName)} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10px] text-muted-foreground">
        <Legend tone="amber" label="Type/nullable/default changed" />
        <Legend tone="violet" label="Source only (missing on target)" />
        <Legend tone="muted" label="Target only (extra)" />
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: keyof typeof TONE; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', TONE[tone])} />
      {label}
    </span>
  );
}

function TableDiff({ table, pk, fks }: { table: TableSchemaComparison; pk: string[]; fks: ForeignKeyRef[] }) {
  const [showIdentical, setShowIdentical] = useState(false);

  const diffs = table.columns.filter((c) => colStatus(c) !== 'match');
  const matches = table.columns.filter((c) => colStatus(c) === 'match');
  const indexes = table.indexes ?? [];
  const indexDiffs = indexes.filter((i) => i.status !== 'match');
  const totalChanges = diffs.length + indexDiffs.length;
  const hasDiff = !table.targetExists || totalChanges > 0;

  return (
    <details open={hasDiff} className="overflow-hidden rounded-xl border border-border bg-card/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-sm text-foreground">{table.tableName}</span>
        {!table.targetExists ? (
          <Badge tone="emerald">New table</Badge>
        ) : totalChanges > 0 ? (
          <Badge tone="amber">{totalChanges} change{totalChanges !== 1 ? 's' : ''}</Badge>
        ) : (
          <Badge tone="sky">Identical</Badge>
        )}
        {pk.length > 0 && (
          <span className="ml-auto flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <KeyRound className="h-3 w-3 shrink-0" /> {pk.join(', ')}
          </span>
        )}
      </summary>

      <div className="border-t border-border/60">
        {!table.targetExists ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            This table doesn’t exist on the target — it will be created with all {table.columns.length} columns.
          </p>
        ) : diffs.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">All columns match the target.</p>
        ) : null}

        {(table.targetExists ? diffs : table.columns).map((c) => (
          <ColumnRow key={c.column} c={c} createMode={!table.targetExists} />
        ))}

        {table.targetExists && matches.length > 0 && (
          <div className="px-3 py-1.5">
            <button
              onClick={(e) => { e.preventDefault(); setShowIdentical((v) => !v); }}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {showIdentical ? 'Hide' : 'Show'} {matches.length} identical column{matches.length !== 1 ? 's' : ''}
            </button>
            {showIdentical && (
              <div className="mt-1">
                {matches.map((c) => <ColumnRow key={c.column} c={c} createMode={false} />)}
              </div>
            )}
          </div>
        )}

        {/* Indexes */}
        {indexes.length > 0 && (
          <div className="border-t border-border/40 px-3 py-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Indexes</p>
            <div className="space-y-1">
              {indexes.map((ix) => <IndexRow key={ix.name} ix={ix} createMode={!table.targetExists} />)}
            </div>
          </div>
        )}

        {/* Foreign keys (source) */}
        {fks.length > 0 && (
          <div className="border-t border-border/40 px-3 py-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Foreign keys</p>
            <div className="space-y-0.5">
              {fks.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-foreground">{f.column}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-mono">{f.refTable}.{f.refColumn}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function IndexRow({ ix, createMode }: { ix: IndexComparison; createMode: boolean }) {
  const def = ix.source ?? ix.target;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="font-mono text-foreground">{ix.name}</span>
      <span className="truncate text-muted-foreground">({def?.columns.join(', ')})</span>
      {def?.unique && <Badge tone="sky">unique</Badge>}
      <span className="ml-auto">
        {ix.status === 'match' && <StatusPill icon={Check} tone="sky" label="Match" />}
        {ix.status === 'changed' && <StatusPill icon={AlertTriangle} tone="amber" label="Changed" />}
        {ix.status === 'source-only' && <StatusPill icon={PlusCircle} tone="violet" label={createMode ? 'Create' : 'Source only'} />}
        {ix.status === 'target-only' && <StatusPill icon={MinusCircle} tone="muted" label="Target only" />}
      </span>
    </div>
  );
}

function ColumnRow({ c, createMode }: { c: ColumnComparison; createMode: boolean }) {
  const status = colStatus(c);
  const nullableChanged = !!c.source && !!c.target && c.source.nullable !== c.target.nullable;
  const defaultChanged =
    !!c.source && !!c.target && (c.source.defaultValue ?? '') !== (c.target.defaultValue ?? '');

  return (
    <div className="flex items-center gap-2 border-t border-border/30 px-3 py-1.5 text-xs">
      <span className="w-40 shrink-0 truncate font-mono text-foreground">{c.column}</span>

      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
        <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{typeOf(c.source)}</code>
        {status === 'changed' && (
          <>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <code className="rounded bg-amber-500/10 px-1 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
              {typeOf(c.target)}
            </code>
          </>
        )}
        {nullableChanged && (
          <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            {c.source!.nullable ? 'NULL → NOT NULL' : 'NOT NULL → NULL'}
          </span>
        )}
        {defaultChanged && (
          <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            default changed
          </span>
        )}
      </span>

      {status === 'match' && <StatusPill icon={Check} tone="sky" label="Match" />}
      {status === 'changed' && <StatusPill icon={AlertTriangle} tone="amber" label="Changed" />}
      {status === 'source-only' && (
        <StatusPill icon={PlusCircle} tone="violet" label={createMode ? 'Create' : 'Source only'} />
      )}
      {status === 'target-only' && <StatusPill icon={MinusCircle} tone="muted" label="Target only" />}
    </div>
  );
}

function StatusPill({ icon: Icon, tone, label }: { icon: typeof Check; tone: keyof typeof TONE; label: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', TONE[tone])}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
