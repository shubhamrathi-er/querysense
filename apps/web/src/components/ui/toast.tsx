'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title?: string;
  message: string;
}

interface ToastApi {
  toast: (variant: ToastVariant, message: string, title?: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

let nextId = 1;

const VARIANT = {
  success: { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', ring: 'border-green-500/30' },
  error: { icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', ring: 'border-red-500/30' },
  info: { icon: Info, color: 'text-blue-600 dark:text-blue-400', ring: 'border-blue-500/30' },
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (variant: ToastVariant, message: string, title?: string) => {
      const id = nextId++;
      setItems((prev) => [...prev, { id, variant, message, title }]);
      setTimeout(() => dismiss(id), variant === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const api: ToastApi = {
    toast,
    success: (m, t) => toast('success', m, t),
    error: (m, t) => toast('error', m, t),
    info: (m, t) => toast('info', m, t),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
        {items.map((t) => {
          const v = VARIANT[t.variant];
          const Icon = v.icon;
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'flex items-start gap-2.5 bg-card border rounded-xl px-3.5 py-3 shadow-lg',
                'animate-in slide-in-from-bottom-2 fade-in',
                v.ring,
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', v.color)} />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-medium">{t.title}</p>}
                <p className="text-xs text-foreground/85 break-words">{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
