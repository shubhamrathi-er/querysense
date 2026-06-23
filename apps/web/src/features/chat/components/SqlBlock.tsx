'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  sql: string;
  executionTimeMs?: number;
}

export function SqlBlock({ sql, executionTimeMs }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-primary font-semibold">SQL</span>
          {executionTimeMs !== undefined && (
            <span className="text-xs text-muted-foreground">
              · {executionTimeMs}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              void handleCopy();
            }}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            }
          </button>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </div>
      </div>

      {/* SQL content */}
      {expanded && (
        <div className="text-sm">
          <SyntaxHighlighter
            language="sql"
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              background: 'hsl(224 71.4% 4.1%)',
              fontSize: '0.8rem',
              padding: '1rem',
            }}
          >
            {sql}
          </SyntaxHighlighter>
        </div>
      )}

      {/* Collapsed preview */}
      {!expanded && (
        <div className="px-4 py-2 bg-background">
          <p className="text-xs font-mono text-muted-foreground truncate">
            {sql.replace(/\s+/g, ' ').trim()}
          </p>
        </div>
      )}
    </div>
  );
}