import { DayKey } from '../../util/dates';
import { Db } from '../connection';
import { WhereClause, limitOf } from '../query';

/**
 * The audit trail. Append only: there is no update and no delete on this
 * repository, and that is not an oversight.
 */

export type SubjectKind = 'customer' | 'tank' | 'delivery' | 'route' | 'plan' | 'price' | 'truck';

export interface AuditEntry {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly requestId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly note?: string;
}

export interface AuditDraft {
  readonly actor: string;
  readonly action: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly requestId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly note?: string;
}

interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  request_id: string | null;
  before_json: string | null;
  after_json: string | null;
  note: string | null;
}

function parse(value: string | null): unknown {
  if (value === null) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    // A row that cannot be parsed is still worth showing, because the fact that
    // something happened matters more than being able to read the detail.
    return { unreadable: value.slice(0, 200) };
  }
}

function toEntry(row: AuditRow): AuditEntry {
  const before = parse(row.before_json);
  const after = parse(row.after_json);
  return {
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    subjectKind: row.subject_kind as SubjectKind,
    subjectId: row.subject_id,
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(row.note ? { note: row.note } : {}),
  };
}

export interface AuditQuery {
  readonly subjectKind?: SubjectKind;
  readonly subjectId?: string;
  readonly actor?: string;
  readonly action?: string;
  readonly from?: DayKey;
  readonly to?: DayKey;
  readonly limit?: number;
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  record(id: string, at: Date, draft: AuditDraft): AuditEntry {
    this.db
      .prepare(
        `INSERT INTO audit_entries (id, at, actor, action, subject_kind, subject_id,
           request_id, before_json, after_json, note)
         VALUES (@id, @at, @actor, @action, @subjectKind, @subjectId,
           @requestId, @before, @after, @note)`,
      )
      .run({
        id,
        at: at.toISOString(),
        actor: draft.actor,
        action: draft.action,
        subjectKind: draft.subjectKind,
        subjectId: draft.subjectId,
        requestId: draft.requestId ?? null,
        before: draft.before === undefined ? null : JSON.stringify(draft.before),
        after: draft.after === undefined ? null : JSON.stringify(draft.after),
        note: draft.note ?? null,
      });
    return this.get(id);
  }

  get(id: string): AuditEntry {
    const row = this.db
      .prepare<[string], AuditRow>('SELECT * FROM audit_entries WHERE id = ?')
      .get(id);
    if (!row) {
      throw new Error(`no audit entry with id ${id}`);
    }
    return toEntry(row);
  }

  list(query: AuditQuery = {}): AuditEntry[] {
    const where = new WhereClause()
      .eq('subject_kind', 'subjectKind', query.subjectKind)
      .eq('subject_id', 'subjectId', query.subjectId)
      .eq('actor', 'actor', query.actor)
      .eq('action', 'action', query.action)
      .gte('at', 'from', query.from)
      .lte('at', 'to', query.to ? `${query.to}T23:59:59.999Z` : undefined);
    return this.db
      .prepare<Record<string, unknown>, AuditRow>(
        `SELECT * FROM audit_entries ${where.sql} ORDER BY at DESC, id DESC LIMIT @limit`,
      )
      .all(where.bind({ limit: limitOf(query.limit ?? 200) }))
      .map(toEntry);
  }

  /** Everything that ever happened to one thing, oldest first. */
  history(subjectKind: SubjectKind, subjectId: string): AuditEntry[] {
    return this.db
      .prepare<[string, string], AuditRow>(
        `SELECT * FROM audit_entries WHERE subject_kind = ? AND subject_id = ?
          ORDER BY at, id`,
      )
      .all(subjectKind, subjectId)
      .map(toEntry);
  }

  count(query: AuditQuery = {}): number {
    return this.list({ ...query, limit: -1 }).length;
  }
}
