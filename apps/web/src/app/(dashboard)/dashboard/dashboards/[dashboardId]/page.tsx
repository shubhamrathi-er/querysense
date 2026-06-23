'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ArrowLeft, RefreshCw } from 'lucide-react';
import { useDashboard } from '@/features/dashboards/hooks/useDashboards';
import { WidgetCard } from '@/features/dashboards/components/WidgetCard';
import { AddWidgetModal } from '@/features/dashboards/components/AddWidgetModal';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { useWorkspaceStore } from '@/stores/workspace.store';

interface Props {
  params: Promise<{ dashboardId: string }>;
}

export default function DashboardDetailPage({ params }: Props) {
  const { dashboardId } = use(params);
  const router = useRouter();
  const { currentWorkspace } = useWorkspaceStore();
  const { data: dashboard, isLoading, refetch } = useDashboard(dashboardId);
  const { data: connections } = useConnections();
  const [showAddWidget, setShowAddWidget] = useState(false);

  const activeConnection = connections?.find((c) => c.status === 'ACTIVE');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!dashboard) return null;

  return (
    <div className="p-8 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard/dashboards')}
            className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">{dashboard.name}</h1>
            {dashboard.description && (
              <p className="text-muted-foreground mt-0.5 text-sm">
                {dashboard.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void refetch()}
            className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {activeConnection && (
            <button
              onClick={() => setShowAddWidget(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Widget
            </button>
          )}
        </div>
      </div>

      {/* No connection warning */}
      {!activeConnection && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-sm rounded-xl p-4 mb-6">
          No active database connection. Go to Connections and sync your schema first.
        </div>
      )}

      {/* Widgets grid */}
      {dashboard.widgets && dashboard.widgets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-4 auto-rows-[280px]">
          {dashboard.widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              dashboardId={dashboardId}
              connectionId={activeConnection?.id ?? ''}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm mb-4">
            No widgets yet. Add your first widget to visualize your data.
          </p>
          {activeConnection && (
            <button
              onClick={() => setShowAddWidget(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Widget
            </button>
          )}
        </div>
      )}

      {/* Modal */}
      {showAddWidget && activeConnection && (
        <AddWidgetModal
          dashboardId={dashboardId}
          connectionId={activeConnection.id}
          onClose={() => setShowAddWidget(false)}
        />
      )}
    </div>
  );
}