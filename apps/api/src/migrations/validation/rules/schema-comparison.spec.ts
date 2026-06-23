import { compareTableColumns } from './schema-comparison';
import { Severity, type ColumnSummary } from '../types';

const col = (over: Partial<ColumnSummary>): ColumnSummary => ({
  name: 'c',
  dataType: 'varchar',
  columnType: 'varchar(255)',
  length: 255,
  precision: null,
  scale: null,
  nullable: true,
  defaultValue: null,
  charset: 'utf8mb4',
  collation: 'utf8mb4_0900_ai_ci',
  autoIncrement: false,
  unsigned: false,
  generated: false,
  isBlob: false,
  isText: false,
  isEnum: false,
  enumValues: [],
  ...over,
});

describe('compareTableColumns', () => {
  it('identical schema → no issues', () => {
    const c = col({ name: 'id' });
    const r = compareTableColumns('t', [c], [c]);
    expect(r.issues).toHaveLength(0);
  });

  it('narrowing varchar → ERROR', () => {
    const r = compareTableColumns(
      't',
      [col({ name: 'name', columnType: 'varchar(255)', length: 255 })],
      [col({ name: 'name', columnType: 'varchar(100)', length: 100 })],
    );
    expect(r.issues.some((i) => i.code === 'STRING_NARROWING' && i.severity === Severity.ERROR)).toBe(true);
  });

  it('missing target column → ERROR', () => {
    const r = compareTableColumns('t', [col({ name: 'extra' })], []);
    expect(r.issues.some((i) => i.code === 'TARGET_COLUMN_MISSING' && i.severity === Severity.ERROR)).toBe(true);
  });

  it('source NULL into target NOT NULL → ERROR', () => {
    const r = compareTableColumns(
      't',
      [col({ name: 'x', nullable: true })],
      [col({ name: 'x', nullable: false })],
    );
    expect(r.issues.some((i) => i.code === 'NULLABILITY_MISMATCH')).toBe(true);
  });

  it('charset mismatch → WARNING', () => {
    const r = compareTableColumns(
      't',
      [col({ name: 'x', charset: 'utf8mb4' })],
      [col({ name: 'x', charset: 'latin1' })],
    );
    expect(r.issues.some((i) => i.code === 'CHARSET_MISMATCH' && i.severity === Severity.WARNING)).toBe(true);
  });

  it('target-only NOT NULL column without default → ERROR', () => {
    const r = compareTableColumns(
      't',
      [],
      [col({ name: 'required', nullable: false, defaultValue: null })],
    );
    expect(r.issues.some((i) => i.code === 'TARGET_ONLY_COLUMN' && i.severity === Severity.ERROR)).toBe(true);
  });
});
