'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Clock, RotateCcw, Play, ShieldCheck, Trash2, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useWorkspaceStore } from '@/stores/workspace.store';
import {
  migrationsApi,
  type MigrationRunDetail as RunDetail,
  type IntegrityResult,
} from '../api/migrations.api';

const STATUS_TONE: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  partial: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  running: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  cancelled: 'bg-muted text-muted-foreground',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function duration(a: string, b: string | null): string {
  if (!b) return '—';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function MigrationRunDetail({ id }: { id: string }) {
  const { currentWorkspace } = useWorkspaceStore();
  const ws = currentWorkspace?.id ?? '';
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);

  const load = () => {
    setLoading(true);
    migrationsApi
      .historyDetail(ws, id)
      .then(setDetail)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load run'))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [id, ws]);

  const doRerun = (mode: 'resume' | 'retry') => {
    setBusy(true);
    migrationsApi.rerun(ws, id, mode, {
      onDone: (report) => {
        const failed = report.filter((r) => r.status === 'error').length;
        if (failed) toast.error(`${mode === 'retry' ? 'Retry' : 'Resume'} finished with ${failed} failed table(s).`);
        else toast.success(`${mode === 'retry' ? 'Retry' : 'Resume'} completed.`);
        setBusy(false);
        load();
      },
      onError: (m) => {
        toast.error(m);
        setBusy(false);
      },
    });
  };

  const checkIntegrity = async () => {
    setIntegrity(null);
    setIntegrityLoading(true);
    try {
      setIntegrity(await migrationsApi.integrity(ws, id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Integrity check failed');
    } finally {
      setIntegrityLoading(false);
    }
  };

  const doRollback = async () => {
    const ok = await confirm({
      title: 'Roll back migration?',
      description:
        'This DROPs the target tables this run created. Tables that already existed (data appended) are left untouched. This cannot be undone.',
      confirmLabel: 'Roll back',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await migrationsApi.rollback(ws, id);
      toast.success(
        `Rolled back: dropped ${res.dropped.length} table(s)${res.skipped.length ? `, skipped ${res.skipped.length} pre-existing` : ''}.`,
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rollback failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        Run not found.
        <Link href="/dashboard/migrate/history" className="text-primary hover:underline">← Back to history</Link>
      </div>
    );
  }

  const report = detail.report ?? [];
  const canRerun = detail.status === 'partial' || detail.status === 'failed';
  const canRollback = report.some((t) => t.created) && detail.status !== 'cancelled';

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-auto p-6 lg:p-8">
      <Link href="/dashboard/migrate/history" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to history
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', STATUS_TONE[detail.status] ?? STATUS_TONE.cancelled)}>
          {detail.status}
        </span>
        <h1 className="text-lg font-semibold text-foreground">{detail.tables.length} table{detail.tables.length !== 1 ? 's' : ''}</h1>
        <span className="text-sm text-muted-foreground">· {detail.totalCopied.toLocaleString()} rows · {detail.conflict}</span>
        <span className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {when(detail.startedAt)} · {duration(detail.startedAt, detail.finishedAt)}
        </span>
      </div>

      {detail.error && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {detail.error}
        </p>
      )}

      {/* Actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={integrityLoading}
          onClick={() => void checkIntegrity()}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {integrityLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Check integrity
        </button>
        {canRerun && (
          <>
            <button type="button" disabled={busy} onClick={() => doRerun('resume')} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Resume incomplete
            </button>
            <button type="button" disabled={busy} onClick={() => doRerun('retry')} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Retry failed
            </button>
          </>
        )}
        {canRollback && (
          <button type="button" disabled={busy} onClick={() => void doRollback()} className="flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> Roll back
          </button>
        )}
      </div>

      {/* Per-table report */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Table</th>
              <th className="px-3 py-2 text-right font-medium">Copied</th>
              <th className="px-3 py-2 text-right font-medium">Source</th>
              <th className="px-3 py-2 text-right font-medium">Target</th>
              <th className="px-3 py-2 text-center font-medium">Created</th>
              <th className="px-3 py-2 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.map((t) => (
              <tr key={t.table} className="border-t border-border/40">
                <td className="px-3 py-1.5 font-mono text-foreground">
                  {t.table}{t.target && t.target !== t.table && <span className="text-muted-foreground"> → {t.target}</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{t.copied.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{t.sourceRows.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{t.targetRows.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-center text-muted-foreground">{t.created ? '✓' : '—'}</td>
                <td className={cn('px-3 py-1.5 text-center', t.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                  {t.status === 'error' ? 'error' : 'done'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.some((t) => t.status === 'error' && t.error) && (
        <div className="mt-2 space-y-1">
          {report.filter((t) => t.status === 'error' && t.error).map((t) => (
            <p key={t.table} className="text-[11px] text-red-600 dark:text-red-400"><span className="font-mono">{t.table}</span>: {t.error}</p>
          ))}
        </div>
      )}

      {/* Integrity result */}
      {integrity && (
        <div className="mt-4 rounded-xl border border-border p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Integrity ·{' '}
            <span className={integrity.status === 'OK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{integrity.status}</span>
          </p>
          <div className="space-y-0.5">
            {integrity.tables.map((t) => {
              const filtered = integrity.filteredTables.includes(t.table);
              return (
                <div key={t.table} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-mono text-foreground">{t.table}</span>
                  <span className="text-muted-foreground">{t.sourceRowCount.toLocaleString()} → {t.targetRowCount.toLocaleString()}</span>
                  {t.rowCountMatch ? (
                    <span className="text-emerald-600 dark:text-emerald-400">✓ rows</span>
                  ) : filtered ? (
                    <span className="text-muted-foreground">~ filtered/incremental (expected)</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">✗ row mismatch</span>
                  )}
                  {t.checksumMatch === true && <span className="text-emerald-600 dark:text-emerald-400">✓ checksum</span>}
                  {t.checksumMatch === false && !filtered && <span className="text-amber-600 dark:text-amber-400">✗ checksum</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
