import { afterEach, describe, expect, it } from 'vitest';
import { QuietMonitor, monitorHealth } from '../../../src/jobs/monitor-health';
import { Scenario, buildScenario, seedCleanHistory } from '../../support/scenario';
import { buildJobRegistry } from '../../../src/jobs';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { nightlyForecast } from '../../../src/jobs/nightly-forecast';
import { retention } from '../../../src/jobs/retention';
import { runJob } from '../../../src/jobs/runner';

afterEach(closeTestDatabases);

function jobContext(scenario: Scenario, dryRun = false) {
  return { app: scenario.context, today: scenario.today, dryRun };
}

describe('the registry', () => {
  it('holds the nightly jobs and the yearly one', () => {
    expect(buildJobRegistry().names()).toEqual([
      'monitor-health',
      'nightly-forecast',
      'refresh-normals',
      'retention',
    ]);
  });
});

describe('nightly-forecast', () => {
  it('writes estimates for a tank it can forecast', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    seedCleanHistory(scenario);
    const result = runJob(nightlyForecast, jobContext(scenario));
    expect(result.changed).toBe(1);
    expect(
      scenario.context.readings.count({ tankId: scenario.tank.id, source: 'estimated' }),
    ).toBeGreaterThan(0);
  });

  it('skips a tank it cannot forecast and says how many', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    seedCleanHistory(scenario);
    scenario.addTank();
    const result = runJob(nightlyForecast, jobContext(scenario));
    expect(result.processed).toBe(2);
    expect(result.changed).toBe(1);
    expect(result.detail.unforecastable).toBe(1);
  });

  it('skips a will call account', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    seedCleanHistory(scenario);
    scenario.context.customers.update({ ...scenario.customer, deliveryMode: 'will_call' });
    expect(runJob(nightlyForecast, jobContext(scenario)).changed).toBe(0);
  });

  it('skips a closed account', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    seedCleanHistory(scenario);
    scenario.context.customers.close(scenario.customer.id, dayKey('2025-01-01'));
    expect(runJob(nightlyForecast, jobContext(scenario)).changed).toBe(0);
  });

  it('writes nothing on a dry run', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    seedCleanHistory(scenario);
    const result = runJob(nightlyForecast, jobContext(scenario, true));
    expect(result.changed).toBe(1);
    expect(scenario.context.readings.count({ source: 'estimated' })).toBe(0);
  });

  it('counts how many reach a reserve day', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    seedCleanHistory(scenario);
    expect(runJob(nightlyForecast, jobContext(scenario)).detail.withReserveDay).toBe(1);
  });
});

describe('monitor-health', () => {
  function monitored() {
    const scenario = buildScenario({ today: '2026-01-20' });
    const tank = scenario.addTank({ monitorId: 'WT-4471' });
    return { scenario, tank };
  }

  it('says nothing about a monitor that reported today', () => {
    const { scenario, tank } = monitored();
    scenario.context.readings.record({
      id: 'r-1',
      tankId: tank.id,
      takenOn: dayKey('2026-01-19'),
      gauge: 40 as never,
      source: 'monitor',
      monitorId: 'WT-4471',
    });
    const result = runJob(monitorHealth, jobContext(scenario));
    expect(result.detail.quietCount).toBe(0);
    expect(result.changed).toBe(0);
  });

  it('flags one that has gone quiet', () => {
    const { scenario, tank } = monitored();
    scenario.context.readings.record({
      id: 'r-1',
      tankId: tank.id,
      takenOn: dayKey('2026-01-01'),
      gauge: 40 as never,
      source: 'monitor',
      monitorId: 'WT-4471',
    });
    const result = runJob(monitorHealth, jobContext(scenario));
    expect(result.detail.quietCount).toBe(1);
    const quiet = result.detail.quiet as QuietMonitor[];
    expect(quiet[0]).toMatchObject({ monitorId: 'WT-4471', silentDays: 19 });
  });

  it('flags one that has never reported at all', () => {
    const { scenario } = monitored();
    const result = runJob(monitorHealth, jobContext(scenario));
    const quiet = result.detail.quiet as QuietMonitor[];
    expect(quiet[0]).toMatchObject({ lastHeardOn: null, silentDays: null });
  });

  it('warns in the log when something is quiet', () => {
    const { scenario } = monitored();
    runJob(monitorHealth, jobContext(scenario));
    expect(scenario.sink.messages()).toContain('monitors have gone quiet');
  });

  it('ignores tanks with no monitor', () => {
    const scenario = buildScenario({ today: '2026-01-20' });
    expect(runJob(monitorHealth, jobContext(scenario)).detail.monitoredTanks).toBe(0);
  });
});

describe('retention', () => {
  it('drops readings past the window', () => {
    const scenario = buildScenario({ today: '2026-03-10' });
    scenario.read('2020-01-01', 40);
    scenario.read('2026-03-01', 30);
    const result = runJob(retention, jobContext(scenario));
    expect(result.changed).toBe(1);
    expect(scenario.context.readings.count()).toBe(1);
  });

  it('keeps everything inside the window', () => {
    const scenario = buildScenario({ today: '2026-03-10' });
    scenario.read('2025-03-01', 30);
    const result = runJob(retention, jobContext(scenario));
    expect(result.changed).toBe(0);
    expect(result.detail.deleted).toBe(0);
  });

  it('deletes nothing on a dry run but still counts', () => {
    const scenario = buildScenario({ today: '2026-03-10' });
    scenario.read('2020-01-01', 40);
    const result = runJob(retention, jobContext(scenario, true));
    expect(result.detail.doomed).toBe(1);
    expect(result.detail.deleted).toBe(0);
    expect(scenario.context.readings.count()).toBe(1);
  });

  it('reports the cutoff it used', () => {
    const scenario = buildScenario({ today: '2026-03-10' });
    expect(runJob(retention, jobContext(scenario)).detail.cutoff).toBe('2023-03-11');
  });
});
