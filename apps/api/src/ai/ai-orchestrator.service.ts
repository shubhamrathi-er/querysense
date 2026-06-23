import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GroqProvider } from './providers/groq.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { SqlValidatorService } from './sql-validator.service';
import {
  buildSQLGenerationPrompt,
  buildInsightPrompt,
  buildSchemaContext,
  buildRepairPrompt,
  type SQLPromptParams,
  type RepairPromptParams,
} from './prompts/sql-generation.prompt';
import {
  selectRelevantTables,
  type RelevanceTable,
  type SelectionResult,
} from './prompts/schema-relevance';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ChatMessage } from './interfaces/ai-provider.interface';

export interface SQLGenerationResult {
  type: 'sql' | 'cannot_answer' | 'clarification';
  sql: string | null;
  reason: string | null;
  /** Structured output (type === 'sql'). */
  explanation?: string | null;
  confidence?: number | null;
  tables?: string[];
  columns?: string[];
  /** Set when type === 'clarification' — candidate interpretations to choose from. */
  clarify?: string | null;
  interpretations?: Array<{ label: string; sql: string }> | null;
  tokensUsed: number;
  model: string;
  latencyMs: number;
}

export interface InsightResult {
  text: string;
  tokensUsed: number;
}

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

export interface ImportFilterCondition {
  column: string;
  operator: FilterOperator;
  value?: string;
}

export interface ImportFilterSpec {
  match: 'all' | 'any';
  conditions: ImportFilterCondition[];
}

