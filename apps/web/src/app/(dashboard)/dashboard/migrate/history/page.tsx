'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Clock, ChevronRight, History as HistoryIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { migrationsApi, type MigrationRunSummary } from '@/features/migrations/api/migrations.api';

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

export default function MigrationHistoryPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const [runs, setRuns] = useState<MigrationRunSummary[] | null>(null);

  useEffect(() => {
    migrationsApi
      .history(currentWorkspace?.id ?? '')
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [currentWorkspace?.id]);

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-auto p-6 lg:p-8">
      <Link href="/dashboard/migrate" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to migrate
      </Link>
      <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
        <HistoryIcon className="h-5 w-5 text-primary" /> Migration history
      </h1>

      {runs === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : runs.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No migrations have run yet.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/migrate/history/${r.id}`}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-xs transition-colors hover:bg-accent/30"
            >
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize', STATUS_TONE[r.status] ?? STATUS_TONE.cancelled)}>
                {r.status}
              </span>
              <span className="font-medium text-foreground">{r.tables.length} table{r.tables.length !== 1 ? 's' : ''}</span>
              <span className="text-muted-foreground">· {r.totalCopied.toLocaleString()} rows · {r.conflict}</span>
              <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" /> {when(r.startedAt)} · {duration(r.startedAt, r.finishedAt)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
