'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sparkles, MessageSquare, Database, History, Network,
  LayoutDashboard, LayoutGrid, Settings, ChevronDown, Plus, ArrowRightLeft,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useAuthStore } from '@/stores/auth.store';
import { useConversations } from '@/features/chat/hooks/useChat';
import { SidebarChatItem } from '@/features/chat/components/SidebarChatItem';
import { ThemeToggle } from '@/components/ui/theme-toggle';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

const MAIN_TOP: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: LayoutGrid, exact: true },
];
const MAIN_REST: NavItem[] = [
  { label: 'Connections', href: '/dashboard/connections', icon: Database },
  { label: 'Schema Explorer', href: '/dashboard/schema', icon: Network },
  { label: 'Dashboards', href: '/dashboard/dashboards', icon: LayoutDashboard },
  { label: 'History', href: '/dashboard/history', icon: History },
];
const TOOLS: NavItem[] = [
  { label: 'Migrate Data', href: '/dashboard/migrate', icon: ArrowRightLeft },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const { data: conversations } = useConversations();

  const recentConversations =
    conversations
      ?.filter((c) => (c._count?.messages ?? 0) > 0)
      .slice(0, 5) ?? [];

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname?.startsWith(`${item.href}/`);

  const NavLink = ({ item }: { item: NavItem }) => (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
        isActive(item)
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  );

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-sm shadow-[#5B4FF7]/25">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold">
            QuerySense <span className="text-primary">AI</span>
          </span>
        </div>
      </div>

      {/* Workspace selector */}
      <div className="border-b border-border p-3">
        <button className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/20">
              <span className="text-xs font-bold text-primary">
                {currentWorkspace?.name?.charAt(0) ?? 'W'}
              </span>
            </div>
            <span className="truncate text-sm font-medium">
              {currentWorkspace?.name ?? 'Select Workspace'}
            </span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {/* New Chat */}
        <Link
          href="/dashboard/chat/new"
          className="mb-3 flex w-full items-center gap-2 rounded-lg bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-[#5B4FF7]/25 transition-shadow hover:shadow-md hover:shadow-[#5B4FF7]/35"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Link>

        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Main
        </p>

        {MAIN_TOP.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}

        {/* All Chats + recent */}
        <Link
          href="/dashboard/chat"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
            pathname === '/dashboard/chat' || pathname?.startsWith('/dashboard/chat/')
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          All Chats
        </Link>
        {recentConversations.length > 0 && (
          <div className="mb-1 ml-3 space-y-0.5 border-l border-border/60 pl-3">
            {recentConversations.map((conv) => {
              const active = pathname === `/dashboard/chat/${conv.id}`;
              return (
                <SidebarChatItem
                  key={conv.id}
                  conversation={conv}
                  isActive={active}
                  onDeleted={() => {
                    if (active) router.push('/dashboard/chat');
                  }}
                />
              );
            })}
          </div>
        )}

        {MAIN_REST.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}

        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Tools
        </p>
        {TOOLS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {/* Bottom: theme, settings, profile */}
      <div className="space-y-0.5 border-t border-border p-3">
        <ThemeToggle />
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <Link
          href="/dashboard/settings"
          className="mt-1 flex items-center gap-2.5 rounded-lg border border-border/70 px-3 py-2 transition-colors hover:bg-accent"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-xs font-semibold text-white">
            {(user?.name?.trim() || user?.email || '?').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {user?.name ?? 'Account'}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </Link>
      </div>
    </aside>
  );
}
