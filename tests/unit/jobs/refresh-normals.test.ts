import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../../support/scenario';
import { buildJobRegistry } from '../../../src/jobs';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { refreshNormals } from '../../../src/jobs/refresh-normals';
import { runJob } from '../../../src/jobs/runner';

afterEach(closeTestDatabases);

function setup(weatherFrom: string) {
  const scenario = buildScenario({
    today: '2026-07-05',
    weatherFrom,
    weatherTo: '2026-07-05',
    degreeDaysPerDay: 18,
  });
  return { scenario, job: { app: scenario.context, today: scenario.today, dryRun: false } };
}

describe('the registry', () => {
  it('carries the yearly job', () => {
    expect(buildJobRegistry().names()).toContain('refresh-normals');
  });
});

describe('refresh-normals', () => {
  it('rebuilds a station with enough history', () => {
    const { scenario, job } = setup('2024-01-01');
    const result = runJob(refreshNormals, job);
    expect(result.changed).toBe(1);
    expect(result.detail['KITH.days']).toBeGreaterThan(360);
    expect(scenario.context.weather.loadNormals('KITH').size).toBeGreaterThan(360);
  });

  it('skips a station with under a year of weather', () => {
    const { job } = setup('2026-04-01');
    const result = runJob(refreshNormals, job);
    expect(result.changed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(String(result.detail['KITH.skipped'])).toMatch(/under a year/);
  });

  it('writes nothing on a dry run', () => {
    const { scenario, job } = setup('2024-01-01');
    scenario.context.weather.saveNormal('KITH', '01-15', 1);
    runJob(refreshNormals, { ...job, dryRun: true });
    expect(scenario.context.weather.loadNormals('KITH').forDay(dayKey('2030-01-15'))).toBe(1);
  });

  it('reports the season total it arrived at', () => {
    const { job } = setup('2024-01-01');
    const result = runJob(refreshNormals, job);
    expect(result.detail['KITH.seasonTotal']).toBeGreaterThan(0);
  });

  it('produces normals the forecast can walk forward', () => {
    const { scenario, job } = setup('2024-01-01');
    runJob(refreshNormals, job);
    const normals = scenario.context.weather.loadNormals('KITH');
    expect(normals.forDay(dayKey('2031-01-15'))).toBeCloseTo(18, 0);
  });
});
