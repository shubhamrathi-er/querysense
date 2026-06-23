'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Sparkline } from './Sparkline';

export interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  description: string;
  color: string;
  trend: number[];
  index?: number;
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  color,
  trend,
  index = 0,
}: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className="group relative overflow-hidden rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.25)] transition-[box-shadow,border-color] duration-300 hover:border-primary/30 hover:shadow-[0_14px_40px_-14px_rgba(91,79,247,0.3)]"
    >
      {/* hover glow wash */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ backgroundColor: `${color}26` }}
      />

      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${color}1f`, color }}
      >
        <Icon className="h-5 w-5" strokeWidth={2.1} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-3xl font-bold leading-none tracking-tight text-foreground">
            {value}
          </p>
          <p className="mt-2 text-sm font-semibold text-foreground/80">{label}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="shrink-0 pb-0.5">
          <Sparkline color={color} points={trend} />
        </div>
      </div>
    </motion.div>
  );
}
