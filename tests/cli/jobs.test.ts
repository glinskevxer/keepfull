import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario, seedCleanHistory } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { run } from '../../src/cli/program';

afterEach(() => {
  process.exitCode = undefined;
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  seedCleanHistory(scenario);
  return { scenario, ...cliDeps(scenario) };
}

describe('jobs list', () => {
  it('names what cron can ask for', async () => {
    const { deps, writer } = setup();
    const result = await run(['jobs', 'list'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/nightly-forecast/);
    expect(writer.text).toMatch(/monitor-health/);
    expect(writer.text).toMatch(/retention/);
  });
});

describe('jobs run', () => {
  it('runs the nightly forecast and summarises', async () => {
    const { deps, writer } = setup();
    const result = await run(['jobs', 'run', 'nightly-forecast'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/nightly-forecast: 1 processed, 1 changed, 0 skipped, 0 failed/);
  });

  it('honours a dry run', async () => {
    const { scenario, deps } = setup();
    await run(['jobs', 'run', 'nightly-forecast', '--dry-run'], deps);
    expect(scenario.context.readings.count({ source: 'estimated' })).toBe(0);
  });

  it('takes an as of day', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'jobs', 'run', 'retention', '--as-of', '2026-03-10'], deps);
    const parsed = JSON.parse(writer.text) as { detail: { cutoff: string } };
    expect(parsed.detail.cutoff).toBe('2023-03-11');
  });

  it('reports a job name it does not know', async () => {
    const { deps, writer } = setup();
    const result = await run(['jobs', 'run', 'nonsense'], deps);
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/no job called "nonsense", try one of:/);
  });

  it('sets a non zero exit code when something inside the job failed', async () => {
    const { scenario, deps } = setup();
    // A tank pointed at a station that has been deleted fails inside the job
    // without stopping it, which is exactly the case cron has to notice.
    scenario.context.weather.deleteStation('KITH');
    await run(['jobs', 'run', 'nightly-forecast'], deps);
    expect(process.exitCode).toBe(1);
  });
});
