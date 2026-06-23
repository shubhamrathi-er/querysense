import type { ChatMessage } from '../interfaces/ai-provider.interface';
import type { DbEngine } from '../../common/db/engine';

export interface SQLPromptParams {
  userQuestion: string;
  schemaContext: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  databaseName: string;
  engine: DbEngine;
  /** Past question→SQL pairs that ran successfully on this database. */
  fewShotExamples?: Array<{ question: string; sql: string }>;
}

interface DialectGuidance {
  name: string;
  lastMonth: string;
  thisYear: string;
  /** The row-limit rule (rule 3) — differs because T-SQL has no LIMIT. */
  limitRule: string;
  extraRules: string[];
}

function dialectGuidance(engine: DbEngine): DialectGuidance {
  if (engine === 'postgres') {
    return {
      name: 'PostgreSQL',
      lastMonth: `WHERE date_col >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND date_col < DATE_TRUNC('month', CURRENT_DATE)`,
      thisYear: `WHERE EXTRACT(YEAR FROM date_col) = EXTRACT(YEAR FROM CURRENT_DATE)`,
      limitRule:
        'ALWAYS add LIMIT 500 unless user specifies a limit or asks for aggregations',
      extraRules: [
        `PostgreSQL folds unquoted identifiers to lowercase — double-quote any table/column whose name isn't all-lowercase (e.g. "OrderItems").`,
        `Use ILIKE for case-insensitive text matching.`,
      ],
    };
  }
  if (engine === 'redshift') {
    return {
      name: 'Amazon Redshift',
      lastMonth: `WHERE date_col >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND date_col < DATE_TRUNC('month', CURRENT_DATE)`,
      thisYear: `WHERE EXTRACT(YEAR FROM date_col) = EXTRACT(YEAR FROM CURRENT_DATE)`,
      limitRule:
        'ALWAYS add LIMIT 500 unless user specifies a limit or asks for aggregations',
      extraRules: [
        `Redshift folds unquoted identifiers to lowercase — double-quote any identifier that isn't all-lowercase.`,
        `Use ILIKE for case-insensitive text matching.`,
      ],
    };
  }
  if (engine === 'snowflake') {
    return {
      name: 'Snowflake',
      lastMonth: `WHERE date_col >= DATE_TRUNC('month', DATEADD('month', -1, CURRENT_DATE())) AND date_col < DATE_TRUNC('month', CURRENT_DATE())`,
      thisYear: `WHERE YEAR(date_col) = YEAR(CURRENT_DATE())`,
      limitRule:
        'ALWAYS add LIMIT 500 unless user specifies a limit or asks for aggregations',
      extraRules: [
        `Snowflake folds unquoted identifiers to UPPERCASE — double-quote any identifier that must keep its case.`,
        `Use ILIKE for case-insensitive text matching.`,
      ],
    };
  }
  if (engine === 'oracle') {
    return {
      name: 'Oracle',
      lastMonth: `WHERE date_col >= TRUNC(ADD_MONTHS(SYSDATE, -1), 'MM') AND date_col < TRUNC(SYSDATE, 'MM')`,
      thisYear: `WHERE EXTRACT(YEAR FROM date_col) = EXTRACT(YEAR FROM SYSDATE)`,
      limitRule:
        'Do NOT add ROWNUM, FETCH FIRST or OFFSET — the system paginates results automatically. Include ORDER BY when ordering matters.',
      extraRules: [
        `Oracle folds unquoted identifiers to UPPERCASE — double-quote any identifier that must keep its case.`,
        `Use the dual table for constant selects; string concat is || .`,
      ],
    };
  }
  if (engine === 'sqlserver') {
    return {
      name: 'SQL Server',
      lastMonth: `WHERE date_col >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 1, 0) AND date_col < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0)`,
      thisYear: `WHERE YEAR(date_col) = YEAR(GETDATE())`,
      limitRule:
        'Do NOT add TOP, OFFSET or FETCH — the system paginates results automatically. Include ORDER BY when ordering matters.',
      extraRules: [
        'Quote identifiers with [square brackets] (e.g. [Order Items]).',
        'T-SQL has no LIMIT; for "top N" use SELECT TOP (N) only when the user explicitly asks for a fixed number.',
      ],
    };
  }
  return {
    name: 'MySQL',
    lastMonth: `WHERE date_col >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01') AND date_col < DATE_FORMAT(NOW(), '%Y-%m-01')`,
    thisYear: `WHERE YEAR(date_col) = YEAR(NOW())`,
    limitRule:
      'ALWAYS add LIMIT 500 unless user specifies a limit or asks for aggregations',
    extraRules: [],
  };
}

