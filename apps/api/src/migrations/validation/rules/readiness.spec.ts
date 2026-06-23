import { computeReadiness, hasBlockers } from './readiness';
import { Severity, type Issue } from '../types';

const issue = (phase: string, severity: Severity): Issue => ({
  phase,
  code: 'X',
  severity,
  message: 'm',
});

describe('computeReadiness', () => {
  it('clean → READY, score 100', () => {
    const r = computeReadiness([]);
    expect(r.status).toBe('READY');
    expect(r.score).toBe(100);
  });

  it('only warnings → READY_WITH_WARNINGS', () => {
    const r = computeReadiness([issue('schema', Severity.WARNING)]);
    expect(r.status).toBe('READY_WITH_WARNINGS');
    expect(r.score).toBeLessThan(100);
    expect(r.warnings).toHaveLength(1);
  });

  it('errors → NOT_READY', () => {
    const r = computeReadiness([issue('schema', Severity.ERROR)]);
    expect(r.status).toBe('NOT_READY');
  });

  it('blocker → NOT_READY and capped score', () => {
    const r = computeReadiness([issue('source', Severity.BLOCKER)]);
    expect(r.status).toBe('NOT_READY');
    expect(r.blockers).toHaveLength(1);
    expect(r.score).toBeLessThanOrEqual(30);
  });

  it('breaks score down per category', () => {
    const r = computeReadiness([issue('data', Severity.ERROR)]);
    expect(r.breakdown.data).toBeLessThan(100);
    expect(r.breakdown.connection).toBe(100);
  });
});

describe('hasBlockers', () => {
  it('true when a blocker present', () => {
    expect(hasBlockers([issue('source', Severity.BLOCKER)])).toBe(true);
  });
  it('false otherwise', () => {
    expect(hasBlockers([issue('schema', Severity.ERROR)])).toBe(false);
  });
});
