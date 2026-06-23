'use client';

import { motion } from 'framer-motion';
import { Database, Activity, Table2, Clock, type LucideIcon } from 'lucide-react';

interface Stat {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description: string;
  color: string;
}

export function ConnectionStats({
  total,
  active,
  totalTables,
  avgSyncDays,
}: {
  total: number;
  active: number;
  totalTables: number;
  avgSyncDays: number | null;
}) {
  const stats: Stat[] = [
    {
      icon: Database,
      value: total,
      label: 'Total Connections',
      description: 'All your database connections',
      color: '#5B4FF7',
    },
    {
      icon: Activity,
      value: active,
      label: 'Active Connections',
      description: 'Currently operational',
      color: '#10B981',
    },
    {
      icon: Table2,
      value: totalTables,
      label: 'Total Tables',
      description: 'Across all connections',
      color: '#0EA5E9',
    },
    {
      icon: Clock,
      value: avgSyncDays === null ? '—' : `${avgSyncDays}d`,
      label: 'Avg Sync Age',
      description: avgSyncDays === null ? 'No syncs yet' : 'Average sync freshness',
      color: '#F59E0B',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ y: -4 }}
          className="group rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.25)] transition-[box-shadow,border-color] duration-300 hover:border-primary/30 hover:shadow-[0_14px_40px_-14px_rgba(91,79,247,0.28)]"
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
              style={{ backgroundColor: `${s.color}1f`, color: s.color }}
            >
              <s.icon className="h-5 w-5" strokeWidth={2.1} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none tracking-tight text-foreground">
                {s.value}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground/80">{s.label}</p>
            </div>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">{s.description}</p>
        </motion.div>
      ))}
    </div>
  );
}
