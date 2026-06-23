'use client';

import { cn } from '@/lib/utils';

export type StatusTone = 'green' | 'red' | 'amber' | 'gray';

const TONES: Record<StatusTone, { ping: string; dot: string }> = {
  green: { ping: 'bg-emerald-400', dot: 'bg-emerald-500' },
  red: { ping: 'bg-red-400', dot: 'bg-red-500' },
  amber: { ping: 'bg-amber-400', dot: 'bg-amber-500' },
  gray: { ping: 'bg-slate-400', dot: 'bg-slate-400' },
};

/** Live status dot with a pulsing "ping" halo (as used in the chat connection bar). */
export function StatusDot({
  tone = 'green',
  size = 8,
  pulse,
  className,
}: {
  tone?: StatusTone;
  /** Diameter in px. */
  size?: number;
  /** Force pulse on/off. Defaults to on for every tone. */
  pulse?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  const shouldPulse = pulse ?? true;
  const px = `${size}px`;
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: px, height: px }}
    >
      {shouldPulse && (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', t.ping)}
        />
      )}
      <span className={cn('relative inline-flex h-full w-full rounded-full', t.dot)} />
    </span>
  );
}

/** Map a connection status to a dot tone. */
export function statusTone(
  status: 'ACTIVE' | 'ERROR' | 'PENDING' | 'DISCONNECTED',
): StatusTone {
  switch (status) {
    case 'ACTIVE':
      return 'green';
    case 'ERROR':
      return 'red';
    case 'PENDING':
      return 'amber';
    default:
      return 'gray';
  }
}
