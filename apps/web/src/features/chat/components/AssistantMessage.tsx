'use client';

import { useState } from 'react';
import {
  Sparkles, AlertCircle, Check, X,
  BarChart2, Table, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { chartColor } from '@/lib/chart-colors';
import { HelpCircle, Wrench, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SqlBlock } from './SqlBlock';
import { useChatStore } from '@/stores/chat.store';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { useExecuteSQL, useChooseInterpretation } from '../hooks/useChat';
import type { Message, QueryResult } from '../types';

interface Props {
  message: Message;
  conversationId: string;
  connectionId: string;
}

const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'hsl(var(--popover-foreground))',
};

export function AssistantMessage({ message, conversationId, connectionId }: Props) {
  const { messageResults, setEditedSQL, getEditedSQL } = useChatStore();
  const executeSQL = useExecuteSQL(conversationId);
  const { data: connections } = useConnections();
  const engine = connections?.find((c) => c.id === connectionId)?.engine;

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [currentPage, setCurrentPage] = useState(1);

  const queryResult: QueryResult | undefined = messageResults[message.id];
  const currentSQL = getEditedSQL(message.id, message.generatedSql ?? '');

  // Cannot answer
  if (!message.generatedSql && message.content.startsWith("I couldn't answer")) {
    return (
      <div className="flex gap-3 max-w-3xl">
        <Avatar />
        <div className="flex-1 bg-amber-500/5 border border-amber-500/20 rounded-2xl rounded-tl-sm p-4">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <p className="text-foreground/80">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  // Ambiguous question — show the candidate interpretations to choose from
  // (until the user picks one, which promotes it to a normal SQL message).
  if (!message.generatedSql && message.clarification?.options?.length) {
    return (
      <ClarificationPanel
        message={message}
        conversationId={conversationId}
      />
    );
  }

  // Plain text assistant message (e.g. a data-import summary — no SQL attached).
  if (!message.generatedSql) {
    return (
      <div className="flex gap-3 max-w-3xl">
        <Avatar />
        <div className="flex-1 bg-card border border-border rounded-2xl rounded-tl-sm p-4">
          <p className="text-sm text-foreground/85 whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  const handleStartEdit = () => {
    setEditValue(currentSQL);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    setEditedSQL(message.id, editValue);
    setIsEditing(false);
  };

  const handleExecute = async (page = 1) => {
    setCurrentPage(page);
    await executeSQL.mutateAsync({
      messageId: message.id,
      sql: currentSQL,
      connectionId,
      page,
      pageSize: 50,
    });
    setViewMode('table');
  };

  const handlePageChange = async (newPage: number) => {
    await handleExecute(newPage);
  };

  return (
    <div className="flex gap-3 max-w-4xl">
      <Avatar />
      <div className="flex-1 space-y-3 min-w-0">

        {/* Generated-SQL artifact card (premium). Editing swaps in an inline editor. */}
        {message.generatedSql && (
          isEditing ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-28px_rgba(91,79,247,0.28)]">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">EDITING SQL</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    className="flex items-center gap-1 rounded-lg bg-green-500/10 px-2.5 py-1 text-xs text-green-600 transition-colors hover:bg-green-500/20 dark:text-green-400"
                  >
                    <Check className="h-3 w-3" /> Save
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              </div>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={6}
                className="w-full resize-none bg-background px-4 py-3 font-mono text-sm text-foreground outline-none"
                autoFocus
              />
            </div>
          ) : (
            <SqlBlock
              sql={currentSQL}
              engine={engine}
              sourceTables={message.queryMeta?.tables ?? undefined}
              executionTimeMs={queryResult?.executionTimeMs}
              hasResult={!!queryResult}
              isRunning={executeSQL.isPending}
              onRun={() => void handleExecute(1)}
              onEdit={handleStartEdit}
            />
          )
        )}

        {/* Structured output: explanation, confidence, tables/columns touched */}
        {message.generatedSql && (message.sqlExplanation || message.queryMeta) && (
          <div className="rounded-xl border border-border bg-muted/20 p-3.5">
            {message.sqlExplanation && (
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white">
                  <Sparkles className="h-3 w-3" />
                </div>
                <p className="text-sm leading-relaxed text-foreground/85">{message.sqlExplanation}</p>
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              {typeof message.queryMeta?.confidence === 'number' && (
                <ConfidenceBadge value={message.queryMeta.confidence} />
              )}
              {message.queryMeta?.tables?.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70"
                >
                  <Table2 className="h-3 w-3 text-muted-foreground" />
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Execution error */}
        {executeSQL.isError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">
            {executeSQL.error instanceof Error
              ? executeSQL.error.message
              : 'Query execution failed'}
          </div>
        )}

        {/* Results */}
        {queryResult && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Results header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <span>
                  {queryResult.totalCount.toLocaleString()} row{queryResult.totalCount !== 1 ? 's' : ''}
                  {queryResult.totalPages > 1 && ` · page ${queryResult.page} of ${queryResult.totalPages}`}
                  <span className="ml-2 text-green-600 dark:text-green-400">· {queryResult.executionTimeMs}ms</span>
                </span>
                {queryResult.repaired && (
                  <span
                    title="The original query failed, so it was automatically corrected and re-run."
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-medium"
                  >
                    <Wrench className="w-3 h-3" /> Auto-corrected
                  </span>
                )}
              </span>

              {queryResult.chartConfig && queryResult.rows.length > 0 && (
                <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
                  {(['table', 'chart'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        viewMode === mode
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {mode === 'table'
                        ? <><Table className="w-3 h-3" /> Table</>
                        : <><BarChart2 className="w-3 h-3" /> Chart</>
                      }
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4">
              {viewMode === 'table' || !queryResult.chartConfig ? (
                <ResultsTable queryResult={queryResult} />
              ) : (
                <ResultsChartInline queryResult={queryResult} />
              )}
            </div>

            {/* Pagination */}
            {queryResult.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/10">
                <span className="text-xs text-muted-foreground">
                  Showing {((queryResult.page - 1) * queryResult.pageSize) + 1}–
                  {Math.min(queryResult.page * queryResult.pageSize, queryResult.totalCount)} of {queryResult.totalCount.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void handlePageChange(queryResult.page - 1)}
                    disabled={queryResult.page <= 1 || executeSQL.isPending}
                    className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs px-2">
                    {queryResult.page} / {queryResult.totalPages}
                  </span>
                  <button
                    onClick={() => void handlePageChange(queryResult.page + 1)}
                    disabled={queryResult.page >= queryResult.totalPages || executeSQL.isPending}
                    className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Insight */}
        {queryResult?.insightText && (
          <div className="bg-primary/5 border border-primary/10 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-foreground/90 leading-relaxed">
                {queryResult.insightText}
              </p>
            </div>
          </div>
        )}

        {/* Model info */}
        {message.latencyMs && (
          <p className="text-xs text-muted-foreground/60 px-1">
            {message.latencyMs}ms
          </p>
        )}
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const tone =
    value >= 80
      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
      : value >= 50
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-red-500/10 text-red-600 dark:text-red-400';
  return (
    <span
      title="Model's self-reported confidence that this query matches your question."
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium', tone)}
    >
      {value}% confidence
    </span>
  );
}

function ClarificationPanel({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string;
}) {
  const chooseInterpretation = useChooseInterpretation(conversationId);
  const clarification = message.clarification;
  if (!clarification) return null;

  return (
    <div className="flex gap-3 max-w-3xl">
      <Avatar />
      <div className="flex-1 bg-blue-500/5 border border-blue-500/20 rounded-2xl rounded-tl-sm p-4 space-y-3">
        <div className="flex items-start gap-2 text-sm">
          <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="text-foreground/90 font-medium">
              {clarification.clarify}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick the interpretation you meant — I&apos;ll load that query.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {clarification.options.map((opt, i) => (
            <button
              key={i}
              onClick={() =>
                void chooseInterpretation.mutateAsync({
                  messageId: message.id,
                  sql: opt.sql,
                })
              }
              disabled={chooseInterpretation.isPending}
              className={cn(
                'w-full text-left rounded-xl border border-border bg-card/50 p-3',
                'hover:border-blue-400/40 hover:bg-blue-500/5 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed group',
              )}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 text-xs font-semibold shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-foreground/90">
                  {opt.label}
                </span>
              </div>
              <code className="block text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all pl-7">
                {opt.sql}
              </code>
            </button>
          ))}
        </div>

        {chooseInterpretation.isError && (
          <p className="text-xs text-destructive">
            Couldn&apos;t load that interpretation. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-md shadow-[#5B4FF7]/25">
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

function ResultsTable({ queryResult }: { queryResult: QueryResult }) {
  if (queryResult.rows.length === 0) {
    return <p className="text-center text-muted-foreground text-sm py-4">No results</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {queryResult.fields.map((f) => (
              <th key={f.name} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {queryResult.rows.map((row, i) => (
            <tr key={i} className={cn('border-b border-border/40', i % 2 === 1 && 'bg-muted/10')}>
              {queryResult.fields.map((f) => (
                <td key={f.name} className="px-3 py-2 text-xs font-mono whitespace-nowrap max-w-[200px] truncate">
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
  );
}

function ResultsChartInline({ queryResult }: { queryResult: QueryResult }) {
  const cfg = queryResult.chartConfig;
  if (!cfg) return null;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        {cfg.type === 'line' ? (
          <LineChart data={queryResult.rows} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={cfg.xKey} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} angle={-30} textAnchor="end" />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={45} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey={cfg.yKey} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        ) : (
          <BarChart data={queryResult.rows} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={cfg.xKey} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} angle={-30} textAnchor="end" />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={45} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey={cfg.yKey} radius={[4, 4, 0, 0]}>
              {queryResult.rows.map((_, i) => (
                <Cell key={i} fill={chartColor(i)} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}