import { afterEach, describe, expect, it } from 'vitest';
import { Job, JobRegistry, JobReport, runJob } from '../../../src/jobs/runner';
import { NotFoundError } from '../../../src/core/errors';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';

afterEach(closeTestDatabases);

function context(dryRun = false) {
  const scenario = buildScenario({ today: '2026-03-10' });
  return {
    scenario,
    job: { app: scenario.context, today: scenario.today, dryRun },
  };
}

describe('JobReport', () => {
  it('counts a change and a skip apart', () => {
    const report = new JobReport();
    report.attempt('a', () => true);
    report.attempt('b', () => false);
    expect(report).toMatchObject({ processed: 2, changed: 1, skipped: 1 });
    expect(report.failures).toEqual([]);
  });

  it('records a failure instead of letting it out', () => {
    const report = new JobReport();
    expect(() =>
      report.attempt('t-1', () => {
        throw new NotFoundError('tank', 't-1');
      }),
    ).not.toThrow();
    expect(report.failures).toEqual([
      { subject: 't-1', error: 'not_found: no tank with id t-1 (what=tank id=t-1)' },
    ]);
  });

  it('counts a failure as processed but neither changed nor skipped', () => {
    const report = new JobReport();
    report.attempt('t-1', () => {
      throw new Error('boom');
    });
    expect(report).toMatchObject({ processed: 1, changed: 0, skipped: 0 });
  });

  it('keeps notes', () => {
    const report = new JobReport();
    report.note('tanks', 12);
    expect(report.detail).toEqual({ tanks: 12 });
  });
});

describe('runJob', () => {
  const counting: Job = {
    name: 'counting',
    description: 'counts to three',
    run(_context, report) {
      report.attempt('a', () => true);
      report.attempt('b', () => false);
      report.note('answer', 3);
    },
  };

  it('reports the counters and a duration', () => {
    const { job } = context();
    const result = runJob(counting, job);
    expect(result).toMatchObject({ name: 'counting', processed: 2, changed: 1, skipped: 1 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.detail).toEqual({ answer: 3 });
  });

  it('logs a start and a finish', () => {
    const { scenario, job } = context();
    runJob(counting, job);
    expect(scenario.sink.messages()).toEqual(
      expect.arrayContaining(['job started', 'job finished']),
    );
  });

  it('catches a job that falls over entirely', () => {
    const { job } = context();
    const broken: Job = {
      name: 'broken',
      description: 'throws',
      run() {
        throw new Error('the whole thing');
      },
    };
    const result = runJob(broken, job);
    expect(result.failures[0]?.subject).toBe('(the job itself)');
    expect(result.failures[0]?.error).toMatch(/the whole thing/);
  });

  it('warns rather than informs when something failed', () => {
    const { scenario, job } = context();
    runJob(
      {
        name: 'partly',
        description: '',
        run(_context, report) {
          report.attempt('a', () => {
            throw new Error('nope');
          });
        },
      },
      job,
    );
    expect(scenario.sink.at('warn').map((record) => record.msg)).toContain('job finished');
  });
});

describe('JobRegistry', () => {
  const job: Job = { name: 'a', description: '', run() {} };

  it('registers and finds', () => {
    const registry = new JobRegistry().register(job);
    expect(registry.get('a')).toBe(job);
    expect(registry.names()).toEqual(['a']);
  });

  it('refuses two jobs with one name', () => {
    const registry = new JobRegistry().register(job);
    expect(() => registry.register(job)).toThrowError(/two jobs called "a"/);
  });

  it('names the alternatives when asked for one it does not have', () => {
    const registry = new JobRegistry().register(job);
    expect(() => registry.get('b')).toThrowError(/no job called "b", try one of: a/);
  });

  it('lists in name order', () => {
    const registry = new JobRegistry()
      .register({ ...job, name: 'z' })
      .register({ ...job, name: 'm' })
      .register(job);
    expect(registry.all().map((entry) => entry.name)).toEqual(['a', 'm', 'z']);
  });
});
