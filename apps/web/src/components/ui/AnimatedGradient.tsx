'use client';

import { motion } from 'framer-motion';

// Deterministic particle field (index-derived so SSR and client match).
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 47) % 100,
  size: 2 + (i % 4),
  duration: 14 + (i % 7) * 2,
  delay: (i % 6) * 1.3,
}));

/** Premium auth backdrop: soft mesh gradient (white → lavender → cyan), a faint
 *  grid, slowly drifting glow blobs, and a rising particle field. Light theme. */
export function AnimatedGradient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* mesh base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(at 18% 18%, rgba(124,107,255,0.20), transparent 50%),' +
            'radial-gradient(at 82% 8%, rgba(91,79,247,0.16), transparent 45%),' +
            'radial-gradient(at 78% 78%, rgba(34,211,238,0.16), transparent 52%),' +
            'radial-gradient(at 8% 82%, rgba(167,139,250,0.18), transparent 46%),' +
            '#fbfbff',
        }}
      />

      {/* drifting glow blobs */}
      <motion.div
        className="absolute -top-32 left-[8%] h-[36rem] w-[36rem] rounded-full bg-[#7C6BFF]/25 blur-[110px]"
        animate={{ x: [0, 120, 30, 0], y: [0, 70, 130, 0], scale: [1, 1.18, 1.05, 1] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-[28%] right-[6%] h-[32rem] w-[32rem] rounded-full bg-cyan-300/30 blur-[110px]"
        animate={{ x: [0, -110, -30, 0], y: [0, 90, 30, 0], scale: [1, 1.22, 1.08, 1] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-8rem] left-[30%] h-[30rem] w-[30rem] rounded-full bg-[#5B4FF7]/20 blur-[110px]"
        animate={{ x: [0, 90, -60, 0], y: [0, -80, -30, 0], scale: [1, 1.15, 1.25, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#1e1b4b 1px, transparent 1px), linear-gradient(90deg, #1e1b4b 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
        }}
      />

      {/* rising particles */}
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-[#5B4FF7]/40"
          style={{ left: `${p.left}%`, width: p.size, height: p.size }}
          initial={{ top: '105%', opacity: 0 }}
          animate={{ top: '-5%', opacity: [0, 0.7, 0] }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'linear' }}
        />
      ))}
    </div>
  );
}
