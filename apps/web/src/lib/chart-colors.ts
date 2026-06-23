/** Vivid, theme-friendly categorical palette for charts (works in light + dark). */
export const CHART_COLORS = [
  '#6366F1', // indigo
  '#06B6D4', // cyan
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#3B82F6', // blue
  '#84CC16', // lime
  '#A855F7', // purple
];

export const chartColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
