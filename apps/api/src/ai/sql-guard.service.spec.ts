import { SqlGuardService } from './sql-guard.service';

describe('SqlGuardService', () => {
  const guard = new SqlGuardService();

  describe('checkStructure (subquery depth)', () => {
    it('allows a flat query', () => {
      expect(guard.checkStructure('SELECT id FROM users').allowed).toBe(true);
    });

    it('allows a moderately nested query', () => {
      const sql =
        'SELECT * FROM (SELECT id FROM (SELECT id FROM users) a) b';
      expect(guard.checkStructure(sql).allowed).toBe(true);
    });

    it('blocks excessively nested subqueries', () => {
      const sql =
        'SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT id FROM users) a) b) c) d';
      const res = guard.checkStructure(sql);
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/nests subqueries/);
    });
  });

  describe('evaluateExplain (scan size)', () => {
    it('allows small estimated scans', () => {
      const res = guard.evaluateExplain([{ rows: 100 }, { rows: 50 }]);
      expect(res.allowed).toBe(true);
    });

    it('blocks scans above the threshold', () => {
      // 2000 * 2000 = 4,000,000 > 1,000,000
      const res = guard.evaluateExplain([{ rows: 2000 }, { rows: 2000 }]);
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/would scan/);
    });

    it('handles missing/odd row estimates safely', () => {
      const res = guard.evaluateExplain([{}, { rows: null }]);
      expect(res.allowed).toBe(true);
    });
  });

  describe('cappedPageSize', () => {
    it('caps to the maximum', () => {
      expect(guard.cappedPageSize(10000)).toBe(guard.MAX_PAGE_SIZE);
    });
    it('keeps a reasonable request', () => {
      expect(guard.cappedPageSize(50)).toBe(50);
    });
    it('falls back to 50 for garbage input', () => {
      expect(guard.cappedPageSize(0)).toBe(50);
      expect(guard.cappedPageSize(NaN)).toBe(50);
    });
  });
});
