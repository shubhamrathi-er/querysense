'use client';

import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, MessageSquare, Clock, Database, Rows3, CalendarClock } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { QueryHistoryItem } from '../types';

export function QueryDetailsDrawer({
  item,
  onClose,
  onCopy,
}: {
  item: QueryHistoryItem | null;
  onClose: () => void;
  onCopy: (item: QueryHistoryItem) => void;
}) {
  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Query Details</h2>
                <StatusBadge status={item.status} />
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-3">
                <Meta icon={Database} label="Connection" value={item.connectionName} />
                <Meta icon={Clock} label="Execution time" value={`${item.executionTimeMs}ms`} />
                <Meta icon={Rows3} label="Rows returned" value={String(item.rowCount)} />
                <Meta icon={CalendarClock} label="Executed" value={new Date(item.executedAt).toLocaleString()} />
              </div>

              {/* SQL */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  SQL
                </p>
                <pre className="overflow-x-auto rounded-xl border border-[#1e1b4b] bg-[#0c0a1f] p-4 font-mono text-xs leading-relaxed text-slate-200">
                  {item.sql}
                </pre>
              </div>

              {/* Error */}
              {item.errorMessage && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  <p className="font-medium">Error</p>
                  <p className="mt-0.5 font-mono text-xs">{item.errorMessage}</p>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex items-center gap-2 border-t border-border p-4">
              <button
                onClick={() => onCopy(item)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Copy className="h-4 w-4" /> Copy SQL
              </button>
              {item.conversationId ? (
                <Link
                  href={`/dashboard/chat/${item.conversationId}`}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl"
                >
                  <MessageSquare className="h-4 w-4" /> Open in chat
                </Link>
              ) : (
                <button
                  onClick={() => onCopy(item)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl"
                >
                  <Copy className="h-4 w-4" /> Reuse Query
                </button>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}
