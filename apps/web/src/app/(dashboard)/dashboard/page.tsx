'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Database, MessageSquare, LayoutDashboard, Table2,
  Plus, ArrowRight, Network, ArrowRightLeft,
} from 'lucide-react';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { useConversations } from '@/features/chat/hooks/useChat';
import { useDashboards } from '@/features/dashboards/hooks/useDashboards';
import { useAuthStore } from '@/stores/auth.store';
import { MetricCard, type MetricCardProps } from '@/components/dashboard/MetricCard';
import { QuickActionCard, type QuickAction } from '@/components/dashboard/QuickActionCard';
import { RecentConversations } from '@/components/dashboard/RecentConversations';
import { DashboardConnectionCard } from '@/components/dashboard/DashboardConnectionCard';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { data: connections, isLoading: connLoading } = useConnections();
  const { data: conversations, isLoading: convLoading } = useConversations();
  const { data: dashboards } = useDashboards();

  const conns = connections ?? [];
  const activeConns = conns.filter((c) => c.status === 'ACTIVE');
  const tablesSynced = conns.reduce((s, c) => s + (c._count?.schemaMetadata ?? 0), 0);

  const convs = (conversations ?? []).filter((c) => (c._count?.messages ?? 0) > 0);
  const totalMessages = convs.reduce((s, c) => s + (c._count?.messages ?? 0), 0);
  const recentConvs = convs.slice(0, 4);

  const dashList = dashboards ?? [];
  const totalWidgets = dashList.reduce((s, d) => s + (d._count?.widgets ?? 0), 0);

  const firstName = user?.name?.trim().split(' ')[0] ?? 'there';

  const metrics: MetricCardProps[] = [
    {
      icon: Database,
      label: 'Active Databases',
      value: activeConns.length,
      description: `of ${conns.length} connected`,
      color: '#5B4FF7',
      trend: [4, 6, 5, 7, 6, 8, 7, 9],
    },
    {
      icon: Table2,
      label: 'Synced Tables',
      value: tablesSynced,
      description: `Across ${conns.length} database${conns.length !== 1 ? 's' : ''}`,
      color: '#0EA5E9',
      trend: [3, 4, 6, 5, 7, 8, 7, 9],
    },
    {
      icon: MessageSquare,
      label: 'Conversations',
      value: convs.length,
      description: `${totalMessages} message${totalMessages !== 1 ? 's' : ''}`,
      color: '#8B5CF6',
      trend: [2, 5, 4, 6, 5, 7, 9, 8],
    },
    {
      icon: LayoutDashboard,
      label: 'Dashboards',
      value: dashList.length,
      description: `${totalWidgets} widget${totalWidgets !== 1 ? 's' : ''}`,
      color: '#F59E0B',
      trend: [5, 4, 6, 7, 6, 8, 7, 9],
    },
  ];

  const quickActions: QuickAction[] = [
    {
      icon: Database,
      title: 'Add Connection',
      description: 'Connect a new database',
      href: '/dashboard/connections',
      tint: { card: 'bg-primary/[0.04]', iconBg: 'bg-primary/10', iconText: 'text-primary' },
    },
    {
      icon: LayoutDashboard,
      title: 'Build Dashboard',
      description: 'Create visual dashboards',
      href: '/dashboard/dashboards',
      tint: { card: 'bg-blue-500/[0.05]', iconBg: 'bg-blue-500/10', iconText: 'text-blue-600 dark:text-blue-400' },
    },
    {
      icon: ArrowRightLeft,
      title: 'Migrate Data',
      description: 'Move data between databases',
      href: '/dashboard/migrate',
      tint: { card: 'bg-emerald-500/[0.05]', iconBg: 'bg-emerald-500/10', iconText: 'text-emerald-600 dark:text-emerald-400' },
    },
    {
      icon: Network,
      title: 'Explore Schema',
      description: 'Browse your database structure',
      href: '/dashboard/schema',
      tint: { card: 'bg-amber-500/[0.06]', iconBg: 'bg-amber-500/10', iconText: 'text-amber-600 dark:text-amber-400' },
    },
  ];

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="relative z-10 mx-auto max-w-7xl space-y-4 p-5 lg:p-6">
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back, {firstName} <span className="inline-block">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your data today.
          </p>
        </motion.div>

        {/* Metrics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((m, i) => (
            <MetricCard key={m.label} {...m} index={i} />
          ))}
        </div>

        {/* Main two-column */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Recent conversations */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_36px_-22px_rgba(15,23,42,0.25)] lg:col-span-2"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <MessageSquare className="h-4 w-4 text-primary" /> Recent conversations
              </h2>
              <Link
                href="/dashboard/chat"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {/* gradient divider */}
            <div className="my-3 h-px bg-gradient-to-r from-primary/40 via-primary/15 to-transparent" />
            <RecentConversations conversations={recentConvs} isLoading={convLoading} />
          </motion.section>

          {/* Connections */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_36px_-22px_rgba(15,23,42,0.25)]"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Database className="h-4 w-4 text-primary" /> Connections
              </h2>
              <Link
                href="/dashboard/connections"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Manage <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {/* gradient divider */}
            <div className="my-3 h-px bg-gradient-to-r from-primary/40 via-primary/15 to-transparent" />

            {connLoading ? (
              <div className="space-y-2.5">
                {[1, 2].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/50" />
                ))}
              </div>
            ) : conns.length > 0 ? (
              // ~2 connections visible; the rest scroll.
              <div className="max-h-[296px] space-y-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {conns.map((c, i) => (
                  <DashboardConnectionCard key={c.id} connection={c} index={i} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Database className="h-6 w-6" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">No connections yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect a database to get started.
                </p>
                <Link
                  href="/dashboard/connections"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-3.5 w-3.5" /> Add connection
                </Link>
              </div>
            )}
          </motion.section>
        </div>

        {/* Quick actions */}
        <section>
          <h2 className="mb-2.5 text-sm font-semibold text-foreground">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((a, i) => (
              <QuickActionCard key={a.title} action={a} index={i} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
