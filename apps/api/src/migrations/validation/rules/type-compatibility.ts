import { Severity } from '../types';

export interface ParsedType {
  base: string; // lowercase base, e.g. 'varchar', 'int', 'decimal'
  length: number | null; // for char/binary types
  precision: number | null; // for decimal/numeric
  scale: number | null;
  unsigned: boolean;
  enumValues: string[];
  raw: string;
}

const INT_RANGES: Record<string, { signed: bigint; unsigned: bigint }> = {
  tinyint: { signed: 127n, unsigned: 255n },
  smallint: { signed: 32767n, unsigned: 65535n },
  mediumint: { signed: 8388607n, unsigned: 16777215n },
  int: { signed: 2147483647n, unsigned: 4294967295n },
  integer: { signed: 2147483647n, unsigned: 4294967295n },
  bigint: { signed: 9223372036854775807n, unsigned: 18446744073709551615n },
};

const INT_ORDER = ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'];
const TEXT_ORDER = ['tinytext', 'text', 'mediumtext', 'longtext'];
const BLOB_ORDER = ['tinyblob', 'blob', 'mediumblob', 'longblob'];

export function parseType(columnType: string): ParsedType {
  const raw = (columnType ?? '').trim();
  const lower = raw.toLowerCase();
  const unsigned = /\bunsigned\b/.test(lower);
  const base = (lower.match(/^[a-z]+/) ?? ['unknown'])[0];

  let length: number | null = null;
  let precision: number | null = null;
  let scale: number | null = null;
  let enumValues: string[] = [];

  if (base === 'enum' || base === 'set') {
    const inner = lower.match(/\((.*)\)/)?.[1] ?? '';
    enumValues = inner
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0);
  } else {
    const nums = lower.match(/\(([^)]+)\)/)?.[1];
    if (nums) {
      const parts = nums.split(',').map((n) => parseInt(n.trim(), 10));
      if (base === 'decimal' || base === 'numeric' || base === 'float' || base === 'double') {
        precision = Number.isFinite(parts[0]) ? parts[0] : null;
        scale = Number.isFinite(parts[1]) ? parts[1] : 0;
      } else {
        length = Number.isFinite(parts[0]) ? parts[0] : null;
      }
    }
  }

  return { base, length, precision, scale, unsigned, enumValues, raw };
}

const isIntFamily = (b: string) => INT_ORDER.includes(b);
const isTextFamily = (b: string) => TEXT_ORDER.includes(b);
const isBlobFamily = (b: string) => BLOB_ORDER.includes(b);
const isCharFamily = (b: string) => b === 'varchar' || b === 'char';
const isDecimalFamily = (b: string) =>
  b === 'decimal' || b === 'numeric' || b === 'float' || b === 'double';

export interface TypeChangeResult {
  severity: Severity;
  code: string;
  message: string;
}

/**
 * Classify the impact of migrating a value of `source` type into a `target`
 * column type. Narrowing that risks data loss → ERROR; safe widening → WARNING;
 * identical → INFO.
 */
