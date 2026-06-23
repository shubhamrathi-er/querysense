'use client';

import { Search, X, Database, Filter } from 'lucide-react';
import { Select } from '@/components/ui/select';
import type { Connection } from '@/features/connections/types';
import type { QueryStatus } from '../types';

export type StatusValue = 'all' | QueryStatus;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'ERROR', label: 'Error' },
  { value: 'TIMEOUT', label: 'Timeout' },
];

export function HistoryFilters({
  search,
  onSearch,
  connectionId,
  onConnection,
  status,
  onStatus,
  connections,
}: {
  search: string;
  onSearch: (v: string) => void;
  connectionId: string;
  onConnection: (v: string) => void;
  status: StatusValue;
  onStatus: (v: StatusValue) => void;
  connections: Connection[];
}) {
  // Radix Select can't use an empty-string value, so 'all' is the sentinel.
  const connectionOptions = [
    { value: 'all', label: 'All Connections' },
    ...connections.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search SQL queries..."
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {search && (
          <button
            onClick={() => onSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Connection */}
      <Select
        value={connectionId || 'all'}
        onValueChange={(v) => onConnection(v === 'all' ? '' : v)}
        options={connectionOptions}
        leftIcon={<Database className="h-4 w-4" />}
        ariaLabel="Filter by connection"
        className="w-full shrink-0 lg:w-52"
      />

      {/* Status */}
      <Select
        value={status}
        onValueChange={(v) => onStatus(v as StatusValue)}
        options={STATUS_OPTIONS}
        leftIcon={<Filter className="h-4 w-4" />}
        ariaLabel="Filter by status"
        className="w-full shrink-0 lg:w-44"
      />
    </div>
  );
}
