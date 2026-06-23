'use client';

import { useState, useRef, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send, Loader2, Upload, ClipboardPaste, Sheet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onSend: (message: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  onUploadFile?: (file: File) => void;
  onPasteTable?: () => void;
  onGoogleSheet?: () => void;
}

const EXAMPLE_QUESTIONS = [
  'How many users are in the database?',
  'Show me all tables and their row counts',
  'What are the most recent records?',
];

export function ChatInput({ onSend, isLoading, disabled, onUploadFile, onPasteTable, onGoogleSheet }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadFile) onUploadFile(file);
    // Reset so selecting the same file again re-triggers the change event.
    e.target.value = '';
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="space-y-3">
      {/* Example questions — shown when input is empty */}
      {!value && !isLoading && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => setValue(q)}
              className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:text-primary text-muted-foreground transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className={cn(
        'flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3',
        'focus-within:border-primary/50 transition-colors',
        disabled && 'opacity-50',
      )}>
        {onUploadFile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.tab,.json,.ndjson,.jsonl,.xml,.html,.htm,.md,.markdown,.sql,.xlsx,.xls,.ods,.gz,text/csv,text/tab-separated-values,application/json,application/xml,text/xml,text/html,text/markdown,application/sql,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,application/gzip"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || disabled}
              title="Import data from CSV, TSV, JSON, XML, HTML, Markdown, SQL, Excel, ODS, or gzipped files"
              className={cn(
                'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
                'border border-border text-muted-foreground',
                'hover:text-foreground hover:border-primary/50 transition-colors',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <Upload className="w-4 h-4" />
            </button>
          </>
        )}
        {onPasteTable && (
          <button
            type="button"
            onClick={onPasteTable}
            disabled={isLoading || disabled}
            title="Paste a table from Excel, Sheets, or a CSV"
            className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
              'border border-border text-muted-foreground',
              'hover:text-foreground hover:border-primary/50 transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <ClipboardPaste className="w-4 h-4" />
          </button>
        )}
        {onGoogleSheet && (
          <button
            type="button"
            onClick={onGoogleSheet}
            disabled={isLoading || disabled}
            title="Import from a Google Sheets link"
            className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
              'border border-border text-muted-foreground',
              'hover:text-foreground hover:border-primary/50 transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <Sheet className="w-4 h-4" />
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Ask anything about your data..."
          disabled={disabled || isLoading}
          rows={1}
          className={cn(
            'flex-1 bg-transparent resize-none outline-none text-sm',
            'outline-none focus:outline-none focus:ring-0 border-0',
            'placeholder:text-muted-foreground',
            'disabled:cursor-not-allowed',
            'max-h-[200px] leading-relaxed',
          )}
        />
        <span className="mr-1 hidden whitespace-nowrap text-[11px] text-muted-foreground sm:inline">
          ⌘ Enter to send
        </span>
        <button
          onClick={handleSend}
          disabled={!value.trim() || isLoading || disabled}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            'bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white',
            'shadow-md shadow-[#5B4FF7]/25 transition-all hover:shadow-lg hover:shadow-[#5B4FF7]/35',
            'disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed',
          )}
        >
          {isLoading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />
          }
        </button>
      </div>
      {/* <p className="text-xs text-muted-foreground text-center">
        Press Enter to send · Shift+Enter for new line
      </p> */}
    </div>
  );
}