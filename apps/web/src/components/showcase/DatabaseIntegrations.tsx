'use client';

import { motion } from 'framer-motion';
import { Database } from 'lucide-react';
import { SiMysql, SiPostgresql, SiMariadb, SiSnowflake } from 'react-icons/si';
import { DiMsqlServer, DiAws } from 'react-icons/di';

type IconCmp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

// Brand icons matched to the connection-card mapping (Oracle has no brand icon
// in the icon libraries, so it uses the generic database glyph).
const DATABASES: { name: string; Icon: IconCmp; color: string }[] = [
  { name: 'MySQL', Icon: SiMysql, color: '#00758F' },
  { name: 'PostgreSQL', Icon: SiPostgresql, color: '#336791' },
  { name: 'MariaDB', Icon: SiMariadb, color: '#003545' },
  { name: 'SQL Server', Icon: DiMsqlServer, color: '#CC2927' },
  { name: 'Oracle', Icon: Database, color: '#F80000' },
  { name: 'Snowflake', Icon: SiSnowflake, color: '#29B5E8' },
  { name: 'Redshift', Icon: DiAws, color: '#C73A36' },
];

function DbChip({ name, Icon, color }: { name: string; Icon: IconCmp; color: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-[#5B4FF7]/30 hover:shadow-[0_8px_24px_rgba(91,79,247,0.14)]">
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
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
            <DbChip key={i} name={db.name} Icon={db.Icon} color={db.color} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
