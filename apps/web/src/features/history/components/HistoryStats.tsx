'use client';

import { motion } from 'framer-motion';
import { History, CheckCircle2, XCircle, Zap, type LucideIcon } from 'lucide-react';
import type { QueryHistoryStats } from '../types';

interface Card {
  icon: LucideIcon;
  value: string;
  label: string;
  description: string;
  color: string;
  descColor?: string;
}

export function HistoryStats({ stats }: { stats?: QueryHistoryStats }) {
  const total = stats?.total ?? 0;
  const success = stats?.success ?? 0;
  const error = stats?.error ?? 0;
  const avgMs = stats?.avgMs ?? 0;
  const rate = (n: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : '0%');

  const cards: Card[] = [
    {
      icon: History,
      value: String(total),
      label: 'Total Queries',
      description: 'All time queries',
      color: '#5B4FF7',
    },
    {
      icon: CheckCircle2,
      value: String(success),
      label: 'Successful',
      description: `${rate(success)} success rate`,
      color: '#10B981',
      descColor: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      icon: XCircle,
      value: String(error),
      label: 'Errors',
      description: `${rate(error)} error rate`,
      color: '#EF4444',
      descColor: error > 0 ? 'text-red-600 dark:text-red-400' : undefined,
    },
    {
      icon: Zap,
      value: `${avgMs}ms`,
      label: 'Avg. Time',
      description: 'Average execution time',
      color: '#7C6BFF',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ y: -4 }}
          className="group rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.25)] transition-[box-shadow,border-color] duration-300 hover:border-primary/30 hover:shadow-[0_14px_40px_-14px_rgba(91,79,247,0.28)]"
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105"
              style={{ backgroundColor: `${c.color}1f`, color: c.color }}
            >
              <c.icon className="h-8 w-8" strokeWidth={2.1} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none tracking-tight text-foreground">{c.value}</p>
              <p className="mt-1 text-sm font-semibold text-foreground/80">{c.label}</p>
          <p className={c.descColor ? `mt-1 text-xs font-medium ${c.descColor}` : 'mt-1 text-xs text-muted-foreground'}>
            {c.description}
          </p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
