'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

interface State {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => setState({ options, resolve })),
    [],
  );

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  const o = state?.options;
  const danger = o?.variant === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4"
          onClick={() => close(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-md p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
          >
            <div className="flex items-start gap-3">
              {danger && (
                <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4.5 h-4.5 text-destructive" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">
                  {o?.title ?? 'Are you sure?'}
                </h2>
                {o?.description && (
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                    {o.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => close(false)}
                className="text-sm px-3.5 py-2 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground"
                autoFocus
              >
                {o?.cancelLabel ?? 'Cancel'}
              </button>
              <button
                onClick={() => close(true)}
                className={cn(
                  'text-sm px-3.5 py-2 rounded-lg font-medium transition-colors',
                  danger
                    ? 'bg-destructive text-white hover:bg-destructive/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {o?.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
