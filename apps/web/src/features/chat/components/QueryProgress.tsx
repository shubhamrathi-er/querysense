'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  isLoading: boolean;
}

const STEPS = [
  { id: 'schema', label: 'Retrieving schema context' },
  { id: 'context', label: 'Loading conversation history' },
  { id: 'generating', label: 'Generating SQL query' },
  { id: 'validating', label: 'Validating query safety' },
  { id: 'ready', label: 'Preparing response' },
];

// Time each step becomes "done" (ms)
// Last step never completes — stays active until isLoading = false
const STEP_TIMINGS = [500, 1200, 2500, 2800];

export function QueryProgress({ isLoading }: Props) {
  // Index of the currently active step
  const [activeIndex, setActiveIndex] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Advance through steps at fixed intervals
  useEffect(() => {
    if (!isLoading) return;

    const timers = STEP_TIMINGS.map((timing, i) =>
      setTimeout(() => {
        setActiveIndex(i + 1); // Mark step i as done, step i+1 as active
      }, timing),
    );

    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  // When API responds (isLoading becomes false), fade out
  useEffect(() => {
    if (isLoading) return;

    const fadeTimer = setTimeout(() => setFadingOut(true), 300);
    const hideTimer = setTimeout(() => setHidden(true), 800);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [isLoading]);

  // Reset when new request starts
 // Reset when new request starts
useEffect(() => {
  if (!isLoading) return;

  const t = setTimeout(() => {
    setActiveIndex(0);
    setFadingOut(false);
    setHidden(false);
  }, 0);

  return () => clearTimeout(t);
}, [isLoading]);

  if (hidden) return null;

  return (
    <div className={cn(
      'flex gap-3 max-w-3xl transition-all duration-500 ease-in-out',
      fadingOut
        ? 'opacity-0 -translate-y-1 scale-[0.98]'
        : 'opacity-100 translate-y-0 scale-100',
    )}>
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
      </div>

      {/* Steps card */}
      <div className="flex-1 bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3.5 space-y-2.5">
        {STEPS.map((step, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          const isWaiting = i > activeIndex;

          return (
            <div
              key={step.id}
              className={cn(
                'flex items-center gap-3 transition-all duration-300',
                isWaiting && 'opacity-30',
              )}
            >
              {/* Icon */}
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300',
                isDone && 'bg-green-500/15',
                isActive && 'bg-primary/15',
                isWaiting && 'bg-muted/50',
              )}>
                {isDone ? (
                  <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                ) : isActive ? (
                  <Loader2 className="w-3 h-3 text-primary animate-spin" />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </div>

              {/* Label */}
              <span className={cn(
                'text-sm transition-all duration-300',
                isDone && 'text-muted-foreground/50 line-through decoration-muted-foreground/20',
                isActive && 'text-foreground font-medium',
                isWaiting && 'text-muted-foreground/50',
              )}>
                {step.label}
              </span>

              {/* Bouncing dots for active step */}
              {isActive && (
                <span className="flex gap-0.5 ml-1">
                  {[0, 1, 2].map((j) => (
                    <span
                      key={j}
                      className="w-1 h-1 rounded-full bg-primary animate-bounce"
                      style={{ animationDelay: `${j * 150}ms` }}
                    />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}