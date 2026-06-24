'use client';

import { useEffect, useState } from 'react';
import { useConversation, useGenerateSQL, useRecordImport } from '../hooks/useChat';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { engineLabel } from '@/features/connections/types';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useChatStore } from '@/stores/chat.store';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ConnectionSelector } from './ConnectionSelector';
import { DataImportWizard } from './DataImportWizard';
import { PasteTablePanel } from './PasteTablePanel';
import { GoogleSheetPanel } from './GoogleSheetPanel';
import { useToast } from '@/components/ui/toast';
import { StatusDot } from '@/components/ui/status-dot';
import { Database, AlertCircle } from 'lucide-react';
import {
  parseCsv,
  parseJson,
  parseXml,
  parseHtml,
  parseExcel,
  parseMarkdown,
  parseSqlDump,
  type ParsedCsv,
  type ParsedSheet,
} from '../lib/data-import';

type ImportFormat =
  | 'CSV'
  | 'TSV'
  | 'JSON'
  | 'XML'
  | 'HTML'
  | 'Excel'
  | 'ODS'
  | 'Markdown'
  | 'SQL'
  | 'Pasted'
  | 'Google Sheets';

/** Spreadsheet (binary, multi-sheet) formats read via SheetJS. */
function spreadsheetFormat(name: string, type: string): 'Excel' | 'ODS' | null {
  const n = name.toLowerCase();
  if (n.endsWith('.ods') || type.includes('opendocument.spreadsheet')) {
    return 'ODS';
  }
  if (
    n.endsWith('.xlsx') ||
    n.endsWith('.xls') ||
    n.endsWith('.xlsb') ||
    n.endsWith('.xlsm') ||
    type.includes('spreadsheetml') ||
    type === 'application/vnd.ms-excel'
  ) {
    return 'Excel';
  }
  return null;
}

/** Decompress a gzipped file to text using the native DecompressionStream. */
async function gunzipToText(file: File): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip decompression isn’t supported in this browser.');
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function detectFormat(
  name: string,
  type: string,
): {
  format: ImportFormat;
  parse: (text: string) => ParsedCsv;
} {
  const n = name.toLowerCase();
  if (n.endsWith('.json') || n.endsWith('.ndjson') || n.endsWith('.jsonl') || type === 'application/json') {
    return { format: 'JSON', parse: parseJson };
  }
  if (n.endsWith('.xml') || type === 'application/xml' || type === 'text/xml') {
    return { format: 'XML', parse: parseXml };
  }
  if (n.endsWith('.html') || n.endsWith('.htm') || type === 'text/html') {
    return { format: 'HTML', parse: parseHtml };
  }
  if (n.endsWith('.md') || n.endsWith('.markdown') || type === 'text/markdown') {
    return { format: 'Markdown', parse: parseMarkdown };
  }
  if (n.endsWith('.tsv') || n.endsWith('.tab')) {
    return { format: 'TSV', parse: (t) => parseCsv(t, '\t') };
  }
  // CSV (delimiter — comma/semicolon/pipe — is auto-detected by the parser).
  return { format: 'CSV', parse: parseCsv };
}
import type { Message } from '../types';

interface Props {
  conversationId: string;
}

