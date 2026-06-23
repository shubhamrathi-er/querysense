'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { useConnection } from '@/features/connections/hooks/useConnections';
import { SchemaExplorer } from '@/features/connections/components/SchemaExplorer';

export default function ConnectionSchemaPage({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = use(params);
  const { data: connection, isLoading, isError } = useConnection(connectionId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !connection) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <AlertCircle className="w-10 h-10 text-yellow-500" />
        <p className="text-sm text-muted-foreground">
          Couldn’t load this connection.
        </p>
        <Link
          href="/dashboard/connections"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Connections
        </Link>
      </div>
    );
  }

  return <SchemaExplorer connection={connection} />;
}
