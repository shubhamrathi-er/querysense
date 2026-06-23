// Lightweight, dependency-free parsers (CSV/TSV, JSON/NDJSON, XML, HTML) plus
// type inference for the in-chat data-import flow. Everything runs client-side
// so we can show a preview and an inferred schema before touching the database.

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string | null>[];
}

/**
 * Canonical column types the backend accepts when creating a new table. These
 * are engine-agnostic tokens: the API maps them to the target engine's real
 * type (e.g. DOUBLE→DOUBLE PRECISION, DATETIME→TIMESTAMP on PostgreSQL).
 */
export const NEW_TABLE_TYPES = [
  'INT',
  'BIGINT',
  'DOUBLE',
  'DECIMAL(18,4)',
  'VARCHAR(255)',
  'TEXT',
  'DATE',
  'DATETIME',
  'BOOLEAN',
] as const;

export type NewTableType = (typeof NEW_TABLE_TYPES)[number];

/** Human-friendly labels for the type picker (values stay canonical). */
export const NEW_TABLE_TYPE_LABELS: Record<NewTableType, string> = {
  INT: 'Whole number',
  BIGINT: 'Whole number (large)',
  DOUBLE: 'Decimal (approximate)',
  'DECIMAL(18,4)': 'Decimal (exact)',
  'VARCHAR(255)': 'Text (short)',
  TEXT: 'Text (long)',
  DATE: 'Date',
  DATETIME: 'Date & time',
  BOOLEAN: 'Yes / No',
};

const DELIMITER_CANDIDATES = [',', '\t', ';', '|'];

/** Pick the delimiter that appears most on the header line, ignoring quotes. */
function detectDelimiter(text: string): string {
  const firstLine =
    text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITER_CANDIDATES) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * RFC-4180-ish delimited parser. Handles quoted fields, embedded
 * delimiters/newlines and escaped double-quotes (""). The delimiter is
 * auto-detected (comma, tab, semicolon, pipe) unless one is passed in.
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  // Strip a UTF-8 BOM if present.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = delimiter ?? detectDelimiter(input);

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delim) {
      record.push(field);
      field = '';
    } else if (char === '\r') {
      // Swallow — handled by the following \n (or treated as line end).
      if (input[i + 1] !== '\n') {
        record.push(field);
        records.push(record);
        field = '';
        record = [];
      }
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else {
      field += char;
    }
  }

  // Flush the trailing field/record if the file doesn't end with a newline.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((h, idx) => h.trim() || `column_${idx + 1}`);
  const rows: Record<string, string | null>[] = [];

  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    // Skip fully-empty lines.
    if (cells.length === 1 && cells[0].trim() === '') continue;

    const row: Record<string, string | null> = {};
    headers.forEach((header, idx) => {
      const value = cells[idx];
      row[header] = value === undefined || value === '' ? null : value;
    });
    rows.push(row);
  }

  return { headers, rows };
}

// ── JSON / NDJSON ────────────────────────────────────────────

/** Serialize a JSON value into the string|null cell shape the pipeline expects. */
function serializeJsonValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Nested objects/arrays are stored as JSON text.
  return JSON.stringify(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Pull the record array out of whatever top-level JSON shape we were given. */
function extractRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;

  if (isPlainObject(parsed)) {
    // A wrapper like { data: [...] } / { rows: [...] } / { results: [...] }.
    const arrayProps = Object.values(parsed).filter(
      (v): v is unknown[] => Array.isArray(v) && v.every(isPlainObject),
    );
    if (arrayProps.length === 1) return arrayProps[0];
    // Otherwise treat the object itself as a single record.
    return [parsed];
  }

  throw new Error('Expected a JSON array of objects, or an object.');
}

