'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Compact page-number window around the current page. */
function pageWindow(page: number, totalPages: number): number[] {
  const span = 2;
  const start = Math.max(1, Math.min(page - span, totalPages - span * 2));
  const end = Math.min(totalPages, Math.max(page + span, span * 2 + 1));
  const out: number[] = [];
  for (let p = start; p <= end; p++) out.push(p);
  return out;
}

export function HistoryPagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> queries
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)} aria="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </PageBtn>
          {pageWindow(page, totalPages).map((p) => (
            <button
              key={p}
              onClick={() => onPage(p)}
              className={cn(
                'h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition-colors',
                p === page
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
          <PageBtn disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria="Next page">
            <ChevronRight className="h-4 w-4" />
          </PageBtn>
        </div>
      )}
    </div>
  );
}

function PageBtn({
  children,
  disabled,
  onClick,
  aria,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  aria: string;
}) {
  return (
    <button
      aria-label={aria}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
