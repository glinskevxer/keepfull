import { afterEach, describe, expect, it } from 'vitest';
import { PulledForward, SnapAssessment, coldSnap } from '../../../src/jobs/cold-snap';
import { Scenario, buildScenario, seedCleanHistory } from '../../support/scenario';
import { buildJobRegistry } from '../../../src/jobs';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { fahrenheit } from '../../../src/core/units';
import { runJob } from '../../../src/jobs/runner';

afterEach(closeTestDatabases);

/**
 * The scenario's normals match its weather exactly, so a snap has to be made by
 * overwriting the last few days with something colder.
 */
function chill(scenario: Scenario, days: readonly string[], degreeDays: number) {
  const mean = 65 - degreeDays;
  for (const day of days) {
    scenario.context.weather.recordObservation(
      'KITH',
      { day: dayKey(day), high: fahrenheit(mean + 5), low: fahrenheit(mean - 5) },
      new Date('2025-02-10T06:00:00Z'),
    );
  }
}

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  seedCleanHistory(scenario);
  return { scenario, job: { app: scenario.context, today: scenario.today, dryRun: false } };
}

describe('the registry', () => {
  it('carries the cold snap job', () => {
    expect(buildJobRegistry().names()).toContain('cold-snap');
  });
});

describe('cold-snap', () => {
  it('says nothing when the weather is behaving', () => {
    const { job } = setup();
    const result = runJob(coldSnap, job);
    expect(result.detail.snapping).toEqual([]);
    expect(result.detail.pulledForward).toBeUndefined();
  });

  it('measures how far above normal the last few days ran', () => {
    const { job } = setup();
    const assessments = runJob(coldSnap, job).detail.stations as SnapAssessment[];
    expect(assessments[0]?.stationId).toBe('KITH');
    expect(assessments[0]?.excessPerDay).toBe(0);
    expect(assessments[0]?.isSnap).toBe(false);
  });

  it('calls a real snap', () => {
    const { scenario, job } = setup();
    chill(scenario, ['2025-02-08', '2025-02-09', '2025-02-10'], 40);
    const result = runJob(coldSnap, job);
    expect(result.detail.snapping).toEqual(['KITH']);
    const assessments = result.detail.stations as SnapAssessment[];
    expect(assessments[0]?.excessPerDay).toBeGreaterThanOrEqual(6);
  });

  it('ignores one cold day on its own', () => {
    const { scenario, job } = setup();
    chill(scenario, ['2025-02-10'], 40);
    expect(runJob(coldSnap, job).detail.snapping).toEqual([]);
  });

  it('names the tanks now inside a fortnight', () => {
    const { scenario, job } = setup();
    chill(scenario, ['2025-02-08', '2025-02-09', '2025-02-10'], 40);
    const pulled = runJob(coldSnap, job).detail.pulledForward as PulledForward[];
    expect(pulled).toHaveLength(1);
    expect(pulled[0]?.tankId).toBe(scenario.tank.id);
    expect(pulled[0]?.daysOut).toBeLessThanOrEqual(14);
  });

  it('leaves a will call account alone', () => {
    const { scenario, job } = setup();
    chill(scenario, ['2025-02-08', '2025-02-09', '2025-02-10'], 40);
    scenario.context.customers.update({ ...scenario.customer, deliveryMode: 'will_call' });
    expect(runJob(coldSnap, job).detail.pulledForward as PulledForward[]).toEqual([]);
  });

  it('warns in the log so cron can shout about it', () => {
    const { scenario, job } = setup();
    chill(scenario, ['2025-02-08', '2025-02-09', '2025-02-10'], 40);
    runJob(coldSnap, job);
    expect(scenario.sink.at('warn').map((record) => record.msg)).toContain('cold snap');
  });

  it('skips a station with barely any weather on file', () => {
    const scenario = buildScenario({
      today: '2025-02-10',
      weatherFrom: '2025-02-10',
      weatherTo: '2025-02-10',
    });
    const result = runJob(coldSnap, {
      app: scenario.context,
      today: scenario.today,
      dryRun: false,
    });
    expect(result.detail.stations).toEqual([]);
  });
});
