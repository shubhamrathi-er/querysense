'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueryResult } from '../types';

interface Props {
  queryResult: QueryResult;
}

const PAGE_SIZE = 20;

export function ResultsTable({ queryResult }: Props) {
  const [page, setPage] = useState(0);

  const { rows, fields, rowCount, truncated } = queryResult;
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Query returned no results
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {fields.map((field) => (
                <th
                  key={field.name}
                  className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                >
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={cn(
                  'border-b border-border/50 hover:bg-muted/30 transition-colors',
                  rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-muted/10',
                )}
              >
                {fields.map((field) => {
                  const value = row[field.name];
                  return (
                    <td
                      key={field.name}
                      className="px-3 py-2 text-xs font-mono whitespace-nowrap max-w-[200px] truncate"
                    >
                      {value === null || value === undefined ? (
                        <span className="text-muted-foreground italic">NULL</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          {rowCount} row{rowCount !== 1 ? 's' : ''}
          {truncated && ' (limited to 500)'}
        </span>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-accent disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="p-1 rounded hover:bg-accent disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}