export function classifyTypeChange(
  sourceType: string,
  targetType: string,
): TypeChangeResult {
  const s = parseType(sourceType);
  const t = parseType(targetType);

  if (s.raw.toLowerCase() === t.raw.toLowerCase()) {
    return { severity: Severity.INFO, code: 'TYPE_SAME', message: 'Types identical.' };
  }

  // ── char/varchar length ──
  if (isCharFamily(s.base) && isCharFamily(t.base)) {
    const sl = s.length ?? 0;
    const tl = t.length ?? 0;
    if (tl < sl) {
      return {
        severity: Severity.ERROR,
        code: 'STRING_NARROWING',
        message: `${s.raw} → ${t.raw} shrinks length (${sl}→${tl}); values may be truncated.`,
      };
    }
    if (tl > sl) {
      return {
        severity: Severity.WARNING,
        code: 'STRING_WIDENING',
        message: `${s.raw} → ${t.raw} widens length (${sl}→${tl}).`,
      };
    }
    return { severity: Severity.INFO, code: 'TYPE_SAME', message: 'Same length.' };
  }

  // TEXT → VARCHAR is lossy; VARCHAR → TEXT is safe widening
  if (isTextFamily(s.base) && isCharFamily(t.base)) {
    return {
      severity: Severity.ERROR,
      code: 'TEXT_TO_VARCHAR',
      message: `${s.raw} → ${t.raw} can truncate long text.`,
    };
  }
  if (isCharFamily(s.base) && isTextFamily(t.base)) {
    return {
      severity: Severity.WARNING,
      code: 'VARCHAR_TO_TEXT',
      message: `${s.raw} → ${t.raw} widens to text.`,
    };
  }
  if (isTextFamily(s.base) && isTextFamily(t.base)) {
    const si = TEXT_ORDER.indexOf(s.base);
    const ti = TEXT_ORDER.indexOf(t.base);
    return ti < si
      ? { severity: Severity.ERROR, code: 'TEXT_NARROWING', message: `${s.raw} → ${t.raw} reduces capacity.` }
      : { severity: Severity.WARNING, code: 'TEXT_WIDENING', message: `${s.raw} → ${t.raw}.` };
  }

  // ── integer family ──
  if (isIntFamily(s.base) && isIntFamily(t.base)) {
    const si = INT_ORDER.indexOf(s.base);
    const ti = INT_ORDER.indexOf(t.base);
    if (ti < si) {
      return {
        severity: Severity.ERROR,
        code: 'INT_NARROWING',
        message: `${s.raw} → ${t.raw} narrows integer range; values may overflow.`,
      };
    }
    if (ti > si) {
      return {
        severity: Severity.WARNING,
        code: 'INT_WIDENING',
        message: `${s.raw} → ${t.raw} widens integer range.`,
      };
    }
    // same base — check signedness
    if (s.unsigned && !t.unsigned) {
      return {
        severity: Severity.ERROR,
        code: 'UNSIGNED_TO_SIGNED',
        message: `${s.raw} → ${t.raw} (unsigned→signed) halves the positive range.`,
      };
    }
    return { severity: Severity.WARNING, code: 'INT_SIGN_CHANGE', message: `${s.raw} → ${t.raw}.` };
  }

  // ── decimal/numeric precision & scale ──
  if (isDecimalFamily(s.base) && isDecimalFamily(t.base)) {
    const sp = s.precision ?? 0;
    const ss = s.scale ?? 0;
    const tp = t.precision ?? 0;
    const ts = t.scale ?? 0;
    const sIntDigits = sp - ss;
    const tIntDigits = tp - ts;
    if (tIntDigits < sIntDigits || ts < ss) {
      return {
        severity: Severity.ERROR,
        code: 'DECIMAL_NARROWING',
        message: `${s.raw} → ${t.raw} reduces precision/scale; values may be rounded or overflow.`,
      };
    }
    return { severity: Severity.WARNING, code: 'DECIMAL_WIDENING', message: `${s.raw} → ${t.raw}.` };
  }

  // ── enum ──
  if (s.base === 'enum' && t.base === 'enum') {
    const missing = s.enumValues.filter((v) => !t.enumValues.includes(v));
    return missing.length
      ? {
          severity: Severity.ERROR,
          code: 'ENUM_VALUE_MISSING',
          message: `Target enum is missing value(s): ${missing.join(', ')}.`,
        }
      : { severity: Severity.INFO, code: 'ENUM_OK', message: 'Enum values compatible.' };
  }

  // ── blob ──
  if (isBlobFamily(s.base) && isBlobFamily(t.base)) {
    const si = BLOB_ORDER.indexOf(s.base);
    const ti = BLOB_ORDER.indexOf(t.base);
    return ti < si
      ? { severity: Severity.ERROR, code: 'BLOB_NARROWING', message: `${s.raw} → ${t.raw} reduces capacity.` }
      : { severity: Severity.WARNING, code: 'BLOB_WIDENING', message: `${s.raw} → ${t.raw}.` };
  }

  // ── cross-family change ──
  // Numeric → string is generally safe; string → numeric or other is risky.
  if (isIntFamily(s.base) || isDecimalFamily(s.base)) {
    if (isCharFamily(t.base) || isTextFamily(t.base)) {
      return { severity: Severity.WARNING, code: 'NUMERIC_TO_STRING', message: `${s.raw} → ${t.raw}.` };
    }
  }
  return {
    severity: Severity.ERROR,
    code: 'TYPE_FAMILY_CHANGE',
    message: `${s.raw} → ${t.raw} changes type family; conversion may fail or lose data.`,
  };
}

/** Largest value that fits an integer type, for overflow checks. */
export function intMax(base: string, unsigned: boolean): bigint | null {
  const r = INT_RANGES[base];
  if (!r) return null;
  return unsigned ? r.unsigned : r.signed;
}
