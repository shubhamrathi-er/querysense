'use client';

import { useState } from 'react';
import { ClipboardPaste, X, ArrowRight, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parseCsv,
  parseMarkdown,
  isLikelyMarkdownTable,
  type ParsedCsv,
} from '../lib/data-import';

function parsePastedTable(text: string): ParsedCsv {
  // A pasted Markdown table parses cleanly; otherwise treat as delimited text
  // (clipboard tables are tab-separated, CSV text is comma-separated).
  if (isLikelyMarkdownTable(text)) {
    try {
      return parseMarkdown(text);
    } catch {
      // fall through to delimited parsing
    }
  }
  return parseCsv(text);
}

interface Props {
  onCancel: () => void;
  onContinue: (parsed: ParsedCsv) => void;
}

export function PasteTablePanel({ onCancel, onContinue }: Props) {
  const [text, setText] = useState('');

  // Clipboard tables (Excel, Sheets, web tables) are tab-separated; CSV text is
  // comma-separated; a pasted Markdown table is detected too.
  const parsed: ParsedCsv | null = text.trim() ? parsePastedTable(text) : null;
  const valid = !!parsed && parsed.headers.length > 0 && parsed.rows.length > 0;
  const preview = parsed?.rows.slice(0, 3) ?? [];

  return (
    <div className="flex gap-3 max-w-4xl">
      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <ClipboardPaste className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
      </div>

      <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl rounded-tl-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <span className="text-sm font-medium">Paste a table</span>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste rows from Excel, Google Sheets, a CSV, or a Markdown table — the first row is treated as the header."
            rows={6}
            autoFocus
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary/50 resize-y"
          />

          {text.trim() &&
            (valid ? (
              <p className="text-xs text-muted-foreground">
                Detected {parsed!.rows.length.toLocaleString()} row
                {parsed!.rows.length !== 1 ? 's' : ''} ·{' '}
                {parsed!.headers.length} column
                {parsed!.headers.length !== 1 ? 's' : ''}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Couldn&apos;t detect a table — put each row on its own line, with
                columns separated by tabs or commas.
              </p>
            ))}

          {valid && preview.length > 0 && (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {parsed!.headers.map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        'border-b border-border/40',
                        i % 2 === 1 && 'bg-muted/10',
                      )}
                    >
                      {parsed!.headers.map((h) => (
                        <td
                          key={h}
                          className="px-3 py-1.5 font-mono whitespace-nowrap max-w-[180px] truncate"
                        >
                          {row[h] === null ? (
                            <span className="text-muted-foreground/50 italic">
                              ∅
                            </span>
                          ) : (
                            String(row[h])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => parsed && onContinue(parsed)}
              disabled={!valid}
              className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
