import { AppContext } from './context';
import { AuditDraft, AuditEntry, SubjectKind } from '../db/repo/audit-repo';

/**
 * Writing to the audit trail.
 *
 * The actor is threaded through explicitly rather than pulled from some ambient
 * context. That is more typing at every call site and it is deliberate: the one
 * thing this trail cannot afford is to be wrong about who did something, and an
 * ambient actor is exactly how a nightly job ends up recorded as whoever last
 * logged in.
 */

export const SYSTEM_ACTOR = 'system';

export interface AuditContext {
  readonly actor: string;
  readonly requestId?: string;
}

export class AuditService {
  constructor(private readonly context: AppContext) {}

  record(who: AuditContext, draft: Omit<AuditDraft, 'actor' | 'requestId'>): AuditEntry {
    return this.context.audit.record(this.context.ids.next('aud'), this.context.clock(), {
      ...draft,
      actor: who.actor,
      ...(who.requestId ? { requestId: who.requestId } : {}),
    });
  }

  /** Records a change, working out the difference so the trail stays readable. */
  recordChange<T extends object>(
    who: AuditContext,
    action: string,
    subjectKind: SubjectKind,
    subjectId: string,
    before: T,
    after: T,
    note?: string,
  ): AuditEntry | undefined {
    const changed = changedFields(before, after);
    if (Object.keys(changed.after).length === 0) {
      return undefined;
    }
    return this.record(who, {
      action,
      subjectKind,
      subjectId,
      before: changed.before,
      after: changed.after,
      ...(note ? { note } : {}),
    });
  }

  history(subjectKind: SubjectKind, subjectId: string): AuditEntry[] {
    return this.context.audit.history(subjectKind, subjectId);
  }

  /** What one person did in a window, which is what a dispute actually asks. */
  byActor(actor: string, limit = 100): AuditEntry[] {
    return this.context.audit.list({ actor, limit });
  }
}

/**
 * Only the fields that actually moved. Storing the whole object either side
 * makes a trail nobody reads, because the change is buried in forty unchanged
 * fields.
 */
export function changedFields<T extends object>(
  before: T,
  after: T,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  for (const key of keys) {
    const left = (before as Record<string, unknown>)[key];
    const right = (after as Record<string, unknown>)[key];
    if (!same(left, right)) {
      beforeOut[key] = left;
      afterOut[key] = right;
    }
  }
  return { before: beforeOut, after: afterOut };
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || left === undefined || right === undefined) {
    return false;
  }
  if (typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
