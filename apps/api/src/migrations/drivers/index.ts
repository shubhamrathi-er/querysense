import { DbEngine } from '../../common/db/engine';
import type { MigrationConn, MigrationDriver } from './migration-driver';
import { MysqlMigrationDriver } from './mysql-migration.driver';
import { PostgresMigrationDriver } from './postgres-migration.driver';
import { SqlServerMigrationDriver } from './sqlserver-migration.driver';

export * from './migration-driver';

/** Build the data-migration driver for a same-engine source→target pair. */
export function createMigrationDriver(
  engine: DbEngine,
  source: MigrationConn,
  target: MigrationConn,
): MigrationDriver {
  if (engine === 'postgres') return new PostgresMigrationDriver(source, target);
  if (engine === 'sqlserver') return new SqlServerMigrationDriver(source, target);
  return new MysqlMigrationDriver(source, target);
}
