import { classifyTypeChange, parseType, intMax } from './type-compatibility';
import { Severity } from '../types';

describe('parseType', () => {
  it('parses varchar length', () => {
    expect(parseType('varchar(255)')).toMatchObject({ base: 'varchar', length: 255 });
  });
  it('parses decimal precision/scale', () => {
    expect(parseType('decimal(20,6)')).toMatchObject({ base: 'decimal', precision: 20, scale: 6 });
  });
  it('parses unsigned int', () => {
    expect(parseType('int unsigned')).toMatchObject({ base: 'int', unsigned: true });
  });
  it('parses enum values', () => {
    expect(parseType("enum('a','b','c')").enumValues).toEqual(['a', 'b', 'c']);
  });
});

describe('classifyTypeChange', () => {
  const sev = (a: string, b: string) => classifyTypeChange(a, b).severity;

  it('identical types → INFO', () => {
    expect(sev('varchar(100)', 'varchar(100)')).toBe(Severity.INFO);
  });

  it('VARCHAR widening → WARNING', () => {
    expect(sev('varchar(100)', 'varchar(255)')).toBe(Severity.WARNING);
  });
  it('VARCHAR narrowing → ERROR', () => {
    expect(sev('varchar(255)', 'varchar(100)')).toBe(Severity.ERROR);
  });

  it('INT → BIGINT → WARNING', () => {
    expect(sev('int', 'bigint')).toBe(Severity.WARNING);
  });
  it('BIGINT → INT → ERROR', () => {
    expect(sev('bigint', 'int')).toBe(Severity.ERROR);
  });
  it('unsigned → signed same base → ERROR', () => {
    expect(sev('int unsigned', 'int')).toBe(Severity.ERROR);
  });

  it('TEXT → VARCHAR → ERROR', () => {
    expect(sev('text', 'varchar(255)')).toBe(Severity.ERROR);
  });
  it('VARCHAR → TEXT → WARNING', () => {
    expect(sev('varchar(255)', 'text')).toBe(Severity.WARNING);
  });

  it('DECIMAL narrowing precision/scale → ERROR', () => {
    expect(sev('decimal(20,6)', 'decimal(10,2)')).toBe(Severity.ERROR);
  });
  it('DECIMAL widening → WARNING', () => {
    expect(sev('decimal(10,2)', 'decimal(20,6)')).toBe(Severity.WARNING);
  });

  it('enum losing a value → ERROR', () => {
    expect(sev("enum('a','b','c')", "enum('a','b')")).toBe(Severity.ERROR);
  });
  it('enum superset → INFO', () => {
    expect(sev("enum('a','b')", "enum('a','b','c')")).toBe(Severity.INFO);
  });

  it('numeric → string → WARNING', () => {
    expect(sev('int', 'varchar(50)')).toBe(Severity.WARNING);
  });
  it('unrelated family change → ERROR', () => {
    expect(sev('datetime', 'int')).toBe(Severity.ERROR);
  });
});

describe('intMax', () => {
  it('int signed', () => {
    expect(intMax('int', false)).toBe(2147483647n);
  });
  it('bigint unsigned', () => {
    expect(intMax('bigint', true)).toBe(18446744073709551615n);
  });
  it('unknown base → null', () => {
    expect(intMax('weird', false)).toBeNull();
  });
});
