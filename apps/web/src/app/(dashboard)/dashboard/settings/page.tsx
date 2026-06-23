'use client';

import { useRouter } from 'next/navigation';
import { User, Mail, LogOut, Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const logout = () => {
    clearAuth();
    router.push('/login');
  };

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account and preferences.
          </p>
        </div>

        {/* Profile */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Profile</h2>
          <div className="mt-4 flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-xl font-semibold text-white">
              {(user?.name?.trim() || user?.email || '?').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {user?.name ?? '—'}
              </p>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {user?.email}
              </p>
            </div>
          </div>
          {currentWorkspace && (
            <p className="mt-4 text-xs text-muted-foreground">
              Workspace: <span className="font-medium text-foreground">{currentWorkspace.name}</span>
            </p>
          )}
        </section>

        {/* Appearance */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Appearance</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose your theme.</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {themes.map((t) => {
              const active = mounted && theme === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  <t.icon className="h-5 w-5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Danger */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Account</h2>
          <button
            onClick={logout}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </section>
      </div>
    </div>
  );
}
