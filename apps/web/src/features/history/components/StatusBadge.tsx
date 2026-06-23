'use client';

import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueryStatus } from '../types';

const config: Record<QueryStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  SUCCESS: { label: 'Success', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
  ERROR: { label: 'Error', cls: 'bg-red-500/10 text-red-600 dark:text-red-400', icon: XCircle },
  TIMEOUT: { label: 'Timeout', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', icon: Clock },
};

export function StatusBadge({ status }: { status: QueryStatus }) {
  const c = config[status];
  const Icon = c.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', c.cls)}>
      <Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}
