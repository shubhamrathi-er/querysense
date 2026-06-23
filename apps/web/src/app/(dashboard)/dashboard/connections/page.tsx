'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, RefreshCw, ArrowRightLeft, Database, Search } from 'lucide-react';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { ConnectionCard } from '@/features/connections/components/ConnectionCard';
import { ConnectionStats } from '@/features/connections/components/ConnectionStats';
import { ConnectionFilters, type StatusFilter } from '@/features/connections/components/ConnectionFilters';
import { AddConnectionModal } from '@/features/connections/components/AddConnectionModal';
import { MigrationWizard } from '@/features/migrations/components/MigrationWizard';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;

export default function ConnectionsPage() {
  const { data: connections, isLoading, refetch, isFetching } = useConnections();
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const conns = connections ?? [];
  const activeCount = conns.filter((c) => c.status === 'ACTIVE').length;
  const totalTables = conns.reduce((s, c) => s + (c._count?.schemaMetadata ?? 0), 0);

  const avgSyncDays = useMemo(() => {
    const synced = conns.filter((c) => c.lastSyncedAt);
    if (synced.length === 0) return null;
    const totalDays = synced.reduce(
      (s, c) => s + (Date.now() - new Date(c.lastSyncedAt as string).getTime()) / DAY,
      0,
    );
    return Math.round(totalDays / synced.length);
  }, [conns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conns.filter((c) => {
      const matchSearch =
        !q || `${c.name} ${c.databaseName} ${c.host}`.toLowerCase().includes(q);
      const matchStatus =
        status === 'all' ||
        (status === 'active' && c.status === 'ACTIVE') ||
        (status === 'inactive' && (c.status === 'DISCONNECTED' || c.status === 'ERROR')) ||
        (status === 'pending' && c.status === 'PENDING');
      return matchSearch && matchStatus;
    });
  }, [conns, search, status]);

  const openMigrate = () => {
    if (activeCount < 2) {
      toast.info('You need at least 2 active connections to migrate data.');
      return;
    }
    setShowMigrate(true);
  };

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="relative z-10 max-w-full space-y-4 p-5 lg:p-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Connections</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage and monitor your database connections
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refetch()}
              aria-label="Refresh"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </button>
            <button
              onClick={openMigrate}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <ArrowRightLeft className="h-4 w-4" /> Migrate data
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/35"
            >
              <Plus className="h-4 w-4" /> Add Connection
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <ConnectionStats
          total={conns.length}
          active={activeCount}
          totalTables={totalTables}
          avgSyncDays={avgSyncDays}
        />

        {/* Filters */}
        {(conns.length > 0 || isLoading) && (
          <ConnectionFilters
            search={search}
            onSearch={setSearch}
            status={status}
            onStatus={setStatus}
          />
        )}

        {/* List */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted/40" />
            ))}
          </div>
        ) : conns.length === 0 ? (
          <EmptyState onAdd={() => setShowModal(true)} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <Search className="h-9 w-9 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              No connections match your filters.
            </p>
            <button
              onClick={() => {
                setSearch('');
                setStatus('all');
              }}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filtered.map((c, i) => (
              <ConnectionCard key={c.id} connection={c} index={i} />
            ))}
          </div>
        )}
      </div>

      {showModal && <AddConnectionModal onClose={() => setShowModal(false)} />}
      {showMigrate && <MigrationWizard onClose={() => setShowMigrate(false)} />}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-border bg-card/50 py-20 text-center"
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-primary/20 blur-2xl" />
        <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-xl shadow-[#5B4FF7]/30">
          <Database className="h-10 w-10" />
        </div>
      </div>
      <h2 className="mt-6 text-xl font-bold tracking-tight">No database connections yet</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Connect your first database to start querying data with AI.
      </p>
      <button
        onClick={onAdd}
        className="mt-6 flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/35"
      >
        <Plus className="h-4 w-4" /> Add Connection
      </button>
    </motion.div>
  );
}
