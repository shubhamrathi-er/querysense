'use client';

import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Trash2,
  Loader2,
  BarChart2,
  Table,
  TrendingUp,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';
import { chartColor } from '@/lib/chart-colors';
import { useRefreshWidget, useDeleteWidget } from '../hooks/useDashboards';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import type { Widget, WidgetData } from '../types';

interface Props {
  widget: Widget;
  dashboardId: string;
  connectionId: string;
}

const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

export function WidgetCard({ widget, dashboardId, connectionId }: Props) {
  const [data, setData] = useState<WidgetData | null>(null);
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const refreshWidget = useRefreshWidget(dashboardId);
  const deleteWidget = useDeleteWidget(dashboardId);
  const confirm = useConfirm();
  const toast = useToast();

  // Auto-load data on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    handleRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    try {
      const result = await refreshWidget.mutateAsync({
        widgetId: widget.id,
        connectionId,
      });
      setData(result);
    } catch {
      // silent fail — widget shows empty state
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete widget',
      description: `Delete widget "${widget.title}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteWidget.mutateAsync(widget.id);
      toast.success(`Deleted "${widget.title}".`);
    } catch {
      toast.error('Failed to delete widget.');
    }
  };

  // KPI Widget — single number
  const isKPI = widget.widgetType === 'KPI' ||
    (data && data.rows.length === 1 && data.fields.length === 1);

  const kpiValue = isKPI && data?.rows[0]
    ? Object.values(data.rows[0])[0]
    : null;

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-medium text-sm truncate">{widget.title}</h3>
        <div className="flex items-center gap-1 shrink-0">
          {widget.chartConfig && data && data.rows.length > 0 && !isKPI && (
            <div className="flex items-center gap-0.5 mr-1">
              <button
                onClick={() => setActiveTab('chart')}
                className={cn(
                  'p-1 rounded transition-colors',
                  activeTab === 'chart'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setActiveTab('table')}
                className={cn(
                  'p-1 rounded transition-colors',
                  activeTab === 'table'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Table className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshWidget.isPending}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {refreshWidget.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
          </button>
          <button
            onClick={() => void handleDelete()}
            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 min-h-0">
        {refreshWidget.isPending && !data ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No data
          </div>
        ) : isKPI ? (
          /* KPI Display */
          <div className="h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">
                {data.fields[0]?.name}
              </span>
            </div>
            <div className="text-4xl font-bold text-primary">
              {typeof kpiValue === 'number'
                ? kpiValue.toLocaleString()
                : String(kpiValue ?? 0)}
            </div>
          </div>
        ) : activeTab === 'table' || !widget.chartConfig ? (
          /* Table Display */
          <div className="overflow-auto h-full">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {data.fields.map((f) => (
                    <th
                      key={f.name}
                      className="px-2 py-1.5 text-left font-semibold text-muted-foreground"
                    >
                      {f.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 50).map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                    {data.fields.map((f) => (
                      <td key={f.name} className="px-2 py-1.5 font-mono">
                        {row[f.name] === null
                          ? <span className="text-muted-foreground italic">NULL</span>
                          : String(row[f.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Chart Display */
          <div className="h-full min-h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              {widget.chartConfig.type === 'line' ? (
                <LineChart data={data.rows} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey={widget.chartConfig.xKey}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={45} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey={widget.chartConfig.yKey}
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              ) : (
                <BarChart data={data.rows} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey={widget.chartConfig.xKey}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={45} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey={widget.chartConfig.yKey} radius={[3, 3, 0, 0]}>
                    {data.rows.map((_, i) => (
                      <Cell key={i} fill={chartColor(i)} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}