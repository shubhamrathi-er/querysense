'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  RefreshCw, Trash2, CheckCircle2, Clock, Loader2,
  Table2, Network, MoreVertical, Database,
} from 'lucide-react';
import { SiMysql, SiPostgresql, SiMariadb, SiSnowflake } from 'react-icons/si';
import { DiMsqlServer, DiAws } from 'react-icons/di';
import { cn, timeAgo } from '@/lib/utils';
import { StatusDot, statusTone } from '@/components/ui/status-dot';
import {
  useDeleteConnection,
  useSyncSchema,
  useTestExistingConnection,
} from '../hooks/useConnections';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import type { Connection } from '../types';

interface Props {
  connection: Connection;
  index?: number;
}

const statusConfig: Record<
  Connection['status'],
  { label: string; text: string; bg: string; dot: string }
> = {
  ACTIVE: { label: 'Active', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
  ERROR: { label: 'Error', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', dot: 'bg-red-500' },
  PENDING: { label: 'Pending', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
  DISCONNECTED: { label: 'Disconnected', text: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground' },
};

export function ConnectionCard({ connection, index = 0 }: Props) {
  const deleteConnection = useDeleteConnection();
  const syncSchema = useSyncSchema();
  const testConnection = useTestExistingConnection();
  const confirm = useConfirm();
  const toast = useToast();

  const status = statusConfig[connection.status];
  const tables = connection._count?.schemaMetadata ?? 0;

  const handleSync = async () => {
    try {
      const result = await syncSchema.mutateAsync(connection.id);
      toast.success(`Synced ${result.tablesDiscovered} tables from "${connection.name}".`);
    } catch {
      toast.error(`Failed to sync schema for "${connection.name}".`);
    }
  };

  const handleTest = async () => {
    try {
      const result = await testConnection.mutateAsync(connection.id);
      if (result.success) toast.success(result.message ?? 'Connection OK.');
      else toast.error(result.message ?? 'Connection failed.');
    } catch {
      toast.error('Could not test the connection.');
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete connection',
      description: `Delete "${connection.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteConnection.mutateAsync(connection.id);
      toast.success(`Deleted "${connection.name}".`);
    } catch {
      toast.error(`Failed to delete "${connection.name}".`);
    }
  };

  const menuItem =
    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground/85 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="overflow-hidden rounded-2xl border border-border border-l-[3px] border-l-primary/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_36px_-22px_rgba(15,23,42,0.22)] transition-[box-shadow,border-color] duration-300 hover:border-primary/30 hover:border-l-primary hover:shadow-[0_18px_44px_-18px_rgba(91,79,247,0.3)]"
    >
      {/* Top */}
      <div className="flex items-start gap-3 p-4">
        {/* logo */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-white">
          {connection.engine === 'postgres' ? (
            <SiPostgresql className="h-7 w-7" style={{ color: '#336791' }} />
          ) : connection.engine === 'sqlserver' ? (
            <DiMsqlServer className="h-7 w-7" style={{ color: '#CC2927' }} />
          ) : connection.engine === 'mariadb' ? (
            <SiMariadb className="h-7 w-7" style={{ color: '#003545' }} />
          ) : connection.engine === 'redshift' ? (
            <DiAws className="h-7 w-7" style={{ color: '#C73A36' }} />
          ) : connection.engine === 'snowflake' ? (
            <SiSnowflake className="h-7 w-7" style={{ color: '#29B5E8' }} />
          ) : connection.engine === 'oracle' ? (
            <Database className="h-7 w-7" style={{ color: '#F80000' }} />
          ) : (
            <SiMysql className="h-7 w-7" style={{ color: '#00758F' }} />
          )}
        </div>

        {/* info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot tone={statusTone(connection.status)} size={8} />
            <h3 className="truncate text-base font-semibold text-foreground">
              {connection.name}
            </h3>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            <span className="font-medium text-foreground/70">
              {connection.engine === 'postgres'
                ? 'PostgreSQL'
                : connection.engine === 'sqlserver'
                  ? 'SQL Server'
                  : connection.engine === 'mariadb'
                    ? 'MariaDB'
                    : connection.engine === 'redshift'
                      ? 'Redshift'
                      : connection.engine === 'snowflake'
                        ? 'Snowflake'
                        : connection.engine === 'oracle'
                          ? 'Oracle'
                          : 'MySQL'}
            </span>
            {'  ·  '}
            {connection.host}:{connection.port}/{connection.databaseName}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Table2 className="h-3.5 w-3.5" /> {tables} table{tables !== 1 ? 's' : ''}
            </span>
            {connection.lastSyncedAt && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Synced {timeAgo(connection.lastSyncedAt)}
              </span>
            )}
          </div>
        </div>

        {/* status + menu */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', status.bg, status.text)}>
            <StatusDot tone={statusTone(connection.status)} size={6} />
            {status.label}
          </span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label="Connection actions"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 w-48 rounded-xl border border-border bg-popover p-1 shadow-xl"
              >
                <DropdownMenu.Item className={menuItem} onSelect={() => void handleTest()}>
                  <CheckCircle2 className="h-4 w-4" /> Test connection
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menuItem} onSelect={() => void handleSync()}>
                  <RefreshCw className="h-4 w-4" /> Sync schema
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild className={menuItem}>
                  <Link href={`/dashboard/connections/${connection.id}`}>
                    <Network className="h-4 w-4" /> Explore schema
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  className={cn(menuItem, 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive')}
                  onSelect={() => void handleDelete()}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
        <ActionButton onClick={() => void handleSync()} loading={syncSchema.isPending} icon={RefreshCw} className="text-primary">
          Sync Schema
        </ActionButton>
        <ActionButton onClick={() => void handleTest()} loading={testConnection.isPending} icon={CheckCircle2}>
          Test Connection
        </ActionButton>
        <Link
          href={`/dashboard/connections/${connection.id}`}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Network className="h-3.5 w-3.5" /> Explore Schema
        </Link>
        <button
          onClick={() => void handleDelete()}
          disabled={deleteConnection.isPending}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </motion.div>
  );
}

function ActionButton({
  onClick,
  loading,
  icon: Icon,
  children,
  className,
}: {
  onClick: () => void;
  loading?: boolean;
  icon: typeof RefreshCw;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground disabled:opacity-50',
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
