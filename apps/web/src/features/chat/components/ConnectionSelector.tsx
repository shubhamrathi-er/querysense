'use client';

import { Database, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { StatusDot, statusTone } from '@/components/ui/status-dot';

interface Props {
  selectedId: string;
  onSelect: (id: string) => void;
}

export function ConnectionSelector({ selectedId, onSelect }: Props) {
  const { data: connections } = useConnections();
  const [open, setOpen] = useState(false);

  const selected = connections?.find((c) => c.id === selectedId);
  const activeConnections = connections?.filter((c) => c.status === 'ACTIVE') ?? [];

  if (activeConnections.length <= 1) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-primary/30 bg-card text-sm transition-colors"
      >
        <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-medium max-w-[140px] truncate">
          {selected?.name ?? 'Select DB'}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-20 bg-card border border-border rounded-xl shadow-xl overflow-hidden min-w-[200px]">
            {activeConnections.map((conn) => (
              <button
                key={conn.id}
                onClick={() => { onSelect(conn.id); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-accent transition-colors',
                  conn.id === selectedId && 'bg-primary/10',
                )}
              >
                <StatusDot tone={statusTone(conn.status)} size={7} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{conn.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{conn.databaseName}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}