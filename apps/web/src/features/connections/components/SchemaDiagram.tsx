'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import { KeyRound, Link2, Eye, Table as TableIcon, Download, Image as ImageIcon } from 'lucide-react';
import { Select } from '@/components/ui/select';
import type { SchemaTable, SchemaModule } from '../types';

const MODULE_COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#22d3ee', '#fb923c', '#4ade80', '#e879f9', '#f87171',
];
const UNGROUPED_COLOR = '#6b7280';

const NODE_WIDTH = 230;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 30;
const MAX_ROWS = 14;

interface TableNodeData extends Record<string, unknown> {
  table: SchemaTable;
  color: string;
}

function nodeHeight(table: SchemaTable): number {
  const rows = Math.min(table.columns.length, MAX_ROWS);
  const extra = table.columns.length > MAX_ROWS ? ROW_HEIGHT : 0;
  return HEADER_HEIGHT + rows * ROW_HEIGHT + extra + 8;
}

function TableNode({ data }: NodeProps<Node<TableNodeData>>) {
  const { table, color } = data;
  const shown = table.columns.slice(0, MAX_ROWS);
  const hidden = table.columns.length - shown.length;

  return (
    <div
      className="rounded-lg border border-border bg-card shadow-lg overflow-hidden"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} id="l" style={{ background: color }} />
      <Handle type="source" position={Position.Right} id="r" style={{ background: color }} />
      <div
        className="flex items-center gap-1.5 px-2.5 text-xs font-semibold text-white"
        style={{ height: HEADER_HEIGHT, background: color }}
      >
        {table.isView ? <Eye className="w-3 h-3" /> : <TableIcon className="w-3 h-3" />}
        <span className="truncate font-mono">{table.tableName}</span>
      </div>
      <div>
        {shown.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-1.5 px-2.5 text-[10px] border-t border-border/40"
            style={{ height: ROW_HEIGHT }}
          >
            {c.isPrimaryKey ? (
              <KeyRound className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : c.isForeignKey ? (
              <Link2 className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400 shrink-0" />
            ) : (
              <span className="w-2.5 shrink-0" />
            )}
            <span className="font-mono truncate flex-1">{c.columnName}</span>
            <span className="text-muted-foreground/60 truncate max-w-[80px]">
              {c.dataType}
            </span>
          </div>
        ))}
        {hidden > 0 && (
          <div
            className="px-2.5 text-[10px] text-muted-foreground border-t border-border/40 flex items-center"
            style={{ height: ROW_HEIGHT }}
          >
            +{hidden} more
          </div>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { table: TableNode };

function buildGraph(
  tables: SchemaTable[],
  colorByModule: Map<string | null, string>,
): { nodes: Node<TableNodeData>[]; edges: Edge[] } {
  const present = new Set(tables.map((t) => t.tableName));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of tables) {
    g.setNode(t.tableName, { width: NODE_WIDTH, height: nodeHeight(t) });
  }

  const edges: Edge[] = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.isForeignKey && c.referencesTable && present.has(c.referencesTable)) {
        g.setEdge(t.tableName, c.referencesTable);
        edges.push({
          id: `${t.tableName}.${c.columnName}->${c.referencesTable}`,
          source: t.tableName,
          target: c.referencesTable,
          sourceHandle: 'r',
          targetHandle: 'l',
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: { stroke: '#64748b', strokeWidth: 1.5 },
        });
      }
    }
  }

  dagre.layout(g);

  const nodes: Node<TableNodeData>[] = tables.map((t) => {
    const pos = g.node(t.tableName);
    const color = colorByModule.get(t.moduleId ?? null) ?? UNGROUPED_COLOR;
    return {
      id: t.tableName,
      type: 'table',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - nodeHeight(t) / 2 },
      data: { table: t, color },
    };
  });

  return { nodes, edges };
}

function Flow({
  tables,
  modules,
  onSelectTable,
}: {
  tables: SchemaTable[];
  modules: SchemaModule[];
  onSelectTable: (name: string) => void;
}) {
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const { getNodes } = useReactFlow();

  const colorByModule = useMemo(() => {
    const map = new Map<string | null, string>();
    modules.forEach((m, i) => map.set(m.id, MODULE_COLORS[i % MODULE_COLORS.length]));
    map.set(null, UNGROUPED_COLOR);
    return map;
  }, [modules]);

  const visibleTables = useMemo(
    () =>
      moduleFilter
        ? tables.filter((t) =>
            moduleFilter === '__ungrouped__'
              ? !t.moduleId
              : t.moduleId === moduleFilter,
          )
        : tables,
    [tables, moduleFilter],
  );

  const { nodes: computedNodes, edges: computedEdges } = useMemo(
    () => buildGraph(visibleTables, colorByModule),
    [visibleTables, colorByModule],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  useEffect(() => {
    setNodes(computedNodes);
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  const onExport = useCallback(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) return;
    try {
      const bounds = getNodesBounds(getNodes());
      const w = 1600;
      const h = 1000;
      const vp = getViewportForBounds(bounds, w, h, 0.2, 2, 0.15);
      void toPng(viewport, {
        backgroundColor: '#0b0b12',
        width: w,
        height: h,
        style: {
          width: `${w}px`,
          height: `${h}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      }).then((dataUrl) => {
        const a = document.createElement('a');
        a.download = 'schema-diagram.png';
        a.href = dataUrl;
        a.click();
      });
    } catch {
      // Fallback: capture the current view as-is.
      void toPng(viewport, { backgroundColor: '#0b0b12' }).then((dataUrl) => {
        const a = document.createElement('a');
        a.download = 'schema-diagram.png';
        a.href = dataUrl;
        a.click();
      });
    }
  }, [getNodes]);

  return (
    <div className="relative h-full">
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <Select
          value={moduleFilter || 'all'}
          onValueChange={(v) => setModuleFilter(v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: 'All modules' },
            ...modules.map((m) => ({ value: m.id, label: m.name })),
            { value: '__ungrouped__', label: 'Ungrouped' },
          ]}
          ariaLabel="Filter by module"
          className="px-2 py-1.5 text-xs shadow"
        />
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 text-xs bg-card border border-border rounded-lg px-2.5 py-1.5 hover:bg-accent transition-colors shadow"
        >
          <Download className="w-3.5 h-3.5" /> PNG
        </button>
      </div>

      {/* Legend */}
      {modules.length > 0 && !moduleFilter && (
        <div className="absolute top-3 right-3 z-10 bg-card/90 border border-border rounded-lg p-2 shadow max-w-[180px]">
          <div className="flex flex-wrap gap-1.5">
            {modules.map((m, i) => (
              <span key={m.id} className="flex items-center gap-1 text-[10px]">
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ background: MODULE_COLORS[i % MODULE_COLORS.length] }}
                />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectTable(node.id)}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls className="!bg-card !border-border" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.data as TableNodeData).color}
          className="!bg-card !border-border"
        />
      </ReactFlow>
    </div>
  );
}

export function SchemaDiagram(props: {
  tables: SchemaTable[];
  modules: SchemaModule[];
  onSelectTable: (name: string) => void;
}) {
  if (props.tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <ImageIcon className="w-4 h-4 mr-2" /> No tables to diagram.
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