function recordsToParsed(records: unknown[]): ParsedCsv {
  if (records.length === 0) return { headers: [], rows: [] };

  // Headers = union of all keys, in first-seen order (objects may differ).
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    if (!isPlainObject(rec)) {
      throw new Error('Every JSON entry must be an object.');
    }
    for (const key of Object.keys(rec)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const rows = records.map((rec) => {
    const obj = rec as Record<string, unknown>;
    const row: Record<string, string | null> = {};
    for (const h of headers) row[h] = serializeJsonValue(obj[h]);
    return row;
  });

  return { headers, rows };
}

/**
 * Parse a JSON document or NDJSON / JSON Lines (one object per line) into the
 * same { headers, rows } shape as the CSV parser.
 */
export function parseJson(text: string): ParsedCsv {
  const trimmed = text.trim();
  if (!trimmed) return { headers: [], rows: [] };

  let records: unknown[];
  try {
    records = extractRecords(JSON.parse(trimmed));
  } catch {
    // Fall back to NDJSON / JSON Lines: one JSON value per line.
    records = [];
    for (const line of trimmed.split('\n')) {
      const l = line.trim().replace(/,\s*$/, ''); // tolerate trailing commas
      if (!l) continue;
      try {
        records.push(JSON.parse(l));
      } catch {
        throw new Error('File is not valid JSON or NDJSON.');
      }
    }
  }

  return recordsToParsed(records);
}

// Build { headers, rows } from already-stringified records (XML/HTML).
function fromRecords(
  records: Record<string, string | null>[],
): ParsedCsv {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const rows = records
    .map((rec) => {
      const row: Record<string, string | null> = {};
      for (const h of headers) {
        const v = rec[h];
        row[h] = v === undefined || v === null || v === '' ? null : v;
      }
      return row;
    })
    // Drop fully-empty rows.
    .filter((row) => headers.some((h) => row[h] !== null));

  return { headers, rows };
}

// ── XML ──────────────────────────────────────────────────────

/**
 * Parse XML by finding the largest set of same-tag sibling elements and
 * treating each as a row; its attributes and child elements become columns.
 */
export function parseXml(text: string): ParsedCsv {
  if (typeof DOMParser === 'undefined') {
    throw new Error('XML parsing is only available in the browser.');
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('File is not valid XML.');
  }
  const root = doc.documentElement;
  if (!root) throw new Error('XML has no root element.');

  // Find the biggest group of same-named sibling elements anywhere in the tree.
  let rowEls: Element[] = [];
  const visit = (el: Element) => {
    const groups = new Map<string, Element[]>();
    for (const child of Array.from(el.children)) {
      const g = groups.get(child.tagName) ?? [];
      g.push(child);
      groups.set(child.tagName, g);
    }
    for (const g of groups.values()) {
      if (g.length > rowEls.length) rowEls = g;
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);

  // Single-record fallback: no repeated siblings → the root's children are one row.
  if (rowEls.length === 0) rowEls = [root];

  const records = rowEls.map((rowEl) => {
    const rec: Record<string, string | null> = {};
    for (const attr of Array.from(rowEl.attributes)) {
      rec[attr.name] = attr.value;
    }
    const children = Array.from(rowEl.children);
    if (children.length === 0) {
      rec[rowEl.tagName] = rowEl.textContent?.trim() ?? null;
    } else {
      for (const child of children) {
        rec[child.tagName] = child.textContent?.trim() ?? null;
      }
    }
    return rec;
  });

  return fromRecords(records);
}

// ── HTML ─────────────────────────────────────────────────────

const spanOf = (cell: Element, attr: string): number => {
  const n = parseInt(cell.getAttribute(attr) ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * Expand a list of <tr> into a dense string grid, honouring colspan (repeat the
 * value across columns) and rowspan (carry the value down into later rows).
 */
function tableToGrid(trs: Element[]): string[][] {
  const grid: string[][] = [];
  // col index -> value still spilling down from a rowspan above.
  const carry = new Map<number, { value: string; remaining: number }>();

  for (let r = 0; r < trs.length; r++) {
    const row: string[] = grid[r] ?? [];
    grid[r] = row;
    const cells = Array.from(trs[r].children).filter(
      (c) => c.tagName === 'TD' || c.tagName === 'TH',
    );

    let col = 0;
    let ci = 0;
    while (ci < cells.length || carry.get(col)?.remaining) {
      const carried = carry.get(col);
      if (carried && carried.remaining > 0) {
        row[col] = carried.value;
        carried.remaining -= 1;
        if (carried.remaining === 0) carry.delete(col);
        col += 1;
        continue;
      }
      if (ci >= cells.length) break;

      const cell = cells[ci++];
      const value = cell.textContent?.trim() ?? '';
      const colspan = spanOf(cell, 'colspan');
      const rowspan = spanOf(cell, 'rowspan');
      for (let c = 0; c < colspan; c++) {
        row[col] = value;
        if (rowspan > 1) {
          carry.set(col, { value, remaining: rowspan - 1 });
        }
        col += 1;
      }
    }
  }
  return grid;
}

/** Parse the largest <table> in an HTML document into { headers, rows }. */
export function parseHtml(text: string): ParsedCsv {
  if (typeof DOMParser === 'undefined') {
    throw new Error('HTML parsing is only available in the browser.');
  }
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  if (tables.length === 0) throw new Error('No <table> found in the HTML.');

  // The data table is almost always the one with the most rows.
  const table = tables.reduce((a, b) =>
    b.querySelectorAll('tr').length > a.querySelectorAll('tr').length ? b : a,
  );
  const trs = Array.from(table.querySelectorAll('tr'));
  if (trs.length === 0) throw new Error('The HTML table has no rows.');

  const grid = tableToGrid(trs);
  // First row is the header (matches CSV semantics, covers thead and plain tables).
  const headerCells = grid[0] ?? [];
  const headers = headerCells.map((h, i) =>
    h && h.trim() ? h.trim() : `column_${i + 1}`,
  );

  const records = grid.slice(1).map((cells) => {
    const rec: Record<string, string | null> = {};
    headers.forEach((h, i) => {
      rec[h] = cells[i] ?? null;
    });
    return rec;
  });

  return fromRecords(records);
}

// ── Markdown tables ──────────────────────────────────────────

/** Split a Markdown table row into cells, honouring escaped pipes (\|). */
function splitMarkdownRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

/** A separator row is all cells like ---, :---, :---:, ---:. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/** True if the text contains a GitHub-flavoured Markdown table. */
export function isLikelyMarkdownTable(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|')) continue;
    if (isSeparatorRow(splitMarkdownRow(lines[i + 1]))) return true;
  }
  return false;
}

/** Parse the first GitHub-flavoured Markdown table into { headers, rows }. */
export function parseMarkdown(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/);

  let headerIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|')) continue;
    if (isSeparatorRow(splitMarkdownRow(lines[i + 1]))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error('No Markdown table found.');

  const headers = splitMarkdownRow(lines[headerIdx]).map(
    (h, i) => h || `column_${i + 1}`,
  );

  const records: Record<string, string | null>[] = [];
  for (let r = headerIdx + 2; r < lines.length; r++) {
    const line = lines[r];
    // The table ends at a blank line or a line with no pipe.
    if (line.trim() === '' || !line.includes('|')) break;
    const cells = splitMarkdownRow(line);
    const rec: Record<string, string | null> = {};
    headers.forEach((h, i) => {
      rec[h] = cells[i] ?? null;
    });
    records.push(rec);
  }

  return fromRecords(records);
}

// ── Excel (.xlsx / .xls) ─────────────────────────────────────

export interface ParsedSheet {
  name: string;
  parsed: ParsedCsv;
}

/** Turn an array-of-arrays (from a sheet) into { headers, rows }. */
function aoaToParsed(aoa: unknown[][]): ParsedCsv {
  if (!aoa || aoa.length === 0) return { headers: [], rows: [] };

  const isBlank = (c: unknown) =>
    c === null || c === undefined || String(c).trim() === '';

  // First row containing any value is the header row.
  let h = 0;
  while (h < aoa.length && (aoa[h] ?? []).every(isBlank)) h++;
  if (h >= aoa.length) return { headers: [], rows: [] };

  const headers = (aoa[h] ?? []).map((c, i) => {
    const s = isBlank(c) ? '' : String(c).trim();
    return s || `column_${i + 1}`;
  });

  const records = aoa.slice(h + 1).map((rowArr) => {
    const rec: Record<string, string | null> = {};
    headers.forEach((header, i) => {
      const v = (rowArr ?? [])[i];
      rec[header] = isBlank(v) ? null : String(v);
    });
    return rec;
  });

  return fromRecords(records);
}

/**
 * Parse an Excel workbook into one ParsedCsv per non-empty sheet. SheetJS is
 * loaded on demand so it never weighs down the main bundle.
 */
export async function parseExcel(buffer: ArrayBuffer): Promise<ParsedSheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });

  const sheets: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    // raw:false → use the cell's displayed text, matching our string pipeline.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      defval: null,
      raw: false,
    });
    const parsed = aoaToParsed(aoa);
    if (parsed.headers.length > 0 && parsed.rows.length > 0) {
      sheets.push({ name, parsed });
    }
  }

  if (sheets.length === 0) {
    throw new Error('No sheets with data found in the workbook.');
  }
  return sheets;
}

