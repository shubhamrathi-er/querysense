'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Clock, ChevronRight, History as HistoryIcon, RotateCcw, Play, ShieldCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useWorkspaceStore } from '@/stores/workspace.store';
import {
  migrationsApi,
  type MigrationRunSummary,
  type MigrationRunDetail,
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
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function duration(a: string, b: string | null): string {
  if (!b) return '—';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function MigrationHistory({ onClose }: { onClose: () => void }) {
  const { currentWorkspace } = useWorkspaceStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [runs, setRuns] = useState<MigrationRunSummary[] | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MigrationRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () =>
    migrationsApi
      .history(currentWorkspace?.id ?? '')
      .then(setRuns)
      .catch(() => setRuns([]));

  useEffect(() => {
    migrationsApi
      .history(currentWorkspace?.id ?? '')
      .then(setRuns)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Failed to load history');
        setRuns([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRerun = (id: string, mode: 'resume' | 'retry') => {
    setBusy(id);
    migrationsApi.rerun(currentWorkspace?.id ?? '', id, mode, {
      onDone: (report) => {
        const failed = report.filter((r) => r.status === 'error').length;
        if (failed) toast.error(`${mode === 'retry' ? 'Retry' : 'Resume'} finished with ${failed} failed table(s).`);
        else toast.success(`${mode === 'retry' ? 'Retry' : 'Resume'} completed.`);
        setBusy(null);
        setOpenId(null);
        void refresh();
      },
      onError: (m) => {
        toast.error(m);
        setBusy(null);
      },
    });
  };

  const checkIntegrity = async (id: string) => {
    setIntegrity(null);
    setIntegrityLoading(true);
    try {
      setIntegrity(await migrationsApi.integrity(currentWorkspace?.id ?? '', id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Integrity check failed');
    } finally {
      setIntegrityLoading(false);
    }
  };

  const doRollback = async (id: string) => {
    const ok = await confirm({
      title: 'Roll back migration?',
      description:
        'This DROPs the target tables this run created. Tables that already existed (data appended) are left untouched. This cannot be undone.',
      confirmLabel: 'Roll back',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(id);
    try {
      const res = await migrationsApi.rollback(currentWorkspace?.id ?? '', id);
      toast.success(
        `Rolled back: dropped ${res.dropped.length} table(s)${res.skipped.length ? `, skipped ${res.skipped.length} pre-existing` : ''}.`,
      );
      setOpenId(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rollback failed');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setIntegrity(null);
    setDetailLoading(true);
    try {
      setDetail(await migrationsApi.historyDetail(currentWorkspace?.id ?? '', id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load run');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <HistoryIcon className="h-4 w-4 text-primary" /> Migration history
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {runs === null ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : runs.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No migrations have run yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <div key={r.id} className="overflow-hidden rounded-xl border border-border">
                  <button
                    type="button"
                    onClick={() => void toggle(r.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs hover:bg-accent/30"
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', openId === r.id && 'rotate-90')} />
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize', STATUS_TONE[r.status] ?? STATUS_TONE.cancelled)}>
                      {r.status}
                    </span>
                    <span className="font-medium text-foreground">{r.tables.length} table{r.tables.length !== 1 ? 's' : ''}</span>
                    <span className="text-muted-foreground">· {r.totalCopied.toLocaleString()} rows · {r.conflict}</span>
                    <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> {when(r.startedAt)} · {duration(r.startedAt, r.finishedAt)}
                    </span>
                  </button>

                  {openId === r.id && (
                    <div className="border-t border-border/60 bg-muted/10 px-3 py-2">
                      {detailLoading || !detail ? (
                        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                        </div>
                      ) : (
                        <>
                          {detail.error && (
                            <p className="mb-2 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-600 dark:text-red-400">{detail.error}</p>
                          )}
                          <table className="w-full text-[11px]">
                            <thead className="text-muted-foreground">
                              <tr>
                                <th className="px-2 py-1 text-left font-medium">Table</th>
                                <th className="px-2 py-1 text-right font-medium">Copied</th>
                                <th className="px-2 py-1 text-right font-medium">Source</th>
                                <th className="px-2 py-1 text-right font-medium">Target</th>
                                <th className="px-2 py-1 text-center font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(detail.report ?? []).map((t) => (
                                <tr key={t.table} className="border-t border-border/40">
                                  <td className="px-2 py-1 font-mono text-foreground">{t.table}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{t.copied.toLocaleString()}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{t.sourceRows.toLocaleString()}</td>
                                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{t.targetRows.toLocaleString()}</td>
                                  <td className={cn('px-2 py-1 text-center', t.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                                    {t.status === 'error' ? 'error' : 'done'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={integrityLoading}
                              onClick={() => void checkIntegrity(r.id)}
                              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
                            >
                              {integrityLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                              Check integrity
                            </button>
                            {(detail.status === 'partial' || detail.status === 'failed') && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy === r.id}
                                  onClick={() => doRerun(r.id, 'resume')}
                                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
                                >
                                  {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                  Resume incomplete
                                </button>
                                <button
                                  type="button"
                                  disabled={busy === r.id}
                                  onClick={() => doRerun(r.id, 'retry')}
                                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
                                >
                                  {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                                  Retry failed
                                </button>
                              </>
                            )}
                            {(detail.report ?? []).some((t) => t.created) && detail.status !== 'cancelled' && (
                              <button
                                type="button"
                                disabled={busy === r.id}
                                onClick={() => void doRollback(r.id)}
                                className="flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" /> Roll back
                              </button>
                            )}
                          </div>

                          {integrity && (
                            <div className="mt-2 rounded-lg border border-border bg-background p-2">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Integrity ·{' '}
                                <span className={integrity.status === 'OK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                                  {integrity.status}
                                </span>
                              </p>
                              <div className="space-y-0.5">
                                {integrity.tables.map((t) => {
                                  const filtered = integrity.filteredTables.includes(t.table);
                                  return (
                                    <div key={t.table} className="flex items-center gap-2 text-[11px]">
                                      <span className="font-mono text-foreground">{t.table}</span>
                                      <span className="text-muted-foreground">
                                        {t.sourceRowCount.toLocaleString()} → {t.targetRowCount.toLocaleString()}
                                      </span>
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
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
