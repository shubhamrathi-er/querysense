import {
  Severity,
  type Issue,
  type ReadinessScore,
  type ReadinessStatus,
} from '../types';

export function bySeverity(issues: Issue[], sev: Severity): Issue[] {
  return issues.filter((i) => i.severity === sev);
}

export function hasBlockers(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === Severity.BLOCKER);
}

/** Map a phase to a scoring category. */
function category(phase: string): string {
  if (phase === 'source' || phase === 'target' || phase === 'connection') return 'connection';
  if (phase === 'schema') return 'schema';
  if (phase === 'data' || phase === 'nullability' || phase === 'duplicate') return 'data';
  if (phase === 'dependency') return 'dependency';
  return 'constraint';
}

const WEIGHTS: Record<string, number> = {
  connection: 25,
  schema: 25,
  data: 25,
  dependency: 15,
  constraint: 10,
};

const PENALTY: Record<Severity, number> = {
  [Severity.BLOCKER]: 100,
  [Severity.ERROR]: 35,
  [Severity.WARNING]: 8,
  [Severity.INFO]: 0,
};

export function computeReadiness(issues: Issue[]): ReadinessScore {
  const sub: Record<string, number> = {
    connection: 100,
    schema: 100,
    data: 100,
    dependency: 100,
    constraint: 100,
  };

  for (const issue of issues) {
    const cat = category(issue.phase);
    sub[cat] = Math.max(0, (sub[cat] ?? 100) - PENALTY[issue.severity]);
  }

  let score = 0;
  for (const [cat, weight] of Object.entries(WEIGHTS)) {
    score += (weight * (sub[cat] ?? 100)) / 100;
  }

  const blockers = bySeverity(issues, Severity.BLOCKER);
  const errors = bySeverity(issues, Severity.ERROR);
  const warnings = bySeverity(issues, Severity.WARNING);

  let status: ReadinessStatus;
  if (blockers.length > 0 || errors.length > 0) status = 'NOT_READY';
  else if (warnings.length > 0) status = 'READY_WITH_WARNINGS';
  else status = 'READY';

  // A blocker can never look "mostly ready".
  if (blockers.length > 0) score = Math.min(score, 30);

  return {
    score: Math.round(score),
    status,
    blockers,
    warnings,
    breakdown: sub,
  };
}
