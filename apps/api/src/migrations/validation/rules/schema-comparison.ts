import {
  Severity,
  type ColumnSummary,
  type ColumnComparison,
  type Issue,
} from '../types';
import { classifyTypeChange } from './type-compatibility';

const PHASE = 'schema';

function find(cols: ColumnSummary[], name: string): ColumnSummary | undefined {
  return cols.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

/** Pure column-by-column comparison of a single table's schema. */
export function compareTableColumns(
  tableName: string,
  sourceCols: ColumnSummary[],
  targetCols: ColumnSummary[],
): { columns: ColumnComparison[]; issues: Issue[] } {
  const columns: ColumnComparison[] = [];
  const issues: Issue[] = [];
  const push = (i: Issue) => issues.push(i);

  for (const src of sourceCols) {
    const tgt = find(targetCols, src.name);
    const changes: Issue[] = [];

    if (!tgt) {
      const i: Issue = {
        phase: PHASE,
        code: 'TARGET_COLUMN_MISSING',
        severity: Severity.ERROR,
        table: tableName,
        column: src.name,
        message: `Column "${src.name}" is missing on the target table.`,
      };
      changes.push(i);
      push(i);
      columns.push({ column: src.name, source: src, target: null, changes });
      continue;
    }

    // Type compatibility
    const tc = classifyTypeChange(src.columnType, tgt.columnType);
    if (tc.severity !== Severity.INFO) {
      const i: Issue = {
        phase: PHASE,
        code: tc.code,
        severity: tc.severity,
        table: tableName,
        column: src.name,
        message: tc.message,
        detail: { source: src.columnType, target: tgt.columnType },
      };
      changes.push(i);
      push(i);
    }

    // Nullability: source allows NULL, target is NOT NULL
    if (src.nullable && !tgt.nullable) {
      const i: Issue = {
        phase: PHASE,
        code: 'NULLABILITY_MISMATCH',
        severity: Severity.ERROR,
        table: tableName,
        column: src.name,
        message: `Source allows NULL but target "${src.name}" is NOT NULL.`,
      };
      changes.push(i);
      push(i);
    }

    // Charset / collation
    if (src.charset && tgt.charset && src.charset !== tgt.charset) {
      const i: Issue = {
        phase: PHASE,
        code: 'CHARSET_MISMATCH',
        severity: Severity.WARNING,
        table: tableName,
        column: src.name,
        message: `Charset differs (${src.charset} → ${tgt.charset}).`,
      };
      changes.push(i);
      push(i);
    }
    if (src.collation && tgt.collation && src.collation !== tgt.collation) {
      const i: Issue = {
        phase: PHASE,
        code: 'COLLATION_MISMATCH',
        severity: Severity.WARNING,
        table: tableName,
        column: src.name,
        message: `Collation differs (${src.collation} → ${tgt.collation}).`,
      };
      changes.push(i);
      push(i);
    }

    // Auto-increment
    if (src.autoIncrement !== tgt.autoIncrement) {
      const i: Issue = {
        phase: PHASE,
        code: 'AUTO_INCREMENT_MISMATCH',
        severity: Severity.INFO,
        table: tableName,
        column: src.name,
        message: `AUTO_INCREMENT differs (source ${src.autoIncrement}, target ${tgt.autoIncrement}).`,
      };
      changes.push(i);
      push(i);
    }

    // Default value
    if ((src.defaultValue ?? null) !== (tgt.defaultValue ?? null)) {
      const i: Issue = {
        phase: PHASE,
        code: 'DEFAULT_MISMATCH',
        severity: Severity.INFO,
        table: tableName,
        column: src.name,
        message: `Default value differs.`,
        detail: { source: src.defaultValue, target: tgt.defaultValue },
      };
      changes.push(i);
      push(i);
    }

    columns.push({ column: src.name, source: src, target: tgt, changes });
  }

  // Target-only columns that are NOT NULL without a default would break inserts.
  for (const tgt of targetCols) {
    if (find(sourceCols, tgt.name)) continue;
    const severity =
      !tgt.nullable && tgt.defaultValue === null && !tgt.autoIncrement
        ? Severity.ERROR
        : Severity.INFO;
    const i: Issue = {
      phase: PHASE,
      code: 'TARGET_ONLY_COLUMN',
      severity,
      table: tableName,
      column: tgt.name,
      message:
        severity === Severity.ERROR
          ? `Target column "${tgt.name}" is NOT NULL without a default and has no source — inserts will fail.`
          : `Target has an extra column "${tgt.name}" (not in source).`,
    };
    push(i);
    columns.push({ column: tgt.name, source: null, target: tgt, changes: [i] });
  }

  return { columns, issues };
}