const FILTER_OPERATORS = new Set<FilterOperator>([
  'eq', 'ne', 'contains', 'not_contains',
  'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty',
]);

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private openRouter: OpenRouterProvider,
    private groq: GroqProvider,
    private gemini: GeminiProvider,
    private validator: SqlValidatorService,
  ) {}

  async generateSQL(params: SQLPromptParams): Promise<SQLGenerationResult> {
    const messages = buildSQLGenerationPrompt(params);

    // Try providers in order — Groq first (fastest), Gemini as fallback
    const providers = [this.groq, this.openRouter, this.gemini];

    for (const provider of providers) {
      // Skip providers with no API key configured
      if (!this.hasApiKey(provider.name)) {
        this.logger.debug(`Skipping ${provider.name} — no API key`);
        continue;
      }

      try {
        this.logger.log(`Trying provider: ${provider.name}`);
        const result = await provider.complete(messages);

        // Check for a structured clarification (ambiguous question).
        const clarification = this.validator.parseClarification(result.content);
        if (clarification.is) {
          return {
            type: 'clarification',
            sql: null,
            reason: null,
            clarify: clarification.clarify,
            interpretations: clarification.options,
            tokensUsed: result.tokensUsed,
            model: result.model,
            latencyMs: result.latencyMs,
          };
        }

        // Check for CANNOT_ANSWER
        const cannotAnswer = this.validator.isCannotAnswer(result.content);
        if (cannotAnswer.is) {
          return {
            type: 'cannot_answer',
            sql: null,
            reason: cannotAnswer.reason,
            tokensUsed: result.tokensUsed,
            model: result.model,
            latencyMs: result.latencyMs,
          };
        }

        // Extract SQL from response
        const sql = this.validator.extractSQL(result.content);
        if (!sql) {
          this.logger.warn(
            `${provider.name} returned no parseable SQL, trying next`,
          );
          continue;
        }

        // Validate the SQL
        const validation = this.validator.validate(sql);
        if (!validation.valid) {
          this.logger.warn(`SQL validation failed: ${validation.error}`);
          continue;
        }

        const meta = this.validator.extractMeta(result.content);
        const accessed = this.validator.extractAccessed(sql);
        return {
          type: 'sql',
          sql,
          reason: null,
          explanation: meta.explanation,
          confidence: meta.confidence,
          tables: accessed.tables,
          columns: accessed.columns,
          tokensUsed: result.tokensUsed,
          model: result.model,
          latencyMs: result.latencyMs,
        };
      } catch (error) {
        this.logger.warn(
          `Provider ${provider.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        continue;
      }
    }

    throw new ServiceUnavailableException(
      'All AI providers failed or are not configured. Please add an API key in your .env file.',
    );
  }

  /**
   * One-shot repair: given a query that failed at execution and the DB error,
   * ask a provider for a corrected, safety-validated SELECT. Returns null if no
   * provider produces a usable fix.
   */
  async repairSQL(params: RepairPromptParams): Promise<{
    sql: string;
    model: string;
    tokensUsed: number;
    latencyMs: number;
  } | null> {
    const messages = buildRepairPrompt(params);
    const providers = [this.groq, this.openRouter, this.gemini];

    for (const provider of providers) {
      if (!this.hasApiKey(provider.name)) continue;
      try {
        const result = await provider.complete(messages);
        if (this.validator.isCannotAnswer(result.content).is) return null;

        const sql = this.validator.extractSQL(result.content);
        if (!sql || !this.validator.validate(sql).valid) continue;

        return {
          sql,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
        };
      } catch (error) {
        this.logger.warn(
          `Repair via ${provider.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        continue;
      }
    }
    return null;
  }

  async generateInsight(
    question: string,
    sql: string,
    results: Record<string, unknown>[],
  ): Promise<InsightResult> {
    const messages = buildInsightPrompt(question, sql, results);
    const providers = [this.groq, this.openRouter, this.gemini];

    for (const provider of providers) {
      if (!this.hasApiKey(provider.name)) continue;

      try {
        const result = await provider.complete(messages);
        return {
          text: result.content.trim(),
          tokensUsed: result.tokensUsed,
        };
      } catch {
        continue;
      }
    }

    // Insight is optional — don't throw if all fail
    return { text: '', tokensUsed: 0 };
  }

  buildSchemaContext(tables: Parameters<typeof buildSchemaContext>[0]): string {
    return buildSchemaContext(tables);
  }

  /**
   * Narrow a full schema down to the tables relevant to a question (plus their
   * FK neighbours), so the generation prompt stays focused on wide databases.
   */
  selectRelevantTables<T extends RelevanceTable>(
    tables: T[],
    question: string,
  ): SelectionResult<T> {
    return selectRelevantTables(tables, question);
  }

  /**
   * Generate a business description for a table and each of its columns,
   * using the structure and (optionally) a few sample values.
   */
  async generateTableDescription(input: {
    tableName: string;
    isView: boolean;
    columns: Array<{
      name: string;
      dataType: string;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      references?: string | null;
      sampleValues?: string[];
    }>;
  }): Promise<{ description: string; columns: Record<string, string> }> {
    const columnLines = input.columns
      .map((c) => {
        const flags = [
          c.isPrimaryKey ? 'PK' : '',
          c.isForeignKey ? `FK->${c.references ?? ''}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const samples =
          c.sampleValues && c.sampleValues.length
            ? ` e.g. ${c.sampleValues.slice(0, 5).join(', ')}`
            : '';
        return `- ${c.name} (${c.dataType}${flags ? ' ' + flags : ''})${samples}`;
      })
      .join('\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You document database schemas. Given a table and its columns, write a concise 1–2 sentence ' +
          'business description of the table, and a short one-line description for each column. ' +
          'Respond with ONLY a JSON object — no prose, no markdown fences.\n' +
          'Schema: {"description": string, "columns": { "<columnName>": "<one-line description>" }}',
      },
      {
        role: 'user',
        content:
          `${input.isView ? 'View' : 'Table'}: ${input.tableName}\nColumns:\n${columnLines}\n\n` +
          'Return only the JSON.',
      },
    ];

    const providers = [this.groq, this.openRouter, this.gemini];
    for (const provider of providers) {
      if (!this.hasApiKey(provider.name)) continue;
      try {
        const result = await provider.complete(messages);
        const parsed = this.parseDescription(
          result.content,
          input.columns.map((c) => c.name),
        );
        if (parsed) return parsed;
      } catch (error) {
        this.logger.warn(
          `Description generation via ${provider.name} failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        continue;
      }
    }

    throw new ServiceUnavailableException(
      'Could not generate descriptions. All AI providers failed or are not configured.',
    );
  }

  /**
   * Suggest a grouping of tables into logical modules/domains, using table
   * names and their foreign-key relationships.
   */
  async suggestModules(
    tables: Array<{ tableName: string; references: string[] }>,
  ): Promise<Array<{ name: string; description: string; tables: string[] }>> {
    const lines = tables
      .map(
        (t) =>
          `- ${t.tableName}${t.references.length ? ` (refs: ${t.references.join(', ')})` : ''}`,
      )
      .join('\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You organise a database into logical modules (business domains) such as ' +
          '"Orders", "Catalog", "Users & Auth", "Payments". Group the given tables using ' +
          'their names and foreign-key relationships. Every table must belong to exactly one module. ' +
          'Respond with ONLY a JSON array — no prose, no markdown fences.\n' +
          'Schema: [{"name": string, "description": string, "tables": [<tableName>, ...]}]',
      },
      {
        role: 'user',
        content: `Tables:\n${lines}\n\nReturn only the JSON array of modules.`,
      },
    ];

    const validNames = new Set(tables.map((t) => t.tableName));
    const providers = [this.groq, this.openRouter, this.gemini];
    for (const provider of providers) {
      if (!this.hasApiKey(provider.name)) continue;
      try {
        const result = await provider.complete(messages);
        const parsed = this.parseModules(result.content, validNames);
        if (parsed && parsed.length) return parsed;
      } catch (error) {
        this.logger.warn(
          `Module suggestion via ${provider.name} failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        continue;
      }
    }

    throw new ServiceUnavailableException(
      'Could not suggest modules. All AI providers failed or are not configured.',
    );
  }

  /**
   * Ask the model for higher-level schema best-practice issues that the
   * deterministic rules can't catch (normalization, design smells, etc.).
   */
  async reviewSchema(
    schemaSummary: string,
  ): Promise<
    Array<{
      severity: 'high' | 'medium' | 'low' | 'info';
      category: string;
      title: string;
      table: string | null;
      recommendation: string;
    }>
  > {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a senior database architect reviewing a MySQL schema. Identify up to 8 ' +
          'higher-level best-practice issues or design smells (normalization, missing ' +
          'relationships, redundant data, scalability, audit columns, etc.). Be specific and ' +
          'actionable. Respond with ONLY a JSON array — no prose, no markdown fences.\n' +
          'Schema: [{"severity":"high|medium|low|info","category":string,"title":string,"table":string|null,"recommendation":string}]',
      },
      {
        role: 'user',
        content: `Schema:\n${schemaSummary}\n\nReturn only the JSON array of findings.`,
      },
    ];

    const providers = [this.groq, this.openRouter, this.gemini];
    for (const provider of providers) {
      if (!this.hasApiKey(provider.name)) continue;
      try {
        const result = await provider.complete(messages);
        const jsonMatch = result.content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;
        const parsed: unknown = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) continue;

        const allowed = new Set(['high', 'medium', 'low', 'info']);
        return parsed
          .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
          .map((f) => ({
            severity: (allowed.has(String(f['severity']))
              ? String(f['severity'])
              : 'info') as 'high' | 'medium' | 'low' | 'info',
            category: String(f['category'] ?? 'Design'),
            title: String(f['title'] ?? '').slice(0, 200),
            table: f['table'] ? String(f['table']) : null,
            recommendation: String(f['recommendation'] ?? ''),
          }))
          .filter((f) => f.title);
      } catch {
        continue;
      }
    }
    return []; // advisor is best-effort
  }

  private parseModules(
    content: string,
    validNames: Set<string>,
  ): Array<{ name: string; description: string; tables: string[] }> | null {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;

    const seen = new Set<string>();
    const modules: Array<{ name: string; description: string; tables: string[] }> = [];
    const byLower = new Map([...validNames].map((n) => [n.toLowerCase(), n]));

    for (const raw of parsed) {
      if (typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
      if (!name) continue;
      const description =
        typeof r['description'] === 'string' ? r['description'].trim() : '';
      const rawTables = Array.isArray(r['tables']) ? r['tables'] : [];
      const tableNames: string[] = [];
      for (const t of rawTables) {
        const real = byLower.get(String(t).toLowerCase());
        if (real && !seen.has(real)) {
          seen.add(real);
          tableNames.push(real);
        }
      }
      if (tableNames.length) modules.push({ name, description, tables: tableNames });
    }

    return modules;
  }

  private parseDescription(
    content: string,
    columnNames: string[],
  ): { description: string; columns: Record<string, string> } | null {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const description =
      typeof obj['description'] === 'string' ? obj['description'].trim() : '';

    const rawColumns =
      typeof obj['columns'] === 'object' && obj['columns'] !== null
        ? (obj['columns'] as Record<string, unknown>)
        : {};

    // Map descriptions back to real column names (case-insensitive).
    const byLower = new Map(columnNames.map((c) => [c.toLowerCase(), c]));
    const columns: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawColumns)) {
      const real = byLower.get(key.toLowerCase());
      if (real && typeof val === 'string' && val.trim()) {
        columns[real] = val.trim();
      }
    }

    return { description, columns };
  }

  /**
   * Turn a plain-language instruction ("only rows where status is approved")
   * into a structured, safely-applied row filter over the given columns.
   */
  async interpretImportFilter(
    columns: string[],
    sampleRows: Record<string, string | null>[],
    instruction: string,
  ): Promise<ImportFilterSpec> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You convert a user\'s plain-language data-filtering instruction into a strict JSON filter over table columns. ' +
          'Respond with ONLY a JSON object — no prose, no markdown fences.\n' +
          'Schema: {"match":"all"|"any","conditions":[{"column":<one of the provided columns>,"operator":<op>,"value":<string>}]}\n' +
          'Allowed operators: eq, ne, contains, not_contains, gt, lt, gte, lte, empty, not_empty. ' +
          'Omit "value" for empty/not_empty. Use "match":"all" for AND, "any" for OR. ' +
          'If the instruction implies no filtering, return {"match":"all","conditions":[]}.',
      },
      {
        role: 'user',
        content:
          `Columns: ${JSON.stringify(columns)}\n` +
          `Sample rows: ${JSON.stringify(sampleRows.slice(0, 10))}\n` +
          `Instruction: ${instruction}\n\n` +
          'Return only the JSON filter.',
      },
    ];

    const providers = [this.groq, this.openRouter, this.gemini];
    for (const provider of providers) {
      if (!this.hasApiKey(provider.name)) continue;
      try {
        const result = await provider.complete(messages);
        const spec = this.parseFilterSpec(result.content, columns);
        if (spec) return spec;
      } catch (error) {
        this.logger.warn(
          `Filter interpretation via ${provider.name} failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        continue;
      }
    }

    throw new ServiceUnavailableException(
      'Could not interpret the context. All AI providers failed or are not configured.',
    );
  }

  private parseFilterSpec(
    content: string,
    columns: string[],
  ): ImportFilterSpec | null {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const match = obj['match'] === 'any' ? 'any' : 'all';
    const rawConditions = Array.isArray(obj['conditions'])
      ? obj['conditions']
      : [];

    // Map columns case-insensitively back to the real header names.
    const colByLower = new Map(columns.map((c) => [c.toLowerCase(), c]));

    const conditions: ImportFilterCondition[] = [];
    for (const raw of rawConditions) {
      if (typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const column = colByLower.get(String(r['column'] ?? '').toLowerCase());
      const operator = r['operator'] as FilterOperator;
      if (!column || !FILTER_OPERATORS.has(operator)) continue;
      const needsValue = operator !== 'empty' && operator !== 'not_empty';
      conditions.push({
        column,
        operator,
        ...(needsValue ? { value: String(r['value'] ?? '') } : {}),
      });
    }

    return { match, conditions };
  }

  private hasApiKey(providerName: string): boolean {
    const keys: Record<string, string> = {
      openrouter: process.env.OPENROUTER_API_KEY ?? '',
      groq: process.env.GROQ_API_KEY ?? '',
      gemini: process.env.GEMINI_API_KEY ?? '',
    };
    const hasKey = (keys[providerName] ?? '').length > 0;
    this.logger.log(`Provider ${providerName}: hasKey=${hasKey}`);
    return hasKey;
  }
}
