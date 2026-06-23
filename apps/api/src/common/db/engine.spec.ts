import {
  DEFAULT_PORTS,
  normalizeEngine,
  quoteIdent,
  parserDialect,
} from './engine';

describe('engine helpers', () => {
  describe('normalizeEngine', () => {
    it('defaults unknown/legacy values to mysql', () => {
      expect(normalizeEngine(null)).toBe('mysql');
      expect(normalizeEngine(undefined)).toBe('mysql');
      expect(normalizeEngine('')).toBe('mysql');
      expect(normalizeEngine('maria')).toBe('mysql');
    });

    it('recognises postgres aliases', () => {
      expect(normalizeEngine('postgres')).toBe('postgres');
      expect(normalizeEngine('postgresql')).toBe('postgres');
      expect(normalizeEngine('PG')).toBe('postgres');
      expect(normalizeEngine(' Postgres ')).toBe('postgres');
    });
  });

  describe('quoteIdent', () => {
    it('uses backticks for mysql', () => {
      expect(quoteIdent('mysql', 'users')).toBe('`users`');
    });

    it('uses double quotes for postgres and escapes embedded quotes', () => {
      expect(quoteIdent('postgres', 'Order')).toBe('"Order"');
      expect(quoteIdent('postgres', 'we"ird')).toBe('"we""ird"');
    });

    it('rejects a backtick in a mysql identifier', () => {
      expect(() => quoteIdent('mysql', 'a`b')).toThrow();
    });
  });

  it('maps engines to parser dialects and default ports', () => {
    expect(parserDialect('mysql')).toBe('MySQL');
    expect(parserDialect('postgres')).toBe('PostgreSQL');
    expect(DEFAULT_PORTS.mysql).toBe(3306);
    expect(DEFAULT_PORTS.postgres).toBe(5432);
  });
});
