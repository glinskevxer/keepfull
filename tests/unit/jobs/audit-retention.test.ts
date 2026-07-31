import { afterEach, describe, expect, it } from 'vitest';
import { AUDIT_RETENTION_DAYS, auditRetention } from '../../../src/jobs/audit-retention';
import { buildJobRegistry } from '../../../src/jobs';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { runJob } from '../../../src/jobs/runner';

afterEach(closeTestDatabases);

function setup(today = '2026-07-29') {
  const scenario = buildScenario({ today });
  return { scenario, job: { app: scenario.context, today: scenario.today, dryRun: false } };
}

function entry(scenario: ReturnType<typeof setup>['scenario'], id: string, at: string) {
  scenario.context.audit.record(id, new Date(at), {
    actor: 'office',
    action: 'update',
    subjectKind: 'customer',
    subjectId: 'cus-1',
  });
}

describe('the registry', () => {
  it('carries the audit retention job', () => {
    expect(buildJobRegistry().names()).toContain('audit-retention');
  });
});

describe('audit-retention', () => {
  it('keeps seven years', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(2555);
  });

  it('leaves recent entries alone', () => {
    const { scenario, job } = setup();
    entry(scenario, 'a-1', '2026-01-01T00:00:00Z');
    const result = runJob(auditRetention, job);
    expect(result.changed).toBe(0);
    expect(scenario.context.audit.count()).toBe(1);
  });

  it('drops what is past the window', () => {
    const { scenario, job } = setup();
    entry(scenario, 'a-old', '2015-01-01T00:00:00Z');
    entry(scenario, 'a-new', '2026-01-01T00:00:00Z');
    const result = runJob(auditRetention, job);
    expect(result.changed).toBe(1);
    expect(scenario.context.audit.count()).toBe(1);
  });

  it('deletes nothing on a dry run but still counts', () => {
    const { scenario, job } = setup();
    entry(scenario, 'a-old', '2015-01-01T00:00:00Z');
    const result = runJob(auditRetention, { ...job, dryRun: true });
    expect(result.detail.doomed).toBe(1);
    expect(result.detail.deleted).toBe(0);
    expect(scenario.context.audit.count()).toBe(1);
  });

  it('reports the cutoff it used', () => {
    const { job } = setup();
    expect(runJob(auditRetention, job).detail.cutoff).toBe('2019-07-31');
  });

  it('says so in the log when it took something', () => {
    const { scenario, job } = setup();
    entry(scenario, 'a-old', '2015-01-01T00:00:00Z');
    runJob(auditRetention, job);
    expect(scenario.sink.messages()).toContain('trimmed the audit trail');
  });
});

describe('the floor the repository enforces', () => {
  it('refuses a cutoff inside the retention window', () => {
    const { scenario } = setup();
    expect(() =>
      scenario.context.audit.purgeBefore('2026-01-01' as never, AUDIT_RETENTION_DAYS),
    ).toThrowError(/kept for 2555 days/);
  });

  it('allows one outside it', () => {
    const { scenario } = setup();
    entry(scenario, 'a-old', '2015-01-01T00:00:00Z');
    expect(scenario.context.audit.purgeBefore('2016-01-01' as never, AUDIT_RETENTION_DAYS)).toBe(1);
  });
});
