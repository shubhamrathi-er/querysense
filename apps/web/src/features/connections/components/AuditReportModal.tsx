'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, ShieldCheck, AlertTriangle, AlertCircle, Info, Loader2,
  Sparkles, Copy, Check, ClipboardCopy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { useAudit } from '../hooks/useConnections';
import type { AuditFinding, AuditReport, AuditSeverity } from '../types';

interface Props {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
}

const SEVERITY: Record<
  AuditSeverity,
  { label: string; color: string; bg: string; icon: typeof AlertTriangle }
> = {
  high: { label: 'High', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', icon: AlertTriangle },
  medium: { label: 'Medium', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', icon: AlertCircle },
  low: { label: 'Low', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', icon: AlertCircle },
  info: { label: 'Info', color: 'text-muted-foreground', bg: 'bg-muted/30', icon: Info },
};

const scoreColor = (s: number) =>
  s >= 85 ? 'text-green-600 dark:text-green-400' : s >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
const scoreLabel = (s: number) =>
  s >= 85 ? 'Healthy' : s >= 60 ? 'Needs attention' : 'At risk';

export function AuditReportModal({ connectionId, connectionName, onClose }: Props) {
  const audit = useAudit(connectionId);
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  // Run once on open.
  useEffect(() => {
    audit.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const report = audit.data;

  const grouped = useMemo(() => {
    const order: AuditSeverity[] = ['high', 'medium', 'low', 'info'];
    const map: Record<AuditSeverity, AuditFinding[]> = { high: [], medium: [], low: [], info: [] };
    for (const f of report?.findings ?? []) map[f.severity].push(f);
    return order.map((sev) => ({ sev, items: map[sev] })).filter((g) => g.items.length);
  }, [report]);

  const copyMarkdown = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(toMarkdown(connectionName, report));
    setCopied(true);
    toast.success('Audit report copied to clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Schema Health Audit</h2>
            <span className="text-xs text-muted-foreground">· {connectionName}</span>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <button
                onClick={() => void copyMarkdown()}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy report'}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {audit.isPending && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Scanning schema & checking best practices…</p>
            </div>
          )}

          {audit.isError && (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm text-muted-foreground">
                {(audit.error as { response?: { data?: { message?: string } } })?.response?.data
                  ?.message ?? 'Audit failed. Make sure the connection is reachable.'}
              </p>
              <button
                onClick={() => audit.mutate()}
                className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
              >
                Retry
              </button>
            </div>
          )}

          {report && (
            <div className="p-6 space-y-6">
              {/* Score + summary */}
              <div className="flex items-center gap-6">
                <div className="text-center shrink-0">
                  <div className={cn('text-5xl font-bold', scoreColor(report.score))}>
                    {report.score}
                  </div>
                  <div className="text-[11px] text-muted-foreground">/ 100</div>
                  <div className={cn('text-xs font-medium mt-1', scoreColor(report.score))}>
                    {scoreLabel(report.score)}
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <Stat label="Tables" value={report.summary.tables} />
                  <Stat label="Columns" value={report.summary.columns} />
                  <Stat label="Findings" value={report.findings.length} />
                  <Stat label="High" value={report.summary.high} tone="text-red-600 dark:text-red-400" />
                  <Stat label="Medium" value={report.summary.medium} tone="text-amber-600 dark:text-amber-400" />
                  <Stat label="Low / Info" value={report.summary.low + report.summary.info} tone="text-blue-600 dark:text-blue-400" />
                </div>
              </div>

              {report.findings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <ShieldCheck className="w-10 h-10 text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium">No issues found — nice schema!</p>
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.sev} className="space-y-2">
                    <h3 className={cn('text-xs font-semibold uppercase', SEVERITY[group.sev].color)}>
                      {SEVERITY[group.sev].label} · {group.items.length}
                    </h3>
                    <div className="space-y-2">
                      {group.items.map((f) => (
                        <FindingCard key={f.id} finding={f} />
                      ))}
                    </div>
                  </div>
                ))
              )}

              <p className="text-[11px] text-muted-foreground/60 pt-2">
                Audited {new Date(report.generatedAt).toLocaleString()}. Heuristic checks —
                review each recommendation before applying.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-muted/20 border border-border rounded-lg px-3 py-2">
      <div className={cn('text-lg font-semibold', tone)}>{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

function FindingCard({ finding }: { finding: AuditFinding }) {
  const sev = SEVERITY[finding.severity];
  const Icon = sev.icon;
  const [copied, setCopied] = useState(false);

  const copyFix = async () => {
    if (!finding.fixSql) return;
    await navigator.clipboard.writeText(finding.fixSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-start gap-2.5">
        <div className={cn('w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5', sev.bg)}>
          <Icon className={cn('w-3.5 h-3.5', sev.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{finding.title}</span>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {finding.category}
            </span>
            {finding.aiGenerated && (
              <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                <Sparkles className="w-2.5 h-2.5" /> AI
              </span>
            )}
            {finding.table && (
              <span className="text-[11px] font-mono text-muted-foreground">
                {finding.table}
                {finding.column ? `.${finding.column}` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{finding.detail}</p>
          <p className="text-xs text-foreground/80 mt-1.5">
            <span className="text-muted-foreground">Fix: </span>
            {finding.recommendation}
          </p>
          {finding.fixSql && (
            <div className="mt-2 relative group">
              <pre className="bg-background border border-border rounded-lg p-2.5 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
                {finding.fixSql}
              </pre>
              <button
                onClick={() => void copyFix()}
                className="absolute top-1.5 right-1.5 p-1 rounded bg-card border border-border text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {copied ? <Check className="w-3 h-3 text-green-600 dark:text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function toMarkdown(name: string, report: AuditReport): string {
  const lines: string[] = [
    `# Schema Health Audit — ${name}`,
    '',
    `**Score:** ${report.score}/100 (${scoreLabel(report.score)})`,
    `**Tables:** ${report.summary.tables} · **Columns:** ${report.summary.columns} · **Findings:** ${report.findings.length}`,
    `High: ${report.summary.high} · Medium: ${report.summary.medium} · Low: ${report.summary.low} · Info: ${report.summary.info}`,
    '',
  ];
  for (const f of report.findings) {
    lines.push(
      `## [${f.severity.toUpperCase()}] ${f.title}${f.aiGenerated ? ' (AI)' : ''}`,
      `- **Category:** ${f.category}`,
    );
    if (f.table) lines.push(`- **Object:** ${f.table}${f.column ? `.${f.column}` : ''}`);
    lines.push(`- ${f.detail}`, `- **Recommendation:** ${f.recommendation}`);
    if (f.fixSql) lines.push('', '```sql', f.fixSql, '```');
    lines.push('');
  }
  return lines.join('\n');
}
