import { describe, expect, it } from 'vitest';
import {
  Acceptance,
  advisoryIds,
  judge,
  loadAcceptances,
} from '../../../scripts/audit-dependencies';
import { resolve } from 'node:path';

const TODAY = '2026-08-28';

function advisory(name: string, severity: string, ids: string[] = []) {
  return {
    name,
    severity,
    isDirect: true,
    via: ids.map((id) => ({ title: id, url: `https://github.com/advisories/${id}` })),
  };
}

function acceptance(id: string, reviewBy: string): Acceptance {
  return {
    id,
    package: 'fastify',
    severity: 'high',
    title: 'something',
    acceptedOn: '2026-08-28',
    reviewBy,
    why: 'not reachable in this deployment',
  };
}

describe('advisoryIds', () => {
  it('pulls the identifiers out of the nested via list', () => {
    expect(advisoryIds(advisory('fastify', 'high', ['GHSA-aaaa-bbbb-cccc']))).toEqual([
      'GHSA-aaaa-bbbb-cccc',
    ]);
  });

  it('handles a via that is just a package name', () => {
    expect(advisoryIds({ name: 'x', severity: 'high', isDirect: false, via: ['other'] })).toEqual(
      [],
    );
  });
});

describe('judge', () => {
  it('is quiet about an empty report', () => {
    expect(judge({}, [], TODAY)).toEqual({
      total: 0,
      blocking: [],
      accepted: [],
      expired: [],
      bySeverity: {},
    });
  });

  it('counts by severity and blocks only on high or worse', () => {
    const verdict = judge(
      {
        vulnerabilities: {
          a: advisory('a', 'low'),
          b: advisory('b', 'moderate'),
          c: advisory('c', 'high', ['GHSA-1111-1111-1111']),
        },
      },
      [],
      TODAY,
    );
    expect(verdict.bySeverity).toEqual({ low: 1, moderate: 1, high: 1 });
    expect(verdict.blocking).toEqual(['c (high)']);
  });

  it('lets through an advisory that has been read and accepted', () => {
    const verdict = judge(
      { vulnerabilities: { f: advisory('fastify', 'high', ['GHSA-1111-1111-1111']) } },
      [acceptance('GHSA-1111-1111-1111', '2026-11-30')],
      TODAY,
    );
    expect(verdict.blocking).toEqual([]);
    expect(verdict.accepted).toEqual(['fastify (high): GHSA-1111-1111-1111']);
  });

  it('still blocks when the package picks up an advisory nobody has read', () => {
    const verdict = judge(
      {
        vulnerabilities: {
          f: advisory('fastify', 'high', ['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222']),
        },
      },
      [acceptance('GHSA-1111-1111-1111', '2026-11-30')],
      TODAY,
    );
    expect(verdict.blocking).toEqual(['fastify (high)']);
    expect(verdict.accepted).toEqual([]);
  });

  it('blocks an advisory carrying no identifier at all', () => {
    const verdict = judge(
      { vulnerabilities: { f: advisory('fastify', 'critical') } },
      [acceptance('GHSA-1111-1111-1111', '2026-11-30')],
      TODAY,
    );
    expect(verdict.blocking).toEqual(['fastify (critical)']);
  });

  it('fails once the acceptance is past its review date', () => {
    const verdict = judge(
      { vulnerabilities: { f: advisory('fastify', 'high', ['GHSA-1111-1111-1111']) } },
      [acceptance('GHSA-1111-1111-1111', '2026-08-27')],
      TODAY,
    );
    expect(verdict.accepted).toEqual([]);
    expect(verdict.expired[0]).toMatch(/GHSA-1111-1111-1111 on fastify, due for review 2026-08-27/);
  });

  it('holds on the review date itself', () => {
    const verdict = judge(
      { vulnerabilities: { f: advisory('fastify', 'high', ['GHSA-1111-1111-1111']) } },
      [acceptance('GHSA-1111-1111-1111', TODAY)],
      TODAY,
    );
    expect(verdict.expired).toEqual([]);
    expect(verdict.accepted).toHaveLength(1);
  });
});

describe('the register that ships', () => {
  const path = resolve(__dirname, '..', '..', '..', 'security-advisories.json');

  it('loads', () => {
    expect(loadAcceptances(path).length).toBeGreaterThan(0);
  });

  it('gives every acceptance an identifier, a reason and a review date', () => {
    for (const entry of loadAcceptances(path)) {
      expect(entry.id).toMatch(/^GHSA-/);
      expect(entry.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });

  it('has nothing on it that has already run out', () => {
    const today = new Date().toISOString().slice(0, 10);
    const stale = loadAcceptances(path).filter((entry) => entry.reviewBy < today);
    expect(stale.map((entry) => entry.id)).toEqual([]);
  });

  it('is an empty list rather than a throw when the file is not there', () => {
    expect(loadAcceptances('/nope/nowhere.json')).toEqual([]);
  });
});
