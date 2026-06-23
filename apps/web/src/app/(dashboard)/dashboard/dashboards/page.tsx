'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, LayoutDashboard, Search } from 'lucide-react';
import { useDashboards } from '@/features/dashboards/hooks/useDashboards';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { DashboardStats } from '@/features/dashboards/components/DashboardStats';
import {
  DashboardFilters,
  type SortKey,
  type ViewMode,
} from '@/features/dashboards/components/DashboardFilters';
import { DashboardCard } from '@/features/dashboards/components/DashboardCard';
import { NewDashboardModal } from '@/features/dashboards/components/NewDashboardModal';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;

export default function DashboardsListPage() {
  const { data: dashboards, isLoading } = useDashboards();
  const { data: connections } = useConnections();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');

  const list = dashboards ?? [];
  const totalWidgets = list.reduce((s, d) => s + (d._count?.widgets ?? 0), 0);
  const connectedSources = (connections ?? []).length;

  const avgUpdatedDays = useMemo(() => {
    if (list.length === 0) return null;
    const totalDays = list.reduce(
      (s, d) => s + (Date.now() - new Date(d.updatedAt).getTime()) / DAY,
      0,
    );
    return Math.round(totalDays / list.length);
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = list.filter(
      (d) =>
        !q ||
        d.name.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q),
    );
    const sorted = [...result].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'widgets':
          return (b._count?.widgets ?? 0) - (a._count?.widgets ?? 0);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [list, search, sort]);

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="relative z-10 mx-auto max-w-7xl space-y-4 p-5 lg:p-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboards</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Build charts and KPI views from your data
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 self-start rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/35"
          >
            <Plus className="h-4 w-4" /> New Dashboard
          </button>
        </motion.div>

        {/* Stats */}
        <DashboardStats
          total={list.length}
          totalWidgets={totalWidgets}
          connectedSources={connectedSources}
          avgUpdatedDays={avgUpdatedDays}
        />

        {/* Filters */}
        {(list.length > 0 || isLoading) && (
          <DashboardFilters
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={setSort}
            view={view}
            onView={setView}
          />
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted/40" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState onCreate={() => setShowModal(true)} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <Search className="h-9 w-9 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">No dashboards match your search.</p>
            <button onClick={() => setSearch('')} className="mt-2 text-xs font-medium text-primary hover:underline">
              Clear search
            </button>
          </div>
        ) : (
          <div className={cn('grid gap-4', view === 'grid' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
            {filtered.map((d, i) => (
              <DashboardCard key={d.id} dashboard={d} index={i} />
            ))}
          </div>
        )}
      </div>

      {showModal && <NewDashboardModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
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
          <LayoutDashboard className="h-10 w-10" />
        </div>
      </div>
      <h2 className="mt-6 text-xl font-bold tracking-tight">Create your first dashboard</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Visualize your data and track important metrics in one place.
      </p>
      <button
        onClick={onCreate}
        className="mt-6 flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/35"
      >
        <Plus className="h-4 w-4" /> New Dashboard
      </button>
    </motion.div>
  );
}
