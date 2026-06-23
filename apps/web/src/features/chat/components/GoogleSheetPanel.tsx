'use client';

import { useState } from 'react';
import { Sheet, X, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { parseCsv, type ParsedCsv } from '../lib/data-import';
import { useGoogleSheetImport } from '../hooks/useCsvImport';

interface Props {
  onCancel: () => void;
  onContinue: (parsed: ParsedCsv) => void;
}

export function GoogleSheetPanel({ onCancel, onContinue }: Props) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const importer = useGoogleSheetImport();

  const handleFetch = async () => {
    setError(null);
    try {
      const { csv } = await importer.mutateAsync(url.trim());
      const parsed = parseCsv(csv);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError('That sheet has no data rows to import.');
        return;
      }
      onContinue(parsed);
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message ??
          (err instanceof Error ? err.message : 'Could not fetch that sheet.'),
      );
    }
  };

  return (
    <div className="flex gap-3 max-w-4xl">
      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <Sheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
      </div>

      <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl rounded-tl-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <span className="text-sm font-medium">Import from Google Sheets</span>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim() && !importer.isPending) {
                void handleFetch();
              }
            }}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            autoFocus
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50 font-mono"
          />
          <p className="text-[11px] text-muted-foreground/70">
            The sheet must be shared as{' '}
            <span className="text-foreground/80">
              “Anyone with the link → Viewer.”
            </span>{' '}
            The first row is treated as the header.
          </p>

          {error && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
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
              onClick={() => void handleFetch()}
              disabled={!url.trim() || importer.isPending}
              className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {importer.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
              {importer.isPending ? 'Fetching…' : 'Fetch sheet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
