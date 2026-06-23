'use client';

import Link from 'next/link';
import { Network, Database, Plus } from 'lucide-react';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { DashboardConnectionCard } from '@/components/dashboard/DashboardConnectionCard';

export default function SchemaExplorerPage() {
  const { data: connections, isLoading } = useConnections();
  const list = connections ?? [];

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Schema Explorer</h1>
            <p className="text-sm text-muted-foreground">
              Pick a connection to browse its tables, columns and relationships.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted/50" />
            ))}
          </div>
        ) : list.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c, i) => (
              <DashboardConnectionCard key={c.id} connection={c} index={i} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Database className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">No connections to explore</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Connect a database first, then come back to explore its schema.
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
    </div>
  );
}
