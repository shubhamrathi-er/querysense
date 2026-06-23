'use client';

import { motion } from 'framer-motion';
import { Database, Eye, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import type { QueryHistoryItem } from '../types';

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const ordinal = (n: number) => {
  const v = n % 100;
  return ['th', 'st', 'nd', 'rd'][(v - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][v] ?? 'th';
};

/** "2nd January 2026" */
const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}${ordinal(d.getDate())} ${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
};

/** "12:06 pm" */
const formatTime = (iso: string) => {
  const d = new Date(iso);
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  const h = d.getHours() % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

export function QueryHistoryTable({
  items,
  onView,
  onCopy,
}: {
  items: QueryHistoryItem[];
  onView: (item: QueryHistoryItem) => void;
  onCopy: (item: QueryHistoryItem) => void;
}) {
  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Time</th>
              <th className="px-4 py-3 font-semibold">Connection</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Duration</th>
              <th className="px-4 py-3 font-semibold">Rows</th>
              <th className="px-4 py-3 font-semibold">Query</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <motion.tr
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.2) }}
                onClick={() => onView(item)}
                className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-primary/[0.03]"
              >
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="block text-foreground/80">{formatDate(item.executedAt)}</span>
                  <span className="block text-xs text-muted-foreground">{formatTime(item.executedAt)}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="flex items-center gap-1.5 text-foreground/80">
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    {item.connectionName}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground/80">
                  {item.executionTimeMs}ms
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground/80">
                  {item.rowCount}
                </td>
                <td className="max-w-0 px-4 py-3">
                  <span
                    title={oneLine(item.sql)}
                    className="block truncate font-mono text-xs text-foreground/70"
                  >
                    {oneLine(item.sql)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <RowAction label="View details" onClick={() => onView(item)} icon={Eye} />
                    <RowAction label="Copy SQL" onClick={() => onCopy(item)} icon={Copy} />
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onView(item)}
            className="block w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/30"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                {item.connectionName}
              </span>
              <StatusBadge status={item.status} />
            </div>
            <p className="mt-2 line-clamp-2 font-mono text-xs text-muted-foreground">
              {oneLine(item.sql)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{formatDate(item.executedAt)}, {formatTime(item.executedAt)}</span>
              <span>· {item.executionTimeMs}ms</span>
              <span>· {item.rowCount} rows</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function RowAction({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Eye;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
