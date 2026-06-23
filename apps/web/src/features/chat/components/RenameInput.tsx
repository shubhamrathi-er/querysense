'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}

/**
 * Inline rename input: autofocuses + selects, commits on Enter/blur, cancels on
 * Escape. A guard ensures we never fire both commit and cancel for one edit.
 */
export function RenameInput({ value, onChange, onCommit, onCancel, className }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit();
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      maxLength={120}
      className={cn(
        'bg-input border border-primary/50 rounded-md outline-none',
        'focus:ring-2 focus:ring-primary/40',
        className,
      )}
    />
  );
}
