'use client';

import { Search, X, Filter } from 'lucide-react';
import { Select } from '@/components/ui/select';

export type StatusFilter = 'all' | 'active' | 'inactive' | 'pending';

const OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'pending', label: 'Sync Pending' },
];

export function ConnectionFilters({
  search,
  onSearch,
  status,
  onStatus,
}: {
  search: string;
  onSearch: (v: string) => void;
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search connections..."
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

      {/* Status filter */}
      <Select
        value={status}
        onValueChange={(v) => onStatus(v as StatusFilter)}
        options={OPTIONS}
        leftIcon={<Filter className="h-4 w-4" />}
        ariaLabel="Filter by status"
        className="w-full shrink-0 sm:w-44"
      />
    </div>
  );
}
