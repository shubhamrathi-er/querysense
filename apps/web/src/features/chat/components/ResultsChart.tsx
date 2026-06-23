'use client';

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ChartConfig, QueryResult } from '../types';
import { chartColor } from '@/lib/chart-colors';

interface Props {
  queryResult: QueryResult;
  chartConfig: ChartConfig;
}

export function ResultsChart({ queryResult, chartConfig }: Props) {
  const { rows } = queryResult;

  if (rows.length === 0) return null;

  const commonProps = {
    data: rows,
    margin: { top: 5, right: 20, left: 0, bottom: 60 },
  };

  const xAxisProps = {
    dataKey: chartConfig.xKey,
    tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
    angle: -35,
    textAnchor: 'end' as const,
    interval: 0,
  };

  const yAxisProps = {
    tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
    width: 60,
  };

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  };

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        {chartConfig.type === 'line' ? (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey={chartConfig.yKey}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ fill: 'hsl(var(--primary))', r: 3 }}
            />
          </LineChart>
        ) : (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey={chartConfig.yKey} radius={[4, 4, 0, 0]}>
              {rows.map((_, i) => (
                <Cell key={i} fill={chartColor(i)} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}