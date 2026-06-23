'use client';

import { type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Static prefix shown before the value (e.g. "Sort by:"). */
  prefix?: string;
  leftIcon?: ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/** Custom, theme-aware select built on @radix-ui/react-select (replaces native <select>). */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  prefix,
  leftIcon,
  className,
  ariaLabel,
  disabled,
}: Props) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium outline-none transition-colors',
          'hover:bg-accent focus:border-primary focus:ring-2 focus:ring-primary/20 data-[state=open]:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-foreground">
          {leftIcon && <span className="shrink-0 text-muted-foreground">{leftIcon}</span>}
          {prefix && <span className="shrink-0 text-muted-foreground">{prefix}</span>}
          <span className="truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground">
            <ChevronUp className="h-4 w-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="max-h-72">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-2.5 pr-8 text-sm text-foreground/85 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground data-[state=checked]:font-medium data-[state=checked]:text-primary"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                  <Check className="h-4 w-4 text-primary" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground">
            <ChevronDown className="h-4 w-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