// ── SQL dump (.sql) ──────────────────────────────────────────
// We extract data only: INSERT statements (and CREATE TABLE for column names).
// No SQL is executed — values flow into the same safe, mapped, atomic insert.

const stripIdent = (s: string): string => {
  const cleaned = s.trim().replace(/[`"]/g, '');
  return cleaned.includes('.') ? cleaned.split('.').pop()! : cleaned;
};

// A (optionally db-qualified) table reference: `t`, "t", t, `db`.`t`, db.t …
const TABLE_REF =
  '(?:`[^`]+`|"[^"]+"|[A-Za-z0-9_$]+)(?:\\s*\\.\\s*(?:`[^`]+`|"[^"]+"|[A-Za-z0-9_$]+))?';

/** Split SQL into statements, ignoring comments and quoted/backticked text. */
function splitSqlStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = '';
  let inStr = false;
  let q = '';
  let inBacktick = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const nx = sql[i + 1];

    if (inStr) {
      if (c === '\\') {
        cur += c + (nx ?? '');
        i++;
      } else if (c === q && nx === q) {
        cur += c + q;
        i++;
      } else if (c === q) {
        inStr = false;
        cur += c;
      } else {
        cur += c;
      }
      continue;
    }
    if (inBacktick) {
      cur += c;
      if (c === '`') inBacktick = false;
      continue;
    }
    if (c === '-' && nx === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && nx === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = true;
      q = c;
      cur += c;
      continue;
    }
    if (c === '`') {
      inBacktick = true;
      cur += c;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) stmts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

/** Split a parenthesised list on top-level commas, respecting strings/parens. */
function splitTopLevel(s: string): string[] {
  const items: string[] = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  let q = '';
  let inBacktick = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const nx = s[i + 1];
    if (inStr) {
      if (c === '\\') {
        cur += c + (nx ?? '');
        i++;
      } else if (c === q && nx === q) {
        cur += c + q;
        i++;
      } else {
        if (c === q) inStr = false;
        cur += c;
      }
      continue;
    }
    if (inBacktick) {
      cur += c;
      if (c === '`') inBacktick = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = true;
      q = c;
      cur += c;
    } else if (c === '`') {
      inBacktick = true;
      cur += c;
    } else if (c === '(') {
      depth++;
      cur += c;
    } else if (c === ')') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) items.push(cur);
  return items;
}

const SQL_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', Z: '\x1a', '\\': '\\', "'": "'", '"': '"',
};

