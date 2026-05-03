import { afterEach, describe, expect, it } from 'vitest';
import { AuditRepository } from '../../../src/db/repo/audit-repo';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function repo() {
  return new AuditRepository(testDatabase());
}

const at = (iso: string) => new Date(iso);

describe('record', () => {
  it('round trips an entry with both sides of the change', () => {
    const audit = repo();
    const entry = audit.record('a-1', at('2026-05-04T09:00:00Z'), {
      actor: 'office screens',
      action: 'void',
      subjectKind: 'delivery',
      subjectId: 'dlv-1',
      requestId: 'req-1',
      before: { status: 'posted' },
      after: { status: 'void' },
      note: 'wrong tank',
    });
    expect(entry).toEqual({
      id: 'a-1',
      at: '2026-05-04T09:00:00.000Z',
      actor: 'office screens',
      action: 'void',
      subjectKind: 'delivery',
      subjectId: 'dlv-1',
      requestId: 'req-1',
      before: { status: 'posted' },
      after: { status: 'void' },
      note: 'wrong tank',
    });
  });

  it('takes an entry with no before and no after', () => {
    const entry = repo().record('a-1', at('2026-05-04T09:00:00Z'), {
      actor: 'cron',
      action: 'seed',
      subjectKind: 'customer',
      subjectId: 'cus-1',
    });
    expect(entry.before).toBeUndefined();
    expect(entry.after).toBeUndefined();
  });

  it('throws for an id it does not hold', () => {
    expect(() => repo().get('a-9')).toThrowError(/no audit entry with id a-9/);
  });
});

describe('list', () => {
  function seeded() {
    const audit = repo();
    audit.record('a-1', at('2026-05-01T09:00:00Z'), {
      actor: 'office',
      action: 'create',
      subjectKind: 'customer',
      subjectId: 'cus-1',
    });
    audit.record('a-2', at('2026-05-03T09:00:00Z'), {
      actor: 'handhelds',
      action: 'post',
      subjectKind: 'delivery',
      subjectId: 'dlv-1',
    });
    audit.record('a-3', at('2026-05-05T09:00:00Z'), {
      actor: 'office',
      action: 'void',
      subjectKind: 'delivery',
      subjectId: 'dlv-1',
    });
    return audit;
  }

  it('returns newest first', () => {
    expect(
      seeded()
        .list()
        .map((entry) => entry.id),
    ).toEqual(['a-3', 'a-2', 'a-1']);
  });

  it('filters by subject, actor and action', () => {
    const audit = seeded();
    expect(audit.list({ subjectKind: 'delivery' })).toHaveLength(2);
    expect(audit.list({ subjectId: 'dlv-1' })).toHaveLength(2);
    expect(audit.list({ actor: 'office' })).toHaveLength(2);
    expect(audit.list({ action: 'void' })).toHaveLength(1);
  });

  it('filters by day range, including everything on the last day', () => {
    const audit = seeded();
    expect(audit.list({ from: dayKey('2026-05-03'), to: dayKey('2026-05-05') })).toHaveLength(2);
    expect(audit.list({ to: dayKey('2026-05-01') })).toHaveLength(1);
  });

  it('caps the rows', () => {
    expect(seeded().list({ limit: 1 })).toHaveLength(1);
  });

  it('counts without the cap', () => {
    expect(seeded().count({ subjectKind: 'delivery' })).toBe(2);
  });

  it('gives one subject history oldest first', () => {
    expect(
      seeded()
        .history('delivery', 'dlv-1')
        .map((entry) => entry.id),
    ).toEqual(['a-2', 'a-3']);
  });
});
