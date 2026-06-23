'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { History, Download, Search } from 'lucide-react';
import { useQueryHistory, useQueryHistoryStats } from '@/features/history/hooks/useHistory';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { historyApi } from '@/features/history/api/history.api';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useToast } from '@/components/ui/toast';
import { HistoryStats } from '@/features/history/components/HistoryStats';
import { HistoryFilters, type StatusValue } from '@/features/history/components/HistoryFilters';
import { QueryHistoryTable } from '@/features/history/components/QueryHistoryTable';
import { QueryDetailsDrawer } from '@/features/history/components/QueryDetailsDrawer';
import { HistoryPagination } from '@/features/history/components/HistoryPagination';
import type { QueryHistoryItem } from '@/features/history/types';

const PAGE_SIZE = 10;

export default function QueryHistoryPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const { data: connections } = useConnections();
  const { data: stats } = useQueryHistoryStats();
  const toast = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [status, setStatus] = useState<StatusValue>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<QueryHistoryItem | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce the search input.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      connectionId: connectionId || undefined,
      status: status === 'all' ? undefined : status,
      search: search || undefined,
    }),
    [page, connectionId, status, search],
  );

  const { data, isLoading } = useQueryHistory(filters);
  const items = data?.items ?? [];
  const hasAny = (stats?.total ?? 0) > 0;

  const copy = (item: QueryHistoryItem) => {
    void navigator.clipboard.writeText(item.sql);
    toast.success('SQL copied to clipboard.');
  };

  const handleExport = async () => {
    if (!currentWorkspace) return;
    setExporting(true);
    try {
      const all = await historyApi.list(currentWorkspace.id, {
        page: 1,
        pageSize: Math.max(data?.total ?? 0, 1),
      });
      const header = ['executed_at', 'connection', 'status', 'duration_ms', 'rows', 'sql'];
      const rows = all.items.map((i) => [
        new Date(i.executedAt).toISOString(),
        i.connectionName,
        i.status,
        String(i.executionTimeMs),
        String(i.rowCount),
        `"${i.sql.replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`,
      ]);
      const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'query-history.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.items.length} queries.`);
    } catch {
      toast.error('Failed to export history.');
    } finally {
      setExporting(false);
    }
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
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Query History</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every SQL query executed against your databases.
              </p>
            </div>
          </div>
          <button
            onClick={() => void handleExport()}
            disabled={exporting || !hasAny}
            className="flex items-center gap-2 self-start rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export History'}
          </button>
        </motion.div>

        {/* Stats */}
        <HistoryStats stats={stats} />

        {hasAny ? (
          <>
            {/* Filters */}
            <HistoryFilters
              search={searchInput}
              onSearch={setSearchInput}
              connectionId={connectionId}
              onConnection={(v) => {
                setConnectionId(v);
                setPage(1);
              }}
              status={status}
              onStatus={(v) => {
                setStatus(v);
                setPage(1);
              }}
              connections={connections ?? []}
            />

            {/* Table */}
            {isLoading ? (
              <div className="h-96 animate-pulse rounded-2xl bg-muted/40" />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
                <Search className="h-9 w-9 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No queries match your filters.</p>
                <button
                  onClick={() => {
                    setSearchInput('');
                    setConnectionId('');
                    setStatus('all');
                  }}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <QueryHistoryTable items={items} onView={setSelected} onCopy={copy} />
            )}

            {/* Pagination */}
            {data && items.length > 0 && (
              <HistoryPagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPage={setPage}
              />
            )}
          </>
        ) : (
          !isLoading && <EmptyState />
        )}
      </div>

      <QueryDetailsDrawer item={selected} onClose={() => setSelected(null)} onCopy={copy} />
    </div>
  );
}

function EmptyState() {
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
          <History className="h-10 w-10" />
        </div>
      </div>
      <h2 className="mt-6 text-xl font-bold tracking-tight">No query history yet</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Executed queries will appear here.
      </p>
    </motion.div>
  );
}