/** Turn a raw SQL literal token into a string|null cell value. */
function decodeSqlValue(raw: string): string | null {
  const t = raw.trim();
  if (/^null$/i.test(t)) return null;
  if (t.length >= 2 && (t[0] === "'" || t[0] === '"') && t[t.length - 1] === t[0]) {
    const q = t[0];
    const inner = t.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '\\') {
        const nx = inner[i + 1];
        out += SQL_ESCAPES[nx] ?? nx;
        i++;
      } else if (c === q && inner[i + 1] === q) {
        out += q;
        i++;
      } else {
        out += c;
      }
    }
    return out;
  }
  return t; // number / unquoted literal
}

/** Parse the tuple list after VALUES into arrays of cell values. */
function parseValueTuples(s: string): (string | null)[][] {
  const tuples: (string | null)[][] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && s[i] !== '(') i++;
    if (i >= s.length) break;
    i++; // past '('
    const values: string[] = [];
    let cur = '';
    let inStr = false;
    let q = '';
    let closed = false;
    while (i < s.length) {
      const c = s[i];
      const nx = s[i + 1];
      if (inStr) {
        if (c === '\\') {
          cur += c + (nx ?? '');
          i += 2;
          continue;
        }
        if (c === q && nx === q) {
          cur += c + q;
          i += 2;
          continue;
        }
        if (c === q) inStr = false;
        cur += c;
        i++;
        continue;
      }
      if (c === "'" || c === '"') {
        inStr = true;
        q = c;
        cur += c;
        i++;
        continue;
      }
      if (c === ',') {
        values.push(cur);
        cur = '';
        i++;
        continue;
      }
      if (c === ')') {
        values.push(cur);
        i++;
        closed = true;
        break;
      }
      cur += c;
      i++;
    }
    if (closed) tuples.push(values.map(decodeSqlValue));
  }
  return tuples;
}