export function buildSQLGenerationPrompt(
  params: SQLPromptParams,
): ChatMessage[] {
  const d = dialectGuidance(params.engine);
  const extraRules = d.extraRules
    .map((r, i) => `${10 + i}. ${r}`)
    .join('\n');
  const systemPrompt = `You are an expert ${d.name} query generator for the database "${params.databaseName}".

## YOUR ROLE
Convert natural language questions into precise, optimized ${d.name} queries.

## DATABASE SCHEMA
${params.schemaContext}

## STRICT RULES
1. ONLY use tables and columns that exist in the schema above
2. ALWAYS use table aliases for clarity (e.g. SELECT u.name FROM users u)
3. ${d.limitRule}
4. NEVER use DROP, DELETE, UPDATE, INSERT, TRUNCATE, ALTER, CREATE, or any DDL/DML
5. For "last month": ${d.lastMonth}
6. For "this year": ${d.thisYear}
7. Always wrap your SQL in a \`\`\`sql code block
8. Use COUNT(*) for counting, SUM() for totals, AVG() for averages
9. Column comments marked "e.g. 'x', 'y'" list ACTUAL stored values — match their exact casing/spelling in WHERE filters${extraRules ? '\n' + extraRules : ''}

## OUTPUT FORMAT
Respond with the SQL query inside a \`\`\`sql code block, then these two lines immediately after the block:
EXPLANATION: <one plain-English sentence describing what the query returns>
CONFIDENCE: <integer 0-100 — how confident you are this matches the question>
No other commentary or preamble.

If the question CANNOT be answered with the available schema, respond with exactly:
CANNOT_ANSWER: <one sentence reason>

## AMBIGUITY
If the question has TWO OR MORE genuinely different reasonable interpretations that would each need DIFFERENT SQL (e.g. "top customers" could mean by order count or by total spend), do NOT guess. Respond with ONLY a JSON object inside a \`\`\`json code block:
\`\`\`json
{
  "clarify": "<short question naming the ambiguity>",
  "options": [
    { "label": "<short description of interpretation 1>", "sql": "<full SQL for it>" },
    { "label": "<short description of interpretation 2>", "sql": "<full SQL for it>" }
  ]
}
\`\`\`
Give 2-3 options, each with valid SQL following all rules above. Only do this when the question is TRULY ambiguous — when one interpretation is clearly intended, just answer it directly.`;

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // Few-shot: real question→SQL pairs that succeeded on this database, shown as
  // prior turns so the model mirrors the proven style/joins for this schema.
  for (const ex of params.fewShotExamples ?? []) {
    messages.push({ role: 'user', content: ex.question });
    messages.push({ role: 'assistant', content: '```sql\n' + ex.sql + '\n```' });
  }

  // Add last 4 conversation turns for context
  const recentHistory = params.conversationHistory.slice(-4);
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: 'user', content: params.userQuestion });

  return messages;
}

// String-ish types where knowing the actual stored values helps the model write
// correct WHERE filters (e.g. status = 'ACTIVE' vs 'active'). IDs, dates, blobs
// and free text are excluded — sample values there are noise.
const CATEGORICAL_TYPES = new Set([
  'varchar',
  'char',
  'enum',
  'set',
  'tinyint',
  'boolean',
  'character varying',
]);

/** Render up to 3 example values for a categorical column, or null. */
function formatSampleValues(col: {
  dataType: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  sampleValues?: unknown;
}): string | null {
  if (col.isPrimaryKey || col.isForeignKey) return null;
  if (!CATEGORICAL_TYPES.has(col.dataType.toLowerCase())) return null;
  if (!Array.isArray(col.sampleValues)) return null;

  const vals = col.sampleValues
    .map((v) => String(v))
    .filter((s) => s.length > 0 && s.length <= 40)
    .slice(0, 3);
  if (vals.length === 0) return null;

  return vals.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ');
}

