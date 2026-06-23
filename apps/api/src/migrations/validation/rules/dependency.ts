import type { DependencyAnalysis } from '../types';

export interface FkEdge {
  table: string;
  refTable: string;
}

/**
 * Build a migration dependency analysis from FK edges restricted to the
 * selected tables: topological order (parents first), parent/child maps,
 * circular dependency groups, and self-referencing tables.
 */
export function analyzeDependencies(
  tables: string[],
  edges: FkEdge[],
): DependencyAnalysis {
  const set = new Set(tables);
  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  const selfRef = new Set<string>();
  tables.forEach((t) => {
    parents[t] = [];
    children[t] = [];
  });

  const deps = new Map<string, Set<string>>();
  tables.forEach((t) => deps.set(t, new Set()));

  for (const e of edges) {
    if (!set.has(e.table) || !set.has(e.refTable)) continue;
    if (e.table === e.refTable) {
      selfRef.add(e.table);
      continue; // self-references don't affect ordering
    }
    if (!parents[e.table].includes(e.refTable)) parents[e.table].push(e.refTable);
    if (!children[e.refTable].includes(e.table)) children[e.refTable].push(e.table);
    deps.get(e.table)!.add(e.refTable);
  }

  // Kahn topological sort; leftover = part of a cycle.
  const order: string[] = [];
  const done = new Set<string>();
  let progressed = true;
  while (order.length < tables.length && progressed) {
    progressed = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...deps.get(t)!].every((d) => done.has(d))) {
        order.push(t);
        done.add(t);
        progressed = true;
      }
    }
  }

  // Detect circular dependency groups among the remaining tables.
  const remaining = tables.filter((t) => !done.has(t));
  const circular = findCycles(remaining, deps);
  // Append remaining (cyclic) tables so the plan still covers them.
  for (const t of remaining) {
    order.push(t);
    done.add(t);
  }

  return {
    order,
    parents,
    children,
    circular,
    selfReferencing: [...selfRef],
  };
}

function findCycles(nodes: string[], deps: Map<string, Set<string>>): string[][] {
  const nodeSet = new Set(nodes);
  const cycles: string[][] = [];
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let idx = 0;

  const strongConnect = (v: string) => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!nodeSet.has(w)) continue;
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) cycles.push(comp);
    }
  };

  for (const n of nodes) if (!index.has(n)) strongConnect(n);
  return cycles;
}
