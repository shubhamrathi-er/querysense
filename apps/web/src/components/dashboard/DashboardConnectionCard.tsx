'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Database } from 'lucide-react';
import { useConnection } from '@/features/connections/hooks/useConnections';
import { StatusDot, statusTone } from '@/components/ui/status-dot';
import type { Connection } from '@/features/connections/types';

const TABLE_CHIPS = 4;

export function DashboardConnectionCard({
  connection,
  index = 0,
}: {
  connection: Connection;
  index?: number;
}) {
  // Fetch the connection detail to surface real table names for the chips.
  // (Architecture note: this is where a richer schema preview would expand.)
  const { data: detail, isLoading } = useConnection(connection.id);

  const tables = detail?.schemaMetadata ?? [];
  const totalTables = connection._count?.schemaMetadata ?? tables.length;
  const shown = tables.slice(0, TABLE_CHIPS);
  const remaining = Math.max(0, totalTables - shown.length);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
    >
      <Link
        href={`/dashboard/connections/${connection.id}`}
        className="group block rounded-2xl border border-border bg-card/60 p-3 transition-all duration-300 hover:border-primary/30 hover:bg-card hover:shadow-[0_10px_30px_-16px_rgba(91,79,247,0.4)]"
      >
        {/* Header row */}
        <div className="flex items-center gap-2.5">
          <StatusDot tone={statusTone(connection.status)} size={8} />
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Database className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {connection.name}
            </p>
            <p className="text-xs leading-tight text-muted-foreground">MySQL</p>
          </div>
          <span className="shrink-0 self-start text-xs text-muted-foreground">
            {totalTables} table{totalTables !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table chips — full width, starting under the icon */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {isLoading && shown.length === 0 ? (
            Array.from({ length: TABLE_CHIPS }).map((_, i) => (
              <span key={i} className="h-5 w-16 animate-pulse rounded-md bg-muted" />
            ))
          ) : (
            <>
              {shown.map((t) => (
                <span
                  key={t.id}
                  className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
                >
                  {t.tableName}
                </span>
              ))}
              {remaining > 0 && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  +{remaining} more
                </span>
              )}
            </>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