export function buildSchemaContext(
  tables: Array<{
    tableName: string;
    tableComment: string | null;
    aiDescription: string | null;
    businessDescription?: string | null;
    rowCount: bigint | null;
    isView: boolean;
    columns: Array<{
      columnName: string;
      dataType: string;
      isNullable: boolean;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      referencesTable: string | null;
      referencesColumn: string | null;
      columnComment: string | null;
      aiDescription?: string | null;
      sampleValues?: unknown;
    }>;
  }>,
): string {
  return tables
    .map((table) => {
      const cols = table.columns
        .map((col) => {
          let def = `  ${col.columnName} ${col.dataType.toUpperCase()}`;
          if (col.isPrimaryKey) def += ' PRIMARY KEY';
          if (!col.isNullable) def += ' NOT NULL';

          // Collect all annotations into a single trailing comment.
          const notes: string[] = [];
          if (col.isForeignKey && col.referencesTable) {
            notes.push(`FK -> ${col.referencesTable}.${col.referencesColumn}`);
          }
          const colNote = col.aiDescription ?? col.columnComment;
          if (colNote) notes.push(colNote);
          const samples = formatSampleValues(col);
          if (samples) notes.push(`e.g. ${samples}`);
          if (notes.length) def += ` -- ${notes.join(' | ')}`;

          return def;
        })
        .join('\n');

      const description =
        table.businessDescription ??
        table.aiDescription ??
        table.tableComment ??
        '';
      const rowInfo = table.rowCount
        ? ` (~${table.rowCount.toLocaleString()} rows)`
        : '';

      return `-- ${table.tableName}${rowInfo}${description ? `: ${description}` : ''}
CREATE TABLE ${table.tableName} (
${cols}
);`;
    })
    .join('\n\n');
}

export interface RepairPromptParams {
  databaseName: string;
  engine: DbEngine;
  schemaContext: string;
  question?: string;
  brokenSql: string;
  errorMessage: string;
}

/**
 * Prompt for fixing a query that passed safety validation but failed when run
 * against the live database (e.g. unknown column, bad join, type mismatch).
 */
export function buildRepairPrompt(params: RepairPromptParams): ChatMessage[] {
  const d = dialectGuidance(params.engine);
  const systemPrompt = `You are an expert ${d.name} engineer FIXING a query that failed to execute against the database "${params.databaseName}".

## DATABASE SCHEMA
${params.schemaContext}

## RULES
1. ONLY use tables and columns that exist in the schema above — the error is usually a wrong/misspelled table or column, a bad join, or a type mismatch.
2. Preserve the original intent of the query.
3. SELECT/WITH queries only. NEVER use DROP, DELETE, UPDATE, INSERT, TRUNCATE, ALTER, CREATE or any DDL/DML.
4. Keep any existing LIMIT, or add LIMIT 500 if there was none and it isn't an aggregation.

## OUTPUT FORMAT
Respond with ONLY the corrected SQL inside a \`\`\`sql code block. No explanation.
If the query cannot be fixed with the available schema, respond with exactly:
CANNOT_ANSWER: <one sentence reason>`;

  const userContent = `${params.question ? `Original intent: ${params.question}\n\n` : ''}This SQL failed:
\`\`\`sql
${params.brokenSql}
\`\`\`

Database error:
${params.errorMessage}

Return the corrected SQL.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

export function buildInsightPrompt(
  question: string,
  sql: string,
  results: Record<string, unknown>[],
): ChatMessage[] {
  const sampleRows = results.slice(0, 5);
  const totalRows = results.length;

  return [
    {
      role: 'system',
      content: `You are a data analyst. Given a question, the SQL that was run, and the results, 
provide a concise 2-3 sentence business insight. 
Focus on what the data means, not on the SQL itself.
Be specific about numbers. Use plain English.`,
    },
    {
      role: 'user',
      content: `Question: ${question}

SQL executed:
\`\`\`sql
${sql}
\`\`\`

Results (${totalRows} rows total, showing first 5):
${JSON.stringify(sampleRows, null, 2)}

Provide a concise business insight about these results.`,
    },
  ];
}
