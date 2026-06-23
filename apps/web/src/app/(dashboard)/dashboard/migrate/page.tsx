'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { MigrationWizard } from '@/features/migrations/components/MigrationWizard';

export default function MigrateDataPage() {
  const { data: connections, isLoading } = useConnections();
  const [showWizard, setShowWizard] = useState(false);
  const activeCount = (connections ?? []).filter((c) => c.status === 'ACTIVE').length;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Migrate Data</h1>
            <p className="text-sm text-muted-foreground">
              Move data between two of your connected databases.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-muted/50" />
        ) : activeCount >= 2 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold">Ready to migrate</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              You have {activeCount} active connections. Start the wizard to pick a
              source and target, preview the plan, and run the migration.
            </p>
            <button
              onClick={() => setShowWizard(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ArrowRightLeft className="h-4 w-4" /> Start migration
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ArrowRightLeft className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Need at least 2 connections</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Migration moves data from one database to another, so you&apos;ll need
              two active connections.
            </p>
            <Link
              href="/dashboard/connections"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Add a connection
            </Link>
          </div>
        )}
      </div>

      {showWizard && <MigrationWizard onClose={() => setShowWizard(false)} />}
    </div>
  );
}
