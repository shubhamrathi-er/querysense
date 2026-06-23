'use client';

import { motion } from 'framer-motion';
import { Database } from 'lucide-react';

const DATABASES = [
  { name: 'MySQL', color: '#00758F' },
  { name: 'PostgreSQL', color: '#336791' },
  { name: 'MongoDB', color: '#13AA52' },
  { name: 'SQL Server', color: '#CC2927' },
  { name: 'Oracle', color: '#F80000' },
  { name: 'Snowflake', color: '#29B5E8' },
  { name: 'BigQuery', color: '#4285F4' },
];

function DbChip({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-[#5B4FF7]/30 hover:shadow-[0_8px_24px_rgba(91,79,247,0.14)]">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-md text-white"
        style={{ backgroundColor: color }}
      >
        <Database className="h-3 w-3" />
      </span>
      <span className="whitespace-nowrap text-xs font-semibold text-slate-700">{name}</span>
    </div>
  );
}

export function DatabaseIntegrations() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 1 }}
      className="space-y-2.5"
    >
      <p className="text-sm font-semibold text-slate-600">
        Works seamlessly with your database
      </p>

      {/* Infinite marquee — duplicated track for a seamless loop, pauses on hover */}
      <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max gap-2.5 py-1 animate-marquee group-hover:[animation-play-state:paused]">
          {[...DATABASES, ...DATABASES].map((db, i) => (
            <DbChip key={i} name={db.name} color={db.color} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