export function ChatInterface({ conversationId }: Props) {
  const { currentWorkspace } = useWorkspaceStore();
  const { data: connections } = useConnections();
  const { data: conversation } = useConversation(conversationId);
  const { generate, isPending, cancel } = useGenerateSQL(conversationId);
  const recordImport = useRecordImport(conversationId);
  const toast = useToast();

  const {
    setConnectionForConversation,
    getConnectionForConversation,
  } = useChatStore();

  const activeConnections = connections?.filter((c) => c.status === 'ACTIVE') ?? [];
  const storedConnectionId = getConnectionForConversation(conversationId);
  const defaultConnectionId = activeConnections[0]?.id ?? '';
  const connectionId = storedConnectionId ?? defaultConnectionId;

  useEffect(() => {
    if (!storedConnectionId && defaultConnectionId) {
      setConnectionForConversation(conversationId, defaultConnectionId);
    }
  }, [defaultConnectionId, storedConnectionId, conversationId, setConnectionForConversation]);

  const selectedConnection = connections?.find((c) => c.id === connectionId);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [csvUpload, setCsvUpload] = useState<{
    fileName: string;
    parsed: ParsedCsv;
    format: ImportFormat;
    sheets?: ParsedSheet[];
    activeSheet?: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [gsheet, setGsheet] = useState(false);

  const handleUploadFile = async (file: File) => {
    setUploadError(null);
    try {
      // Transparently gunzip .gz files, then treat them by their inner extension.
      const gz = file.name.toLowerCase().endsWith('.gz');
      const innerName = gz ? file.name.replace(/\.gz$/i, '') : file.name;
      const effectiveType = gz ? '' : file.type;

      // Spreadsheets (Excel/ODS) are binary, multi-sheet, and read via SheetJS.
      const sheetFmt = spreadsheetFormat(innerName, effectiveType);
      if (sheetFmt) {
        if (gz) {
          setUploadError(
            'Gzipped spreadsheets aren’t supported — upload the file directly.',
          );
          return;
        }
        const sheets = await parseExcel(await file.arrayBuffer());
        const first = sheets[0];
        setCsvUpload({
          fileName: file.name,
          format: sheetFmt,
          parsed: first.parsed,
          sheets,
          activeSheet: first.name,
        });
        return;
      }

      // Text formats (optionally gzipped).
      const text = gz ? await gunzipToText(file) : await file.text();

      // A SQL dump can contain several tables — surface each like a sheet.
      if (innerName.toLowerCase().endsWith('.sql')) {
        const sheets = parseSqlDump(text);
        const first = sheets[0];
        setCsvUpload({
          fileName: file.name,
          format: 'SQL',
          parsed: first.parsed,
          sheets,
          activeSheet: first.name,
        });
        return;
      }

      const { format, parse } = detectFormat(innerName, effectiveType);
      const parsed = parse(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        const msg = `That ${format} file has no data rows to import.`;
        setUploadError(msg);
        toast.error(msg);
        return;
      }
      setCsvUpload({ fileName: file.name, parsed, format });
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Could not parse file: ${err.message}`
          : 'Could not read that file.';
      setUploadError(msg);
      toast.error(msg);
    }
  };

  const allMessages: Message[] = [
    ...(conversation?.messages ?? []),
    ...optimisticMessages,
  ];

  const handleSend = async (content: string) => {
    if (!connectionId) return;

    // Add optimistic user message
    const tempId = `temp-${Date.now()}`;
    setOptimisticMessages([{
      id: tempId,
      conversationId,
      role: 'USER',
      content,
      generatedSql: null,
      sqlExplanation: null,
      chartConfig: null,
      clarification: null,
      insightText: null,
      tokensUsed: null,
      modelUsed: null,
      latencyMs: null,
      createdAt: new Date().toISOString(),
    }]);

    try {
      await generate(content, connectionId);
    } finally {
      setOptimisticMessages([]);
    }
  };

  if (!connections || connections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto">
            <Database className="w-6 h-6 text-blue-500" />
          </div>
          <h3 className="font-semibold">No database connected</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            Add a connection in the Connections page first.
          </p>
        </div>
      </div>
    );
  }

  if (activeConnections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h3 className="font-semibold">No active connection</h3>
          <p className="text-sm text-muted-foreground">
            Go to Connections and sync your schema first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Connection bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-2.5">
        <div className="flex items-center gap-2">
          <StatusDot tone="green" size={8} />
          <span className="text-sm font-medium text-foreground">
            {selectedConnection?.name ?? 'Connected'}
          </span>
          <span className="text-xs text-muted-foreground">· {engineLabel(selectedConnection?.engine)}</span>
        </div>
        <ConnectionSelector
          selectedId={connectionId}
          onSelect={(id) => setConnectionForConversation(conversationId, id)}
        />
      </div>

      {/* Messages + Progress */}
      <MessageList
        messages={allMessages}
        isLoading={isPending}
        conversationId={conversationId}
        connectionId={connectionId}
        extra={
          csvUpload ? (
            <DataImportWizard
              key={
                csvUpload.fileName +
                (csvUpload.activeSheet ?? '') +
                csvUpload.parsed.rows.length
              }
              fileName={csvUpload.fileName}
              format={csvUpload.format}
              parsed={csvUpload.parsed}
              sheets={csvUpload.sheets?.map((s) => s.name)}
              activeSheet={csvUpload.activeSheet}
              onSheetChange={(name) => {
                const sheet = csvUpload.sheets?.find((s) => s.name === name);
                if (sheet) {
                  setCsvUpload({
                    ...csvUpload,
                    activeSheet: name,
                    parsed: sheet.parsed,
                  });
                }
              }}
              connectionId={connectionId}
              onClose={() => setCsvUpload(null)}
              onImported={(info) => {
                const r = info.result;
                const src =
                  info.sheet && info.sheet !== info.fileName
                    ? `${info.fileName} · ${info.sheet}`
                    : info.fileName;
                const plural = (n: number) => (n === 1 ? '' : 's');
                const parts = [
                  r.tableCreated
                    ? `Created table \`${r.tableName}\` and inserted ${r.rowsInserted.toLocaleString()} row${plural(r.rowsInserted)}.`
                    : `Inserted ${r.rowsInserted.toLocaleString()} row${plural(r.rowsInserted)} into \`${r.tableName}\`.`,
                ];
                if (r.rowsSkipped > 0)
                  parts.push(
                    `${r.rowsSkipped.toLocaleString()} duplicate row${plural(r.rowsSkipped)} skipped.`,
                  );
                if (r.columnsAdded.length > 0)
                  parts.push(
                    `Added column${plural(r.columnsAdded.length)}: ${r.columnsAdded.join(', ')}.`,
                  );
                if (info.context?.description)
                  parts.push(`Filtered to rows where ${info.context.description}.`);
                const userContent = info.context?.instruction
                  ? `Imported ${info.format}: "${src}" — ${info.context.instruction}`
                  : `Imported ${info.format}: "${src}"`;
                recordImport.mutate({
                  userContent,
                  assistantContent: parts.join(' '),
                });
                toast.success(parts.join(' '), 'Import complete');
              }}
            />
          ) : pasting ? (
            <PasteTablePanel
              onCancel={() => setPasting(false)}
              onContinue={(parsed) => {
                setCsvUpload({
                  fileName: 'Pasted data',
                  format: 'Pasted',
                  parsed,
                });
                setPasting(false);
              }}
            />
          ) : gsheet ? (
            <GoogleSheetPanel
              onCancel={() => setGsheet(false)}
              onContinue={(parsed) => {
                setCsvUpload({
                  fileName: 'Google Sheet',
                  format: 'Google Sheets',
                  parsed,
                });
                setGsheet(false);
              }}
            />
          ) : null
        }
      />

      {/* Input */}
      <div className="px-6 pb-6 pt-3 border-t border-border bg-background/50">
        {uploadError && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-2 px-1">{uploadError}</p>
        )}
        <ChatInput
          onSend={(msg) => void handleSend(msg)}
          isLoading={isPending}
          onUploadFile={(file) => void handleUploadFile(file)}
          onPasteTable={() => setPasting(true)}
          onGoogleSheet={() => setGsheet(true)}
        />
      </div>
    </div>
  );
}