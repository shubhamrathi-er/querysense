import { Injectable, Logger } from '@nestjs/common';
import { Parser } from 'node-sql-parser';

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Runtime guardrails for read queries, layered on top of SqlValidatorService
 * (which already enforces SELECT-only and blocks DDL/DML). This adds structural
 * limits and a pre-execution scan-size check, and logs every block for audit.
 */
@Injectable()
export class SqlGuardService {
  private readonly logger = new Logger(SqlGuardService.name);
  private readonly parser = new Parser();

  /** Max nesting of SELECTs (root counts as 1, so this allows 3 subquery levels). */
  readonly MAX_SELECT_DEPTH = 4;
  /** Reject when EXPLAIN estimates more scanned rows than this. */
  readonly MAX_ESTIMATED_ROWS = 1_000_000;
  /** Hard cap on page size regardless of what the client requests. */
  readonly MAX_PAGE_SIZE = 200;

  /** Structural checks that need no DB access (subquery depth). */
  checkStructure(sql: string): GuardResult {
    let ast: unknown;
    try {
      ast = this.parser.astify(sql, { database: 'MySQL' });
    } catch {
      // Unparseable SQL is rejected by SqlValidatorService (fail-closed); don't
      // double-handle it here.
      return { allowed: true };
    }

    const depth = this.selectDepth(ast, 0);
    if (depth > this.MAX_SELECT_DEPTH) {
      return {
        allowed: false,
        reason: `Query nests subqueries too deeply (${depth} levels, max ${this.MAX_SELECT_DEPTH}).`,
      };
    }
    return { allowed: true };
  }

  /** Deepest chain of nested SELECT nodes in the parsed AST. */
  private selectDepth(node: unknown, depth: number): number {
    if (Array.isArray(node)) {
      return node.reduce<number>(
        (max, n) => Math.max(max, this.selectDepth(n, depth)),
        depth,
      );
    }
    if (node && typeof node === 'object') {
      const here =
        (node as { type?: string }).type === 'select' ? depth + 1 : depth;
      let best = here;
      for (const value of Object.values(node as Record<string, unknown>)) {
        best = Math.max(best, this.selectDepth(value, here));
      }
      return best;
    }
    return depth;
  }

  /**
   * Evaluate a MySQL EXPLAIN result. The classic plan reports an estimated
   * `rows` per table; the product across tables approximates rows examined.
   */
  evaluateExplain(explainRows: Array<Record<string, unknown>>): GuardResult {
    let estimate = 1;
    for (const row of explainRows) {
      const rows = Number(row['rows'] ?? row['ROWS'] ?? 1) || 1;
      estimate *= Math.max(1, rows);
      // Short-circuit so a many-table plan can't overflow.
      if (estimate > this.MAX_ESTIMATED_ROWS) break;
    }
    if (estimate > this.MAX_ESTIMATED_ROWS) {
      return {
        allowed: false,
        reason: `Query would scan an estimated ${estimate.toLocaleString()} rows (max ${this.MAX_ESTIMATED_ROWS.toLocaleString()}). Add filters or a LIMIT.`,
      };
    }
    return { allowed: true };
  }

  /** Clamp a requested page size to the policy maximum. */
  cappedPageSize(requested: number): number {
    if (!Number.isFinite(requested) || requested < 1) return 50;
    return Math.min(Math.floor(requested), this.MAX_PAGE_SIZE);
  }

  /** Record a blocked query for audit. */
  logBlocked(context: string, reason: string, sql: string): void {
    this.logger.warn(
      `Guardrail BLOCKED [${context}]: ${reason} — SQL: ${sql.replace(/\s+/g, ' ').trim().slice(0, 300)}`,
    );
  }
}
