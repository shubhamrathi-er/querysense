'use client';

import { motion } from 'framer-motion';
import { Sparkles, Database, ShieldCheck, Lock } from 'lucide-react';
import { FloatingIcon } from '@/components/ui/FloatingIcon';
import { FeatureGrid } from './FeatureGrid';

export function HeroSection() {
  return (
    <div className="relative">
      {/* Floating glass icons in the open space to the right of the hero copy */}
      <FloatingIcon icon={Sparkles} size="lg" delay={0} className="right-[8%] top-[1%] hidden xl:block" />
      <FloatingIcon icon={Database} size="md" delay={1.2} className="right-[22%] top-[40%] hidden xl:block" />
      <FloatingIcon icon={ShieldCheck} size="sm" delay={0.6} className="right-[34%] top-[12%] hidden xl:block" />
      <FloatingIcon icon={Lock} size="sm" delay={1.8} className="right-[6%] top-[66%] hidden xl:block" />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center gap-2.5"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/25">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-xl font-bold tracking-tight text-slate-900">
          QuerySense <span className="text-[#5B4FF7]">AI</span>
        </span>
      </motion.div>

      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-[#5B4FF7]/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#5B4FF7] shadow-sm backdrop-blur-md"
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI-Powered Text to SQL
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 xl:text-5xl"
      >
        Ask questions.
        <br />
        <span className="bg-gradient-to-r from-[#5B4FF7] to-[#9F7BFF] bg-clip-text text-transparent">
          Get answers.
        </span>
      </motion.h1>

      {/* Subheadline */}
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.35 }}
        className="mt-3 max-w-md text-base leading-relaxed text-slate-500"
      >
        Transform natural language questions into accurate SQL queries in seconds.
      </motion.p>

      {/* Features */}
      <div className="mt-6 max-w-full">
        <FeatureGrid />
      </div>
    </div>
  );
}
