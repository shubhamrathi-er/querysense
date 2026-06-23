'use client';

import { Search, X, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';

export type SortKey = 'updated' | 'name' | 'widgets' | 'created';
export type ViewMode = 'grid' | 'list';

const SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'widgets', label: 'Most widgets' },
  { value: 'created', label: 'Newest' },
];

export function DashboardFilters({
  search,
  onSearch,
  sort,
  onSort,
  view,
  onView,
}: {
  search: string;
  onSearch: (v: string) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search dashboards..."
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

      {/* Sort */}
      <Select
        value={sort}
        onValueChange={(v) => onSort(v as SortKey)}
        options={SORTS}
        prefix="Sort by:"
        ariaLabel="Sort dashboards"
        className="w-full shrink-0 sm:w-56"
      />

      {/* View toggle */}
      <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-border bg-card p-0.5">
        {(['grid', 'list'] as const).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            aria-label={`${v} view`}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              view === v ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'grid' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}
