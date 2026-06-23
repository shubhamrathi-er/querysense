'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Database, Table as TableIcon, Eye, Search, KeyRound,
  Link2, RefreshCw, Loader2, Columns3, GitFork, Sparkles, Pencil, Check, X,
  Folder, FolderPlus, ChevronDown, ChevronRight, Trash2, ShieldCheck,
  List, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { AuditReportModal } from './AuditReportModal';
import { SchemaDiagram } from './SchemaDiagram';
import {
  useSyncSchema,
  useDescribeTable,
  useUpdateTableDescription,
  useUpdateColumnDescription,
  useSuggestModules,
  useCreateModule,
  useUpdateModule,
  useDeleteModule,
  useAssignTableModule,
} from '../hooks/useConnections';
import type {
  ConnectionWithSchema,
  SchemaTable,
  SchemaColumn,
  SchemaModule,
} from '../types';

interface Props {
  connection: ConnectionWithSchema;
}

interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export function SchemaExplorer({ connection }: Props) {
  const tables = useMemo(
    () => [...connection.schemaMetadata].sort((a, b) => a.tableName.localeCompare(b.tableName)),
    [connection.schemaMetadata],
  );

  const syncSchema = useSyncSchema();
  const describeTable = useDescribeTable(connection.id);
  const [search, setSearch] = useState('');
  const [genAll, setGenAll] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [showAudit, setShowAudit] = useState(false);
  const [view, setView] = useState<'list' | 'diagram'>('list');
  const [selectedName, setSelectedName] = useState<string | null>(
    tables[0]?.tableName ?? null,
  );

  const handleGenerateAll = async () => {
    setGenAll({ done: 0, total: tables.length });
    for (let i = 0; i < tables.length; i++) {
      try {
        await describeTable.mutateAsync(tables[i].tableName);
      } catch {
        // skip a table that fails, keep going
      }
      setGenAll({ done: i + 1, total: tables.length });
    }
    setGenAll(null);
  };

  // All FK relationships across the schema.
  const relationships = useMemo<Relationship[]>(() => {
    const rels: Relationship[] = [];
    for (const t of tables) {
      for (const c of t.columns) {
        if (c.isForeignKey && c.referencesTable && c.referencesColumn) {
          rels.push({
            fromTable: t.tableName,
            fromColumn: c.columnName,
            toTable: c.referencesTable,
            toColumn: c.referencesColumn,
          });
        }
      }
    }
    return rels;
  }, [tables]);

  const totalColumns = useMemo(
    () => tables.reduce((sum, t) => sum + t.columns.length, 0),
    [tables],
  );

  const q = search.trim().toLowerCase();
  const filteredTables = q
    ? tables.filter(
        (t) =>
          t.tableName.toLowerCase().includes(q) ||
          t.columns.some((c) => c.columnName.toLowerCase().includes(q)),
      )
    : tables;

  const selected = tables.find((t) => t.tableName === selectedName) ?? null;
  const incoming = selected
    ? relationships.filter((r) => r.toTable === selected.tableName)
    : [];
  const outgoing = selected
    ? relationships.filter((r) => r.fromTable === selected.tableName)
    : [];

  const tableNameSet = useMemo(
    () => new Set(tables.map((t) => t.tableName)),
    [tables],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-border">
        <Link
          href="/dashboard/connections"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Connections
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5 text-blue-500" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{connection.name}</h1>
              <p className="text-xs text-muted-foreground truncate">
                {connection.host}:{connection.port}/{connection.databaseName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tables.length > 0 && (
              <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
                {(['list', 'diagram'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      view === v
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {v === 'list' ? (
                      <><List className="w-3.5 h-3.5" /> List</>
                    ) : (
                      <><Workflow className="w-3.5 h-3.5" /> Diagram</>
                    )}
                  </button>
                ))}
              </div>
            )}
            {tables.length > 0 && (
              <button
                onClick={() => setShowAudit(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors text-muted-foreground"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Health check
              </button>
            )}
            {tables.length > 0 && (
              <button
                onClick={() => void handleGenerateAll()}
                disabled={!!genAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
              >
                {genAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {genAll
                  ? `Describing ${genAll.done}/${genAll.total}…`
                  : 'Generate all'}
              </button>
            )}
            <button
              onClick={() => void syncSchema.mutateAsync(connection.id)}
              disabled={syncSchema.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {syncSchema.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Sync Schema
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <TableIcon className="w-3.5 h-3.5" /> {tables.length} tables
          </span>
          <span className="flex items-center gap-1.5">
            <Columns3 className="w-3.5 h-3.5" /> {totalColumns} columns
          </span>
          <span className="flex items-center gap-1.5">
            <GitFork className="w-3.5 h-3.5" /> {relationships.length} relationships
          </span>
        </div>
      </div>

      {tables.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Database className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No schema synced yet — click “Sync Schema” to discover tables.
            </p>
          </div>
        </div>
      ) : view === 'diagram' ? (
        <div className="flex-1 min-h-0">
          <SchemaDiagram
            tables={tables}
            modules={connection.modules ?? []}
            onSelectTable={(name) => {
              setSelectedName(name);
              setView('list');
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Table list */}
          <div className="w-72 border-r border-border flex flex-col shrink-0">
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tables & columns…"
                  className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-primary/50"
                />
              </div>
            </div>
            <ModuleSidebar
              connectionId={connection.id}
              modules={connection.modules ?? []}
              tables={filteredTables}
              searching={!!q}
              selectedName={selectedName}
              onSelect={setSelectedName}
            />
          </div>

          {/* Table detail */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <TableDetail
                connectionId={connection.id}
                table={selected}
                modules={connection.modules ?? []}
                incoming={incoming}
                outgoing={outgoing}
                tableNameSet={tableNameSet}
                onSelectTable={setSelectedName}
                searchHighlight={q}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a table to view its structure.
              </div>
            )}
          </div>
        </div>
      )}

      {showAudit && (
        <AuditReportModal
          connectionId={connection.id}
          connectionName={connection.name}
          onClose={() => setShowAudit(false)}
        />
      )}
    </div>
  );
}

function TableDetail({
  connectionId,
  table,
  modules,
  incoming,
  outgoing,
  tableNameSet,
  onSelectTable,
  searchHighlight,
}: {
  connectionId: string;
  table: SchemaTable;
  modules: SchemaModule[];
  incoming: Relationship[];
  outgoing: Relationship[];
  tableNameSet: Set<string>;
  onSelectTable: (name: string) => void;
  searchHighlight: string;
}) {
  const describe = useDescribeTable(connectionId);
  const saveTableDesc = useUpdateTableDescription(connectionId);
  const saveColDesc = useUpdateColumnDescription(connectionId);
  const assignModule = useAssignTableModule(connectionId);

  const tableDesc =
    table.businessDescription ?? table.aiDescription ?? table.tableComment ?? '';
  const [editingTable, setEditingTable] = useState(false);
  const [tableDraft, setTableDraft] = useState('');
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [colDraft, setColDraft] = useState('');

  const refLink = (tableName: string, columnName: string) => {
    const exists = tableNameSet.has(tableName);
    const label = `${tableName}.${columnName}`;
    return exists ? (
      <button
        onClick={() => onSelectTable(tableName)}
        className="text-primary hover:underline font-mono"
      >
        {label}
      </button>
    ) : (
      <span className="font-mono text-muted-foreground">{label}</span>
    );
  };

  const startColEdit = (c: SchemaColumn) => {
    setEditingCol(c.columnName);
    setColDraft(c.aiDescription ?? c.columnComment ?? '');
  };
  const commitColEdit = (columnName: string) => {
    saveColDesc.mutate({ tableName: table.tableName, columnName, description: colDraft });
    setEditingCol(null);
  };

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2">
          {table.isView ? (
            <Eye className="w-4 h-4 text-muted-foreground" />
          ) : (
            <TableIcon className="w-4 h-4 text-muted-foreground" />
          )}
          <h2 className="text-base font-semibold font-mono">{table.tableName}</h2>
          {table.isView && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              View
            </span>
          )}
          {table.rowCount !== null && (
            <span className="text-xs text-muted-foreground">
              ~{table.rowCount.toLocaleString()} rows
            </span>
          )}

          {/* Module assignment */}
          <div className="ml-auto flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-muted-foreground" />
            <Select
              value={table.moduleId ?? 'none'}
              onValueChange={(v) =>
                assignModule.mutate({
                  tableName: table.tableName,
                  moduleId: v === 'none' ? null : v,
                })
              }
              options={[
                { value: 'none', label: '— Ungrouped —' },
                ...modules.map((m) => ({ value: m.id, label: m.name })),
              ]}
              ariaLabel="Assign module"
              className="max-w-[160px] px-2 py-1 text-xs"
            />
          </div>
        </div>

        {/* Description (editable + AI-generate) */}
        <div className="mt-2">
          {editingTable ? (
            <div className="space-y-2">
              <textarea
                value={tableDraft}
                onChange={(e) => setTableDraft(e.target.value)}
                rows={2}
                autoFocus
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50 resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    saveTableDesc.mutate({
                      tableName: table.tableName,
                      description: tableDraft,
                    });
                    setEditingTable(false);
                  }}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20"
                >
                  <Check className="w-3 h-3" /> Save
                </button>
                <button
                  onClick={() => setEditingTable(false)}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg hover:bg-accent text-muted-foreground"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <p
                className={cn(
                  'text-sm flex-1',
                  tableDesc
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/50 italic',
                )}
              >
                {tableDesc || 'No description yet.'}
              </p>
              <button
                onClick={() => {
                  setTableDraft(table.businessDescription ?? table.aiDescription ?? '');
                  setEditingTable(true);
                }}
                title="Edit description"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => describe.mutate(table.tableName)}
                disabled={describe.isPending}
                title="Generate with AI"
                className="flex items-center gap-1 text-xs px-2 py-1 rounded text-primary hover:bg-primary/10 transition-colors shrink-0 disabled:opacity-50"
              >
                {describe.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {table.aiDescription || table.businessDescription
                  ? 'Regenerate'
                  : 'Generate'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Columns */}
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
          Columns ({table.columns.length})
        </h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
                <th className="text-left font-semibold px-3 py-2">Column</th>
                <th className="text-left font-semibold px-3 py-2">Type</th>
                <th className="text-left font-semibold px-3 py-2">Constraints</th>
                <th className="text-left font-semibold px-3 py-2">References</th>
                <th className="text-left font-semibold px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((c, i) => {
                const match =
                  searchHighlight &&
                  c.columnName.toLowerCase().includes(searchHighlight);
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      'border-t border-border/40',
                      i % 2 === 1 && 'bg-muted/10',
                      match && 'bg-primary/5',
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1.5"
                        title={
                          c.sampleValues && c.sampleValues.length
                            ? `e.g. ${c.sampleValues.join(', ')}`
                            : undefined
                        }
                      >
                        {c.isPrimaryKey && (
                          <KeyRound className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        )}
                        {c.isForeignKey && !c.isPrimaryKey && (
                          <Link2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        )}
                        {c.columnName}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {c.dataType}
                    </td>
                    <td className="px-3 py-2 text-[10px] whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        {c.isPrimaryKey && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-600 dark:text-amber-400">
                            PK
                          </span>
                        )}
                        {c.isForeignKey && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-600 dark:text-blue-400">
                            FK
                          </span>
                        )}
                        {!c.isNullable && (
                          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            NOT NULL
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {c.referencesTable && c.referencesColumn
                        ? refLink(c.referencesTable, c.referencesColumn)
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs min-w-[180px]">
                      {editingCol === c.columnName ? (
                        <input
                          value={colDraft}
                          onChange={(e) => setColDraft(e.target.value)}
                          onBlur={() => commitColEdit(c.columnName)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitColEdit(c.columnName);
                            if (e.key === 'Escape') setEditingCol(null);
                          }}
                          autoFocus
                          className="w-full bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary/50"
                        />
                      ) : (
                        <button
                          onClick={() => startColEdit(c)}
                          title="Click to edit"
                          className={cn(
                            'text-left w-full hover:text-foreground transition-colors',
                            c.aiDescription || c.columnComment
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/40',
                          )}
                        >
                          {c.aiDescription ?? c.columnComment ?? '+ add'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Relationships */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
            References ({outgoing.length})
          </h3>
          {outgoing.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No outgoing FKs.</p>
          ) : (
            <ul className="space-y-1">
              {outgoing.map((r, i) => (
                <li key={i} className="text-xs flex items-center gap-1.5">
                  <span className="font-mono text-muted-foreground">{r.fromColumn}</span>
                  <Link2 className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                  {refLink(r.toTable, r.toColumn)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
            Referenced by ({incoming.length})
          </h3>
          {incoming.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No incoming FKs.</p>
          ) : (
            <ul className="space-y-1">
              {incoming.map((r, i) => (
                <li key={i} className="text-xs flex items-center gap-1.5">
                  {refLink(r.fromTable, r.fromColumn)}
                  <Link2 className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="font-mono text-muted-foreground">{r.toColumn}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Module-grouped table list ───────────────────────────────

function TableButton({
  table,
  selected,
  onSelect,
}: {
  table: SchemaTable;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(table.tableName)}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors',
        selected ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-foreground/80',
      )}
    >
      {table.isView ? (
        <Eye className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <TableIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="text-xs font-mono truncate flex-1">{table.tableName}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {table.columns.length}
      </span>
    </button>
  );
}

function ModuleSidebar({
  connectionId,
  modules,
  tables,
  searching,
  selectedName,
  onSelect,
}: {
  connectionId: string;
  modules: SchemaModule[];
  tables: SchemaTable[];
  searching: boolean;
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  const suggest = useSuggestModules(connectionId);
  const createModule = useCreateModule(connectionId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ungrouped = tables.filter((t) => !t.moduleId);

  const handleAdd = () => {
    const name = newName.trim();
    if (name) createModule.mutate(name);
    setNewName('');
    setAdding(false);
  };

  return (
    <>
      <div className="px-2 py-2 border-b border-border flex items-center gap-1.5">
        <button
          onClick={() => suggest.mutate()}
          disabled={suggest.isPending}
          title="Group tables into modules with AI"
          className="flex-1 flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
        >
          {suggest.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Suggest modules
        </button>
        <button
          onClick={() => setAdding((v) => !v)}
          title="Add a module"
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {adding && (
          <div className="flex items-center gap-1.5 px-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setNewName('');
                }
              }}
              placeholder="Module name…"
              autoFocus
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary/50"
            />
            <button
              onClick={handleAdd}
              className="p-1 rounded text-green-600 dark:text-green-400 hover:bg-green-500/10"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {modules.map((m) => {
          const mt = tables.filter((t) => t.moduleId === m.id);
          if (searching && mt.length === 0) return null;
          return (
            <ModuleGroup
              key={m.id}
              connectionId={connectionId}
              module={m}
              tables={mt}
              collapsed={collapsed.has(m.id)}
              onToggle={() => toggle(m.id)}
              selectedName={selectedName}
              onSelect={onSelect}
            />
          );
        })}

        {(ungrouped.length > 0 || (!searching && modules.length === 0)) && (
          <ModuleGroup
            connectionId={connectionId}
            module={null}
            tables={ungrouped}
            collapsed={collapsed.has('__ungrouped__')}
            onToggle={() => toggle('__ungrouped__')}
            selectedName={selectedName}
            onSelect={onSelect}
          />
        )}

        {tables.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No tables match your search.
          </p>
        )}
      </div>
    </>
  );
}

function ModuleGroup({
  connectionId,
  module,
  tables,
  collapsed,
  onToggle,
  selectedName,
  onSelect,
}: {
  connectionId: string;
  module: SchemaModule | null;
  tables: SchemaTable[];
  collapsed: boolean;
  onToggle: () => void;
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  const updateModule = useUpdateModule(connectionId);
  const deleteModule = useDeleteModule(connectionId);
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(module?.name ?? '');
  const [desc, setDesc] = useState(module?.description ?? '');

  const handleDelete = async () => {
    if (!module) return;
    const ok = await confirm({
      title: 'Delete module',
      description: `Delete module "${module.name}"? Its tables become ungrouped.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    deleteModule.mutate(module.id, {
      onSuccess: () => toast.success(`Deleted module "${module.name}".`),
      onError: () => toast.error('Failed to delete module.'),
    });
  };

  const startEdit = () => {
    setName(module?.name ?? '');
    setDesc(module?.description ?? '');
    setEditing(true);
  };
  const save = () => {
    if (module) {
      updateModule.mutate({ moduleId: module.id, name: name.trim(), description: desc });
    }
    setEditing(false);
  };

  return (
    <div>
      <div className="group flex items-center gap-1 px-1 py-1 rounded-lg">
        <button onClick={onToggle} className="p-0.5 text-muted-foreground shrink-0">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            className="flex-1 bg-background border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:border-primary/50"
          />
        ) : (
          <span className="text-xs font-semibold truncate flex-1">
            {module ? module.name : 'Ungrouped'}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {tables.length}
        </span>
        {module && !editing && (
          <>
            <button
              onClick={startEdit}
              title="Edit module"
              className="p-0.5 rounded text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => void handleDelete()}
              title="Delete module"
              className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {editing && (
        <div className="pl-6 pr-1 pb-2 space-y-1.5">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Module description…"
            rows={2}
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary/50 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20"
            >
              <Check className="w-3 h-3" /> Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded hover:bg-accent text-muted-foreground"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}

      {module?.description && !editing && !collapsed && (
        <p className="text-[10px] text-muted-foreground/70 pl-6 pr-1 pb-1">
          {module.description}
        </p>
      )}

      {!collapsed && (
        <div className="pl-3 space-y-0.5">
          {tables.map((t) => (
            <TableButton
              key={t.id}
              table={t}
              selected={t.tableName === selectedName}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
