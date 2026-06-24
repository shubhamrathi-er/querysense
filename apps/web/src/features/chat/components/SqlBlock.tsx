'use client';

import { useState, memo } from 'react';
import { useTheme } from 'next-themes';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  vscDarkPlus,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Database, ChevronDown, Copy, Check, CheckCircle2, Clock,
  Table2, Play, Pencil, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { engineLabel, type DatabaseEngine } from '@/features/connections/types';

interface Props {
  sql: string;
  engine?: DatabaseEngine;
  /** Source tables the query reads from (for the metadata bar). */
  sourceTables?: string[];
  /** Actual execution time once the query has run. */
  executionTimeMs?: number;
  /** Whether the query has already been executed (shows results elsewhere). */
  hasResult?: boolean;
  isRunning?: boolean;
  onRun?: () => void;
  onEdit?: () => void;
}

/**
 * Premium "Generated SQL" artifact card: header + line-numbered syntax editor +
 * metadata pills + action bar. Self-contained (its own border/rounded surface).
 */
export function SqlBlock({
  sql,
  engine,
  sourceTables,
  executionTimeMs,
  hasResult,
  isRunning,
  onRun,
  onEdit,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-28px_rgba(91,79,247,0.28)]',
      )}
    >
      <SqlHeader
        engine={engine}
        expanded={expanded}
        copied={copied}
        onToggle={() => setExpanded((v) => !v)}
        onCopy={() => void handleCopy()}
      />

      <SqlEditor sql={sql} expanded={expanded} isDark={isDark} />

      <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <SqlMetadata
          hasResult={hasResult}
          executionTimeMs={executionTimeMs}
          sourceTables={sourceTables}
        />
        <SqlActions
          hasResult={hasResult}
          isRunning={isRunning}
          onRun={onRun}
          onEdit={onEdit}
        />
      </div>
    </motion.div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function SqlHeader({
  engine, expanded, copied, onToggle, onCopy,
}: {
  engine?: DatabaseEngine;
  expanded: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-sm shadow-[#5B4FF7]/30">
          <Database className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Generated SQL</span>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {engineLabel(engine)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span key="c" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Copied
              </motion.span>
            ) : (
              <motion.span key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                <Copy className="h-3.5 w-3.5" /> Copy
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        <button
          onClick={onToggle}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <motion.span animate={{ rotate: expanded ? 0 : -90 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>
      </div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

// Memoised so parent re-renders (copy/run state) never re-tokenise the SQL —
// re-tokenising mid-layout was the source of the expand flicker.
const HighlightedSql = memo(function HighlightedSql({ sql, isDark }: { sql: string; isDark: boolean }) {
  return (
    <SyntaxHighlighter
      language="sql"
      style={isDark ? vscDarkPlus : oneLight}
      showLineNumbers
      wrapLongLines
      customStyle={{
        margin: 0,
        borderRadius: 0,
        background: 'transparent',
        fontSize: '0.8rem',
        padding: '0.9rem 0.75rem',
      }}
      lineNumberStyle={{
        minWidth: '2.25em',
        paddingRight: '1em',
        textAlign: 'right',
        color: isDark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.5)',
        userSelect: 'none',
      }}
      codeTagProps={{
        style: { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' },
      }}
    >
      {sql}
    </SyntaxHighlighter>
  );
});

function SqlEditor({ sql, expanded, isDark }: { sql: string; expanded: boolean; isDark: boolean }) {
  const codeBg = isDark ? 'hsl(224 71.4% 4.1%)' : 'hsl(220 20% 97.5%)';
  const previewLines = sql.split('\n').filter((l) => l.trim()).slice(0, 3).join('\n');

  // Opacity-only crossfade — no height animation, so no layout reflow/flicker.
  return (
    <div className="px-3 pb-3">
      <div
        className="relative overflow-hidden rounded-xl border border-border/60"
        style={{ background: codeBg }}
      >
        {expanded ? (
          <motion.div
            key="full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            <HighlightedSql sql={sql} isDark={isDark} />
          </motion.div>
        ) : (
          <div className="relative">
            <pre className="max-h-[3.75rem] overflow-hidden px-3.5 py-2.5 font-mono text-xs leading-5 text-foreground/75">
              {previewLines}
            </pre>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t to-transparent"
              style={{ ['--tw-gradient-from' as string]: codeBg, backgroundImage: `linear-gradient(to top, ${codeBg}, transparent)` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Metadata pills ───────────────────────────────────────────────────────────

function Pill({ icon, children, tone = 'default' }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'success' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'success'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function SqlMetadata({
  hasResult, executionTimeMs, sourceTables,
}: {
  hasResult?: boolean;
  executionTimeMs?: number;
  sourceTables?: string[];
}) {
  const tables = (sourceTables ?? []).slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hasResult && typeof executionTimeMs === 'number' ? (
        <Pill icon={<Clock className="h-3 w-3" />} tone="success">
          Ran in {executionTimeMs}ms
        </Pill>
      ) : (
        <Pill icon={<CheckCircle2 className="h-3 w-3" />} tone="success">
          Ready to execute
        </Pill>
      )}
      {tables.map((t) => (
        <Pill key={t} icon={<Table2 className="h-3 w-3" />}>{t}</Pill>
      ))}
    </div>
  );
}

// ── Actions ──────────────────────────────────────────────────────────────────

function SqlActions({
  hasResult, isRunning, onRun, onEdit,
}: {
  hasResult?: boolean;
  isRunning?: boolean;
  onRun?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {onEdit && (
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" /> {hasResult ? 'Edit & re-run' : 'Edit SQL'}
        </button>
      )}
      {onRun && (
        <motion.button
          onClick={onRun}
          disabled={isRunning}
          whileHover={{ scale: isRunning ? 1 : 1.03 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-shadow hover:shadow-[0_8px_22px_-6px_rgba(91,79,247,0.55)] disabled:opacity-60"
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
          {isRunning ? 'Running…' : hasResult ? 'Re-run' : 'Run Query'}
        </motion.button>
      )}
    </div>
  );
}
