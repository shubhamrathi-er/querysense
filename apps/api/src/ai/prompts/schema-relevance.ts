/**
 * Relevance filtering for schema context.
 *
 * Sending an entire database schema to the LLM bloats the prompt, costs tokens,
 * and hurts accuracy on wide databases. This picks only the tables relevant to
 * the user's question (by keyword/name/column/description match), then expands
 * the selection along foreign keys so the chosen tables remain joinable.
 *
 * It is deliberately conservative: small schemas and questions with no signal
 * fall back to "send everything", so we never strip tables a query needs.
 */

export interface RelevanceTable {
  tableName: string;
  tableComment?: string | null;
  aiDescription?: string | null;
  businessDescription?: string | null;
  columns: Array<{
    columnName: string;
    isForeignKey: boolean;
    referencesTable: string | null;
  }>;
}

export interface SelectionResult<T> {
  tables: T[];
  filtered: boolean;
}

// Common English + SQL filler words that carry no table-selection signal.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
  'how', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'show', 'me',
  'get', 'list', 'all', 'find', 'give', 'count', 'total', 'sum', 'average',
  'avg', 'number', 'many', 'much', 'each', 'per', 'group', 'order', 'sort',
  'top', 'last', 'first', 'between', 'over', 'under', 'into', 'have', 'has',
  'had', 'been', 'their', 'them', 'they', 'our', 'your', 'his', 'her', 'its',
  'than', 'then', 'most', 'least', 'more', 'less', 'name', 'names', 'value',
  'values', 'data', 'record', 'records', 'row', 'rows', 'table', 'tables',
]);

function singularize(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function tokenize(question: string): string[] {
  const seen = new Set<string>();
  for (const raw of question.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    seen.add(raw);
    seen.add(singularize(raw));
  }
  return [...seen];
}

/**
 * Select the tables relevant to a question. Returns the full schema unchanged
 * (filtered: false) when the schema is small or the question has no usable
 * keywords, so callers can rely on joins always being satisfiable.
 */
export function selectRelevantTables<T extends RelevanceTable>(
  tables: T[],
  question: string,
  opts?: { maxTables?: number; alwaysAllUnder?: number },
): SelectionResult<T> {
  const maxTables = opts?.maxTables ?? 12;
  const alwaysAllUnder = opts?.alwaysAllUnder ?? 8;

  // Tiny schemas: filtering risks more than it saves.
  if (tables.length <= alwaysAllUnder) return { tables, filtered: false };

  const tokens = tokenize(question);
  if (tokens.length === 0) return { tables, filtered: false };

  const scoreTable = (t: T): number => {
    let score = 0;
    const name = t.tableName.toLowerCase();
    const nameParts = new Set([name, singularize(name), ...name.split(/[_\s]+/)]);
    const descWords = `${t.businessDescription ?? ''} ${t.aiDescription ?? ''} ${t.tableComment ?? ''}`.toLowerCase();

    for (const tok of tokens) {
      if (nameParts.has(tok) || name.includes(tok)) score += 5;
      else if (descWords.includes(tok)) score += 2;

      for (const col of t.columns) {
        const cn = col.columnName.toLowerCase();
        if (cn === tok) score += 3;
        else if (tok.length >= 4 && cn.includes(tok)) score += 1;
      }
    }
    return score;
  };

  const scores = new Map<string, number>();
  for (const t of tables) scores.set(t.tableName, scoreTable(t));

  const matched = tables
    .filter((t) => (scores.get(t.tableName) ?? 0) > 0)
    .sort((a, b) => (scores.get(b.tableName) ?? 0) - (scores.get(a.tableName) ?? 0));

  // No keyword landed anywhere — don't gamble, send the whole schema.
  if (matched.length === 0) return { tables, filtered: false };

  const selected = new Set<string>(matched.slice(0, maxTables).map((t) => t.tableName));

  // Forward-FK expansion: a selected table that references another table needs
  // that table present for the join to be valid.
  const byName = new Map(tables.map((t) => [t.tableName, t]));
  for (const tableName of [...selected]) {
    const t = byName.get(tableName);
    if (!t) continue;
    for (const col of t.columns) {
      if (col.isForeignKey && col.referencesTable && byName.has(col.referencesTable)) {
        selected.add(col.referencesTable);
      }
    }
  }

  // Hard cap so FK expansion can't quietly re-inflate the prompt. Keyword-matched
  // tables (score > 0) are kept ahead of pulled-in FK neighbors (score 0).
  const hardCap = maxTables + 8;
  let result = tables.filter((t) => selected.has(t.tableName));
  if (result.length > hardCap) {
    result = [...result]
      .sort((a, b) => (scores.get(b.tableName) ?? 0) - (scores.get(a.tableName) ?? 0))
      .slice(0, hardCap);
  }

  return { tables: result, filtered: result.length < tables.length };
}
