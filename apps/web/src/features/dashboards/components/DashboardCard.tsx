'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LayoutDashboard, ExternalLink, Pencil, Trash2, MoreVertical,
  LayoutGrid, Clock, Globe, Lock,
} from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { useDeleteDashboard } from '../hooks/useDashboards';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import type { Dashboard } from '../types';

export function DashboardCard({
  dashboard,
  index = 0,
  view = 'grid',
}: {
  dashboard: Dashboard;
  index?: number;
  view?: 'grid' | 'list';
}) {
  const deleteDashboard = useDeleteDashboard();
  const confirm = useConfirm();
  const toast = useToast();

  const widgets = dashboard._count?.widgets ?? 0;
  const href = `/dashboard/dashboards/${dashboard.id}`;
  const description = dashboard.description?.trim();

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete dashboard',
      description: `Delete "${dashboard.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDashboard.mutateAsync(dashboard.id);
      toast.success(`Deleted "${dashboard.name}".`);
    } catch {
      toast.error('Failed to delete dashboard.');
    }
  };

  const menuItem =
    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground/85 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground';

  const actionsMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Dashboard actions"
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-44 rounded-xl border border-border bg-popover p-1 shadow-xl">
          <DropdownMenu.Item asChild className={menuItem}>
            <Link href={href}><ExternalLink className="h-4 w-4" /> Open</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={menuItem}>
            <Link href={href}><Pencil className="h-4 w-4" /> Edit</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={cn(menuItem, 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive')}
            onSelect={() => void handleDelete()}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  // Compact single-line row for the list view.
  if (view === 'list') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
        className="group flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[box-shadow,border-color] duration-300 hover:border-primary/30 hover:shadow-[0_10px_28px_-18px_rgba(91,79,247,0.3)]"
      >
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B4FF7]/15 to-[#7C6BFF]/15 text-primary">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{dashboard.name}</h3>
              <span
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                  dashboard.isPublic ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {dashboard.isPublic ? <Globe className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                {dashboard.isPublic ? 'Public' : 'Private'}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <LayoutGrid className="h-3.5 w-3.5" /> {widgets} widget{widgets !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Updated {timeAgo(dashboard.updatedAt)}
              </span>
            </div>
          </div>
        </Link>
        {actionsMenu}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_36px_-22px_rgba(15,23,42,0.22)] transition-[box-shadow,border-color] duration-300 hover:border-primary/30 hover:shadow-[0_18px_44px_-18px_rgba(91,79,247,0.3)]"
    >
      {/* Header: icon + name/meta + menu in one row */}
      <div className="flex items-start gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7]/15 to-[#7C6BFF]/15 text-primary">
          <LayoutDashboard className="h-6 w-6" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-foreground">{dashboard.name}</h3>
              <span
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                  dashboard.isPublic
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {dashboard.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {dashboard.isPublic ? 'Public' : 'Private'}
              </span>
            </div>

            {actionsMenu}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" /> {widgets} widget{widgets !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Updated {timeAgo(dashboard.updatedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Description only when present */}
      {description && (
        <p className="mt-3.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
        <Link
          href={href}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <ExternalLink className="h-4 w-4" /> Open Dashboard
        </Link>
        <Link
          href={href}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Pencil className="h-4 w-4" /> Edit
        </Link>
        <button
          onClick={() => void handleDelete()}
          disabled={deleteDashboard.isPending}
          aria-label="Delete dashboard"
          className="flex items-center justify-center rounded-lg border border-transparent px-2.5 py-2.5 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
