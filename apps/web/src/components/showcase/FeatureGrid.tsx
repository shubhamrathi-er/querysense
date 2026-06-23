'use client';

import { motion } from 'framer-motion';
import { Zap, Target, ShieldCheck, type LucideIcon } from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  { icon: Zap, title: 'Lightning Fast', description: 'Generate SQL in seconds' },
  { icon: Target, title: 'Highly Accurate', description: 'AI that understands your data' },
  { icon: ShieldCheck, title: 'Secure & Private', description: 'Your data stays completely safe' },
];

export function FeatureGrid() {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
      {FEATURES.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 + i * 0.12 }}
          className="group flex items-start gap-3"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5B4FF7]/10 text-[#5B4FF7] transition-transform group-hover:scale-110">
            <f.icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">{f.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{f.description}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
