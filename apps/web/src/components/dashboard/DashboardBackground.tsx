'use client';

import { motion } from 'framer-motion';

/** Premium, subtle backdrop for the dashboard: soft lavender/cyan glows, a faint
 *  mesh + dotted texture, and a decorative wave in the top-right. Theme-aware,
 *  kept low-contrast so it never hurts readability. */
export function DashboardBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* soft top wash */}
      <div className="absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary/[0.06] via-primary/[0.02] to-transparent" />

      {/* drifting glow blobs */}
      <motion.div
        className="absolute -top-24 right-[12%] h-72 w-72 rounded-full bg-[#7C6BFF]/15 blur-[90px]"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -top-10 left-[20%] h-64 w-64 rounded-full bg-cyan-300/15 blur-[90px]"
        animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* decorative wave lines, top-right */}
      <svg
        className="absolute -right-10 -top-16 h-[360px] w-[360px] text-primary/[0.07]"
        viewBox="0 0 400 400"
        fill="none"
        aria-hidden
      >
        {[120, 160, 200, 240, 280, 320].map((r) => (
          <circle key={r} cx="400" cy="0" r={r} stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>

      {/* faint dotted texture, fading downward */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--foreground) / 0.06) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, black, transparent 60%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 60%)',
        }}
      />
    </div>
  );
}
