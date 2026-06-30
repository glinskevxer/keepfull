import { afterEach, describe, expect, it } from 'vitest';
import { Timing, benchmark, renderTimings, time } from '../../../src/dev/bench';
import { buildContext } from '../../../src/service/context';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { Logger, MemorySink } from '../../../src/util/logger';
import { seed } from '../../../src/dev/seed';

afterEach(closeTestDatabases);

function context() {
  return buildContext(testDatabase(), {
    logger: new Logger({ sink: new MemorySink(), level: 'error' }),
    clock: () => new Date('2025-12-31T09:00:00Z'),
  });
}

describe('time', () => {
  it('runs the work the number of times asked', () => {
    let calls = 0;
    const timing = time(
      'x',
      4,
      () => {
        calls += 1;
        return 'done';
      },
      () => 0,
    );
    expect(calls).toBe(4);
    expect(timing.runs).toBe(4);
    expect(timing.detail).toBe('done');
  });

  it('reports the mean and the worst run', () => {
    const steps = [0, 10, 10, 40];
    let index = 0;
    const timing = time(
      'x',
      2,
      () => 'done',
      () => steps[index++] as number,
    );
    expect(timing.totalMs).toBe(40);
    expect(timing.meanMs).toBe(20);
    expect(timing.slowestMs).toBe(30);
  });
});

describe('benchmark', () => {
  it('times every stage against a seeded yard', () => {
    const app = context();
    seed(app, { customers: 4, from: dayKey('2025-01-01'), to: dayKey('2025-12-31') });
    const timings = benchmark(app, { runs: 1 });
    expect(timings.map((timing) => timing.name)).toEqual([
      'forecast the whole book',
      'plan a day onto the trucks',
      'build the morning board',
      'a season of gallons against degree days',
      'a year of gallons by month',
    ]);
    for (const timing of timings) {
      expect(timing.meanMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('says something useful about each stage', () => {
    const app = context();
    seed(app, { customers: 4, from: dayKey('2025-01-01'), to: dayKey('2025-12-31') });
    const timings = benchmark(app, { runs: 1 });
    expect(timings[0]?.detail).toMatch(/of 4 tanks forecast/);
    expect(timings[2]?.detail).toMatch(/exceptions/);
  });

  it('runs against an empty yard without falling over', () => {
    const app = context();
    app.weather.saveStation({
      id: 'KITH',
      name: 'Ithaca',
      latitude: 42.49,
      longitude: -76.45,
      elevationFeet: 1099,
      baseTemperature: 65 as never,
      active: true,
    });
    expect(() => benchmark(app, { runs: 1 })).not.toThrow();
  });
});

describe('renderTimings', () => {
  it('lines the names up', () => {
    const timings: Timing[] = [
      { name: 'short', runs: 1, totalMs: 1, meanMs: 1, slowestMs: 1, detail: 'a' },
      { name: 'a much longer name', runs: 1, totalMs: 2, meanMs: 2, slowestMs: 2, detail: 'b' },
    ];
    const lines = renderTimings(timings).split('\n');
    expect(lines[0]?.indexOf('ms mean')).toBe(lines[1]?.indexOf('ms mean'));
  });
});
