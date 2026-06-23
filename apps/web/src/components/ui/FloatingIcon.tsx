'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  icon: LucideIcon;
  className?: string;
  /** Animation offset so multiple icons float independently. */
  delay?: number;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { box: 'h-12 w-12 rounded-2xl', icon: 'h-5 w-5' },
  md: { box: 'h-16 w-16 rounded-[1.25rem]', icon: 'h-7 w-7' },
  lg: { box: 'h-20 w-20 rounded-[1.5rem]', icon: 'h-9 w-9' },
};

/** Glassmorphism tile that floats vertically and tilts gently. */
export function FloatingIcon({ icon: Icon, className, delay = 0, size = 'md' }: Props) {
  const s = sizeMap[size];
  return (
    <motion.div
      aria-hidden
      className={cn('absolute z-10', className)}
      animate={{ y: [0, -16, 0], rotate: [-3, 3, -3] }}
      transition={{ duration: 6 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
    >
      <div
        className={cn(
          'flex items-center justify-center border border-white/70 bg-white/40 shadow-[0_8px_30px_rgba(91,79,247,0.18)] backdrop-blur-xl',
          'relative overflow-hidden',
          s.box,
        )}
      >
        {/* inner glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/60 to-transparent" />
        <Icon className={cn('relative text-[#5B4FF7]', s.icon)} strokeWidth={2} />
      </div>
    </motion.div>
  );
}
