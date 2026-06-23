import { Injectable, Logger } from '@nestjs/common';
import { Parser } from 'node-sql-parser';
import { DbEngine, parserDialectCandidates } from '../common/db/engine';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

@Injectable()
export class SqlValidatorService {
  private readonly logger = new Logger(SqlValidatorService.name);
  private readonly parser = new Parser();

  private readonly FORBIDDEN_KEYWORDS = [
    'DROP',
    'DELETE',
    'UPDATE',
    'INSERT',
    'TRUNCATE',
    'ALTER',
    'CREATE',
    'REPLACE',
    'GRANT',
    'REVOKE',
    'EXEC',
    'EXECUTE',
    'CALL',
    'LOAD',
    'OUTFILE',
    'DUMPFILE',
    'SLEEP',
    'BENCHMARK',
    'LOAD_FILE',
  ];

  validate(sql: string, engine: DbEngine = 'mysql'): ValidationResult {
    const trimmed = sql.trim();
    const normalized = trimmed.toUpperCase();

    // 1. Must start with SELECT or WITH (CTE)
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      return {
        valid: false,
        error: 'Only SELECT queries are permitted',
        riskLevel: 'HIGH',
      };
    }

    // 2. Keyword scan
    for (const keyword of this.FORBIDDEN_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(trimmed)) {
        return {
          valid: false,
          error: `Forbidden operation detected: ${keyword}`,
          riskLevel: 'HIGH',
        };
      }
    }

    // 3. AST parsing — catches obfuscated injections
    try {
      const ast = this.astifyAny(trimmed, engine);
      const statements = Array.isArray(ast) ? ast : [ast];

      // Multiple statements = injection attempt
      if (statements.length > 1) {
        return {
          valid: false,
          error: 'Multiple statements are not allowed',
          riskLevel: 'HIGH',
        };
      }

      // Must be a SELECT statement
      if (statements[0]?.type !== 'select') {
        return {
          valid: false,
          error: 'Only SELECT statements are permitted',
          riskLevel: 'HIGH',
        };
      }
    } catch {
      // Fail CLOSED: if our parser can't understand the statement we can't prove
      // it's a single safe SELECT, so we reject rather than hope the DB does.
      // (Prefix + keyword checks above already passed, so this only rejects SQL
      // that is genuinely unparseable — an acceptable price for safety.)
      this.logger.warn('AST parse failed for SQL — rejecting (fail-closed)');
      return {
        valid: false,
        error: 'Query could not be safely parsed and was rejected',
        riskLevel: 'HIGH',
      };
    }

    return { valid: true, riskLevel: 'LOW' };
  }

  extractSQL(aiResponse: string): string | null {
    // Extract SQL from ```sql ... ``` code block
    const codeBlockMatch = aiResponse.match(/```sql\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch?.[1]) {
      return codeBlockMatch[1].trim();
    }

    // Fallback: look for SELECT statement directly
    const selectMatch = aiResponse.match(
      /((?:WITH\s+\w+.*?)?SELECT[\s\S]*?;?)\s*$/i,
    );
    if (selectMatch?.[1]) {
      return selectMatch[1].trim();
    }

    return null;
  }

  /** Pull the model's plain-English explanation and confidence (0-100). */
  extractMeta(aiResponse: string): {
    explanation: string | null;
    confidence: number | null;
  } {
    const explanation =
      aiResponse.match(/EXPLANATION:\s*(.+)/i)?.[1]?.trim() ?? null;
    const confRaw = aiResponse.match(/CONFIDENCE:\s*(\d{1,3})/i)?.[1];
    let confidence: number | null = null;
    if (confRaw !== undefined) {
      confidence = Math.max(0, Math.min(100, parseInt(confRaw, 10)));
    }
    return { explanation, confidence };
  }

  /**
   * Parse SQL trying each candidate dialect for the engine, returning the first
   * AST that parses. Throws if none do (so callers fail closed). Oracle has no
   * native grammar, so it relies on the closest dialects.
   */
  private astifyAny(sql: string, engine: DbEngine): unknown {
    let lastErr: unknown;
    for (const database of parserDialectCandidates(engine)) {
      try {
        return this.parser.astify(sql, { database });
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  /** Tables and columns a query reads, derived from the parsed AST. */
  extractAccessed(
    sql: string,
    engine: DbEngine = 'mysql',
  ): { tables: string[]; columns: string[] } {
    for (const database of parserDialectCandidates(engine)) {
      try {
        const opt = { database };
        // tableList → "select::dbName::tableName"; columnList → "select::table::col"
        const tables = [
          ...new Set(
            this.parser
              .tableList(sql, opt)
              .map((t) => t.split('::').pop() ?? '')
              .filter(Boolean),
          ),
        ];
        const columns = [
          ...new Set(
            this.parser
              .columnList(sql, opt)
              .map((c) => c.split('::').pop() ?? '')
              .filter((c) => c && c !== '(.*)' && c !== '*'),
          ),
        ];
        return { tables, columns };
      } catch {
        /* try the next candidate dialect */
      }
    }
    return { tables: [], columns: [] };
  }

  isCannotAnswer(aiResponse: string): { is: boolean; reason: string } {
    const match = aiResponse.trim().match(/^CANNOT_ANSWER:\s*(.+)/i);
    if (match) {
      return {
        is: true,
        reason: match[1] ?? 'Unable to answer with available schema',
      };
    }
    return { is: false, reason: '' };
  }

  /**
   * Detect and parse a structured clarification response. Returns the validated
   * interpretations (only options whose SQL passes validation are kept), or
   * `{ is: false }` if the response isn't a valid clarification with ≥2 options.
   */
  parseClarification(
    aiResponse: string,
    engine: DbEngine = 'mysql',
  ): {
    is: boolean;
    clarify?: string;
    options?: Array<{ label: string; sql: string }>;
  } {
    // Prefer a ```json fenced block; fall back to the first {...} object.
    const fenced = aiResponse.match(/```json\s*([\s\S]*?)```/i);
    const raw = fenced?.[1] ?? aiResponse.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return { is: false };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return { is: false };
    }

    if (typeof parsed !== 'object' || parsed === null) return { is: false };
    const obj = parsed as { clarify?: unknown; options?: unknown };
    if (!Array.isArray(obj.options)) return { is: false };

    const options: Array<{ label: string; sql: string }> = [];
    for (const opt of obj.options) {
      if (typeof opt !== 'object' || opt === null) continue;
      const o = opt as { label?: unknown; sql?: unknown };
      if (typeof o.label !== 'string' || typeof o.sql !== 'string') continue;
      const sql = this.extractSQL(o.sql) ?? o.sql.trim();
      if (!this.validate(sql, engine).valid) continue;
      options.push({ label: o.label.trim(), sql });
    }

    if (options.length < 2) return { is: false };
    return {
      is: true,
      clarify:
        typeof obj.clarify === 'string' && obj.clarify.trim()
          ? obj.clarify.trim()
          : 'Which did you mean?',
      options,
    };
  }
}
