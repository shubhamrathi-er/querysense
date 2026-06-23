'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bell, LogOut, Plus, Settings, ChevronDown, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';

const itemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground/85 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground';

function initials(name?: string | null, email?: string) {
  const base = name?.trim() || email || '?';
  return base.charAt(0).toUpperCase();
}

export function Header() {
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <header className="flex h-16 shrink-0 items-center justify-end gap-2 border-b border-border bg-card/40 px-6 backdrop-blur-sm">
      {/* New Chat CTA */}
      <Link
        href="/dashboard/chat/new"
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-all hover:shadow-xl hover:shadow-[#5B4FF7]/35"
      >
        <Plus className="h-4 w-4" />
        New Chat
      </Link>

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label="Toggle color theme"
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* Notifications */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 w-64 rounded-xl border border-border bg-popover p-4 text-center shadow-xl"
          >
            <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-muted-foreground">No new notifications.</p>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Avatar dropdown */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-2 rounded-xl border border-border px-1.5 py-1 pr-2 transition-colors hover:bg-accent data-[state=open]:bg-accent">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-xs font-semibold text-white">
              {initials(user?.name, user?.email)}
            </span>
            <span className="hidden max-w-[8rem] truncate text-sm font-medium text-foreground sm:block">
              {user?.name ?? 'Account'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl"
          >
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-semibold text-foreground">
                {user?.name ?? 'Account'}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item asChild>
              <Link href="/dashboard/settings" className={itemClass}>
                <Settings className="h-4 w-4" /> Settings
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={handleLogout}
              className={cn(
                itemClass,
                'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
              )}
            >
              <LogOut className="h-4 w-4" /> Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
