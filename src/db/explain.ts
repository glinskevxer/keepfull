import { Db } from './connection';

/**
 * Asking sqlite what it is going to do.
 *
 * This is a test helper as much as a diagnostic. An index that is present and
 * an index that is used are different things, and the only way to hold the
 * difference still is to assert on the plan. Three of the indexes in migration
 * ten exist because a test like that failed.
 */

export interface PlanStep {
  readonly id: number;
  readonly parent: number;
  readonly detail: string;
}

export function explain(db: Db, sql: string, params: unknown[] = []): PlanStep[] {
  const rows = db
    .prepare<unknown[], { id: number; parent: number; detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params);
  return rows.map((row) => ({ id: row.id, parent: row.parent, detail: row.detail }));
}

/** Whether the planner said it would scan a whole table. */
export function scansTable(plan: readonly PlanStep[], table: string): boolean {
  return plan.some((step) => step.detail.startsWith(`SCAN ${table}`));
}

/** Which indexes the planner said it would use. */
export function indexesUsed(plan: readonly PlanStep[]): string[] {
  const found = new Set<string>();
  for (const step of plan) {
    const match = /USING (?:COVERING )?INDEX ([A-Za-z0-9_]+)/.exec(step.detail);
    if (match?.[1]) {
      found.add(match[1]);
    }
  }
  return [...found].sort();
}

export function describePlan(plan: readonly PlanStep[]): string {
  return plan.map((step) => step.detail).join('\n');
}
