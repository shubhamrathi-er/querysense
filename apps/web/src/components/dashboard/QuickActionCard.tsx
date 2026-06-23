'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QuickAction {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  /** Tailwind tint classes: surface bg, icon bg, icon text. */
  tint: { card: string; iconBg: string; iconText: string };
}

export function QuickActionCard({
  action,
  index = 0,
}: {
  action: QuickAction;
  index?: number;
}) {
  const { icon: Icon, title, description, href, tint } = action;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
    >
      <Link
        href={href}
        className={cn(
          'group flex h-[84px] items-center gap-3 rounded-2xl border border-border/70 p-3.5 transition-all duration-300',
          'hover:border-transparent hover:shadow-[0_14px_40px_-16px_rgba(91,79,247,0.35)]',
          tint.card,
        )}
      >
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105',
            tint.iconBg,
            tint.iconText,
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-all duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </motion.div>
  );
}
