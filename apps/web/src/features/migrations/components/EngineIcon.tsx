import { SiMysql, SiPostgresql, SiMariadb, SiSnowflake } from 'react-icons/si';
import { DiMsqlServer, DiAws } from 'react-icons/di';
import { Database } from 'lucide-react';
import type { DatabaseEngine } from '@/features/connections/types';

type IconCmp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

// Brand icon + colour per engine — matches the connection cards across the app.
const ENGINE_ICONS: Record<DatabaseEngine, { Icon: IconCmp; color: string }> = {
  postgres: { Icon: SiPostgresql, color: '#336791' },
  mysql: { Icon: SiMysql, color: '#00758F' },
  mariadb: { Icon: SiMariadb, color: '#003545' },
  sqlserver: { Icon: DiMsqlServer, color: '#CC2927' },
  redshift: { Icon: DiAws, color: '#C73A36' },
  snowflake: { Icon: SiSnowflake, color: '#29B5E8' },
  oracle: { Icon: Database, color: '#F80000' },
};

export function EngineIcon({
  engine,
  className,
}: {
  engine?: DatabaseEngine;
  className?: string;
}) {
  const { Icon, color } = ENGINE_ICONS[engine ?? 'mysql'] ?? ENGINE_ICONS.mysql;
  return <Icon className={className} style={{ color }} />;
}
