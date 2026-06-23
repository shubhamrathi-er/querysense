'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Light/dark switch. Avoids hydration mismatch by rendering a stable label
 *  until mounted, then reflecting the resolved theme. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle color theme"
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
