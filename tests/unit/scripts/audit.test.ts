import { describe, expect, it } from 'vitest';
import { judge } from '../../../scripts/audit-dependencies';

describe('judge', () => {
  it('is quiet about an empty report', () => {
    expect(judge({})).toEqual({ total: 0, blocking: [], bySeverity: {} });
  });

  it('counts by severity', () => {
    const verdict = judge({
      vulnerabilities: {
        a: { name: 'a', severity: 'low', via: [], isDirect: false },
        b: { name: 'b', severity: 'low', via: [], isDirect: false },
        c: { name: 'c', severity: 'moderate', via: [], isDirect: true },
      },
    });
    expect(verdict.total).toBe(3);
    expect(verdict.bySeverity).toEqual({ low: 2, moderate: 1 });
  });

  it('blocks only on high and critical', () => {
    const verdict = judge({
      vulnerabilities: {
        a: { name: 'a', severity: 'moderate', via: [], isDirect: false },
        b: { name: 'b', severity: 'high', via: [], isDirect: false },
        c: { name: 'c', severity: 'critical', via: [], isDirect: true },
      },
    });
    expect(verdict.blocking).toEqual(['b (high)', 'c (critical)']);
  });

  it('sorts the blocking list so the output does not churn', () => {
    const verdict = judge({
      vulnerabilities: {
        z: { name: 'z', severity: 'high', via: [], isDirect: false },
        a: { name: 'a', severity: 'high', via: [], isDirect: false },
      },
    });
    expect(verdict.blocking).toEqual(['a (high)', 'z (high)']);
  });
});
