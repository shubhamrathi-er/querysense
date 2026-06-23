'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, BarChart2, Table, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { useCreateWidget } from '../hooks/useDashboards';

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  sql: z.string().min(1, 'SQL is required'),
  widgetType: z.enum(['CHART', 'TABLE', 'KPI']),
  xKey: z.string().optional(),
  yKey: z.string().optional(),
  chartType: z.enum(['bar', 'line']).optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  dashboardId: string;
  connectionId: string;
  onClose: () => void;
}

const WIDGET_TYPES = [
  { value: 'KPI', label: 'KPI', icon: TrendingUp, desc: 'Single number metric' },
  { value: 'CHART', label: 'Chart', icon: BarChart2, desc: 'Bar or line chart' },
  { value: 'TABLE', label: 'Table', icon: Table, desc: 'Data grid' },
] as const;

const EXAMPLE_QUERIES = [
  { label: 'Count users', sql: 'SELECT COUNT(*) as total_users FROM users' },
  { label: 'Users by date', sql: 'SELECT DATE(created_at) as date, COUNT(*) as count FROM users GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30' },
  { label: 'All tables', sql: 'SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_rows DESC' },
];

export function AddWidgetModal({ dashboardId, connectionId, onClose }: Props) {
  const createWidget = useCreateWidget(dashboardId);
  const [selectedType, setSelectedType] = useState<'KPI' | 'CHART' | 'TABLE'>('KPI');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { widgetType: 'KPI', chartType: 'bar' },
  });

  const onSubmit = async (data: FormData) => {
    const chartConfig =
      data.widgetType === 'CHART' && data.xKey && data.yKey
        ? { type: data.chartType ?? 'bar', xKey: data.xKey, yKey: data.yKey }
        : undefined;

    await createWidget.mutateAsync({
      title: data.title,
      widgetType: data.widgetType,
      sql: data.sql,
      chartConfig,
      position: { x: 0, y: 0, w: 4, h: 3 },
      connectionId,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card">
          <h2 className="font-semibold">Add Widget</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">

          {/* Widget Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Widget Type</label>
            <div className="grid grid-cols-3 gap-2">
              {WIDGET_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => {
                    setSelectedType(type.value);
                    setValue('widgetType', type.value);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors',
                    selectedType === type.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/30 text-muted-foreground',
                  )}
                >
                  <type.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{type.label}</span>
                  <span className="text-xs opacity-70">{type.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Widget Title</label>
            <input
              {...register('title')}
              placeholder="e.g. Total Users"
              className={cn(
                'w-full px-3 py-2 bg-input border rounded-lg text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                'placeholder:text-muted-foreground',
                errors.title ? 'border-destructive' : 'border-border',
              )}
            />
            {errors.title && <p className="text-destructive text-xs mt-1">{errors.title.message}</p>}
          </div>

          {/* SQL */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium">SQL Query</label>
              <div className="flex gap-1">
                {EXAMPLE_QUERIES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => setValue('sql', ex.sql)}
                    className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent text-muted-foreground transition-colors"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              {...register('sql')}
              rows={4}
              placeholder="SELECT COUNT(*) as total FROM users"
              className={cn(
                'w-full px-3 py-2 bg-input border rounded-lg text-sm font-mono',
                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                'placeholder:text-muted-foreground resize-none',
                errors.sql ? 'border-destructive' : 'border-border',
              )}
            />
            {errors.sql && <p className="text-destructive text-xs mt-1">{errors.sql.message}</p>}
          </div>

          {/* Chart config — only show for CHART type */}
          {selectedType === 'CHART' && (
            <div className="space-y-3 p-4 bg-muted/30 rounded-xl border border-border">
              <p className="text-sm font-medium">Chart Configuration</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Chart Type</label>
                  <Select
                    value={watch('chartType') ?? 'bar'}
                    onValueChange={(v) => setValue('chartType', v as 'bar' | 'line')}
                    options={[
                      { value: 'bar', label: 'Bar Chart' },
                      { value: 'line', label: 'Line Chart' },
                    ]}
                    ariaLabel="Chart type"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">X Axis Column</label>
                  <input
                    {...register('xKey')}
                    placeholder="e.g. date"
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Y Axis Column</label>
                <input
                  {...register('yKey')}
                  placeholder="e.g. count"
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Column names must match exactly what your SQL returns
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'w-full py-2.5 px-4 bg-primary text-primary-foreground rounded-lg',
              'text-sm font-medium hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2',
            )}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Adding...' : 'Add Widget'}
          </button>
        </form>
      </div>
    </div>
  );
}