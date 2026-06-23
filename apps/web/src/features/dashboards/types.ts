export type WidgetType = 'CHART' | 'TABLE' | 'KPI' | 'TEXT';

export interface Widget {
  id: string;
  dashboardId: string;
  title: string;
  widgetType: WidgetType;
  sql: string;
  chartConfig: {
    type: 'bar' | 'line' | 'pie';
    xKey: string;
    yKey: string;
  } | null;
  position: { x: number; y: number; w: number; h: number };
  createdAt: string;
}

export interface Dashboard {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  widgets?: Widget[];
  _count?: { widgets: number };
}

export interface WidgetData {
  rows: Record<string, unknown>[];
  fields: Array<{ name: string; type: number }>;
  rowCount: number;
}