function parseCreateTable(stmt: string): { table: string; cols: string[] } | null {
  const m = stmt.match(
    new RegExp(
      `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${TABLE_REF})\\s*\\(([\\s\\S]*)\\)`,
      'i',
    ),
  );
  if (!m) return null;
  const table = stripIdent(m[1]);
  const cols: string[] = [];
  for (const item of splitTopLevel(m[2])) {
    const t = item.trim();
    if (
      /^(PRIMARY\s+KEY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN\s+KEY|FULLTEXT|SPATIAL|CHECK)\b/i.test(t)
    ) {
      continue;
    }
    const cm = t.match(/^(`[^`]+`|"[^"]+"|[A-Za-z0-9_$]+)/);
    if (cm) cols.push(stripIdent(cm[1]));
  }
  return cols.length ? { table, cols } : null;
}

function parseInsertStatement(
  stmt: string,
): { table: string; cols: string[] | null; tuples: (string | null)[][] } | null {
  const m = stmt.match(
    new RegExp(`^INSERT\\s+(?:IGNORE\\s+)?INTO\\s+(${TABLE_REF})\\s*([\\s\\S]*)$`, 'i'),
  );
  if (!m) return null;
  const table = stripIdent(m[1]);
  const rest = m[2];

  let cols: string[] | null = null;
  let valuesPart: string;
  const withCols = rest.match(/^\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i);
  if (withCols) {
    cols = withCols[1].split(',').map(stripIdent);
    valuesPart = withCols[2];
  } else {
    const noCols = rest.match(/^VALUES?\s*([\s\S]*)$/i);
    if (!noCols) return null;
    valuesPart = noCols[1];
  }
  return { table, cols, tuples: parseValueTuples(valuesPart) };
}

/**
 * Parse a SQL dump into one ParsedCsv per table (data only — INSERT rows, with
 * column names from CREATE TABLE or the INSERT column list). Nothing executes.
 */
export function parseSqlDump(text: string): ParsedSheet[] {
  const createCols = new Map<string, string[]>();
  const tableRecords = new Map<string, Record<string, string | null>[]>();
  const order: string[] = [];

  for (const stmt of splitSqlStatements(text)) {
    if (/^CREATE\s+TABLE/i.test(stmt)) {
      const c = parseCreateTable(stmt);
      if (c) createCols.set(c.table, c.cols);
    } else if (/^INSERT\s+(?:IGNORE\s+)?INTO/i.test(stmt)) {
      const ins = parseInsertStatement(stmt);
      if (!ins) continue;
      const cols = ins.cols ?? createCols.get(ins.table) ?? null;
      if (!tableRecords.has(ins.table)) {
        tableRecords.set(ins.table, []);
        order.push(ins.table);
      }
      const recs = tableRecords.get(ins.table)!;
      for (const tuple of ins.tuples) {
        const effCols = cols ?? tuple.map((_, i) => `col_${i + 1}`);
        const rec: Record<string, string | null> = {};
        effCols.forEach((cn, i) => {
          rec[cn] = i < tuple.length ? tuple[i] : null;
        });
        recs.push(rec);
      }
    }
  }

  const sheets = order
    .map((name) => ({ name, parsed: fromRecords(tableRecords.get(name)!) }))
    .filter((s) => s.parsed.headers.length > 0 && s.parsed.rows.length > 0);

  if (sheets.length === 0) {
    throw new Error('No INSERT statements with data found in the .sql file.');
  }
  return sheets;
}

const INT_RE = /^-?\d+$/;
const DECIMAL_RE = /^-?\d*\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/;
const BOOL_VALUES = new Set(['true', 'false', '0', '1', 'yes', 'no']);

/**
 * Infer a sensible MySQL type for a column by sampling its values.
 * Empty cells (null) are ignored. Falls back to TEXT/VARCHAR for free text.
 */
export function inferColumnType(values: (string | null)[]): NewTableType {
  const sample = values.filter(
    (v): v is string => v !== null && v.trim() !== '',
  );
  if (sample.length === 0) return 'VARCHAR(255)';

  let allInt = true;
  let allNumeric = true;
  let allBool = true;
  let allDate = true;
  let allDateTime = true;
  let maxLen = 0;

  for (const raw of sample) {
    const v = raw.trim();
    maxLen = Math.max(maxLen, v.length);

    if (!INT_RE.test(v)) allInt = false;
    if (!INT_RE.test(v) && !DECIMAL_RE.test(v)) allNumeric = false;
    if (!BOOL_VALUES.has(v.toLowerCase())) allBool = false;
    if (!DATE_RE.test(v)) allDate = false;
    if (!DATETIME_RE.test(v)) allDateTime = false;
  }

  if (allBool) return 'BOOLEAN';
  if (allInt) {
    // Use BIGINT when any value won't fit in a 32-bit INT.
    const tooBig = sample.some((v) => {
      const n = Number(v);
      return !Number.isSafeInteger(n) || Math.abs(n) > 2147483647;
    });
    return tooBig ? 'BIGINT' : 'INT';
  }
  if (allNumeric) return 'DECIMAL(18,4)';
  if (allDateTime) return 'DATETIME';
  if (allDate) return 'DATE';
  return maxLen > 255 ? 'TEXT' : 'VARCHAR(255)';
}

/** Sanitize a CSV header into a safe SQL column identifier. */
export function toIdentifier(header: string): string {
  const cleaned = header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return 'column';
  // Identifiers can't start with a digit.
  return /^[a-z_]/.test(cleaned) ? cleaned : `col_${cleaned}`;
}

// ── Context row filter (from a plain-language instruction) ───

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'empty'
  | 'not_empty';

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value?: string;
}

export interface FilterSpec {
  match: 'all' | 'any';
  conditions: FilterCondition[];
}

const norm = (v: string | null | undefined): string =>
  (v ?? '').trim().toLowerCase();

const asNumber = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function matchesCondition(
  cell: string | null,
  cond: FilterCondition,
): boolean {
  switch (cond.operator) {
    case 'empty':
      return cell === null || cell.trim() === '';
    case 'not_empty':
      return cell !== null && cell.trim() !== '';
    case 'eq':
      return norm(cell) === norm(cond.value);
    case 'ne':
      return norm(cell) !== norm(cond.value);
    case 'contains':
      return norm(cell).includes(norm(cond.value));
    case 'not_contains':
      return !norm(cell).includes(norm(cond.value));
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const a = asNumber(cell);
      const b = asNumber(cond.value);
      const [x, y]: [number | string, number | string] =
        a !== null && b !== null ? [a, b] : [norm(cell), norm(cond.value)];
      if (cond.operator === 'gt') return x > y;
      if (cond.operator === 'lt') return x < y;
      if (cond.operator === 'gte') return x >= y;
      return x <= y;
    }
    default:
      return true;
  }
}

/** Apply a structured filter to rows. Empty/absent spec returns all rows. */
export function applyRowFilter(
  rows: Record<string, string | null>[],
  spec: FilterSpec | null,
): Record<string, string | null>[] {
  if (!spec || spec.conditions.length === 0) return rows;
  return rows.filter((row) => {
    const results = spec.conditions.map((c) =>
      matchesCondition(row[c.column] ?? null, c),
    );
    return spec.match === 'any'
      ? results.some(Boolean)
      : results.every(Boolean);
  });
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'is',
  ne: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  empty: 'is empty',
  not_empty: 'is not empty',
};

/** Human-readable description of a filter, e.g. `status is "approved"`. */
export function describeFilter(spec: FilterSpec | null): string {
  if (!spec || spec.conditions.length === 0) return '';
  const joiner = spec.match === 'any' ? ' or ' : ' and ';
  return spec.conditions
    .map((c) => {
      const label = OPERATOR_LABELS[c.operator];
      return c.operator === 'empty' || c.operator === 'not_empty'
        ? `${c.column} ${label}`
        : `${c.column} ${label} "${c.value ?? ''}"`;
    })
    .join(joiner);
}
