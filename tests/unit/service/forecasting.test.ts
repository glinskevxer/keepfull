import { afterEach, describe, expect, it } from 'vitest';
import { ForecastingService } from '../../../src/service/forecasting';
import { InsufficientHistoryError } from '../../../src/core/errors';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey, daysBetween } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function withHistory(reservePercent = 25) {
  const scenario = buildScenario({ today: '2025-02-01', reservePercent });
  const days = ['2024-08-01', '2024-09-01', '2024-10-01', '2024-11-01', '2024-12-01', '2025-01-01'];
  // Six gallons a day at twenty degree days a day, which is a base load of one
  // gallon and a quarter of a gallon per degree day. The fills are sized to the
  // length of the month so the fit has a single right answer.
  scenario.fill(days[0] as string, 180);
  for (let index = 1; index < days.length; index += 1) {
    const span = daysBetween(dayKey(days[index - 1] as string), dayKey(days[index] as string));
    scenario.fill(days[index] as string, 6 * span);
  }
  return { scenario, service: new ForecastingService(scenario.context) };
}

describe('burnModel', () => {
  it('fits a clean history', () => {
    const { scenario, service } = withHistory();
    const { model, intervals } = service.burnModel(scenario.tank.id);
    expect(intervals.intervals.length).toBeGreaterThanOrEqual(4);
    expect(model.baseGallonsPerDay + model.weatherGallonsPerDegreeDay * 20).toBeCloseTo(6, 3);
  });

  it('refuses to guess from one fill', () => {
    const scenario = buildScenario();
    scenario.fill('2025-01-01', 180);
    expect(() => new ForecastingService(scenario.context).burnModel(scenario.tank.id)).toThrowError(
      InsufficientHistoryError,
    );
  });

  it('refuses a tank it does not know', () => {
    const scenario = buildScenario();
    expect(() => new ForecastingService(scenario.context).burnModel('t-nope')).toThrowError(
      /no tank with id/,
    );
  });
});

describe('startingPoint', () => {
  it('takes a measured reading when there is a recent one', () => {
    const { scenario, service } = withHistory();
    scenario.read('2025-01-20', 55, 'monitor');
    const point = service.startingPoint(scenario.tank.id, dayKey('2025-02-01'));
    expect(point).toMatchObject({ source: 'reading', gauge: 55, day: '2025-01-20', ageInDays: 12 });
  });

  it('falls back to the last fill when there is no reading', () => {
    const { scenario, service } = withHistory();
    const point = service.startingPoint(scenario.tank.id, dayKey('2025-02-01'));
    expect(point).toMatchObject({ source: 'last_fill', gauge: 80, day: '2025-01-01' });
  });

  it('prefers the fill when it is newer than the reading', () => {
    const { scenario, service } = withHistory();
    scenario.read('2024-12-20', 40);
    const point = service.startingPoint(scenario.tank.id, dayKey('2025-02-01'));
    expect(point.source).toBe('last_fill');
  });

  it('ignores a reading taken after the day being asked about', () => {
    const { scenario, service } = withHistory();
    scenario.read('2025-01-25', 55);
    const point = service.startingPoint(scenario.tank.id, dayKey('2025-01-10'));
    expect(point.day).toBe('2025-01-01');
  });

  it('gives up when there is nothing to stand on', () => {
    const scenario = buildScenario();
    expect(() =>
      new ForecastingService(scenario.context).startingPoint(scenario.tank.id, scenario.today),
    ).toThrowError(/usable gauge reading/);
  });

  it('will not stand on a fill that stopped short', () => {
    const scenario = buildScenario();
    scenario.fill('2025-01-01', 180, { gaugeAfter: undefined });
    expect(() =>
      new ForecastingService(scenario.context).startingPoint(scenario.tank.id, scenario.today),
    ).toThrowError(/usable gauge reading/);
  });
});

describe('forTank', () => {
  it('projects to a reserve day', () => {
    const { scenario, service } = withHistory();
    const result = service.forTank(scenario.tank.id);
    expect(result.forecast.reserveDay).toBeDefined();
    expect(result.forecast.from).toBe('2025-01-01');
    expect(result.startingPoint.gauge).toBe(80);
  });

  it('burns about six gallons a day at twenty degree days', () => {
    const { scenario, service } = withHistory();
    const result = service.forTank(scenario.tank.id);
    expect(result.forecast.days[0]?.gallonsBurned).toBeCloseTo(6, 3);
  });

  it('reaches the reserve mark after about forty six days', () => {
    const { scenario, service } = withHistory();
    const result = service.forTank(scenario.tank.id);
    expect(result.forecast.reserveDay).toBe('2025-02-16');
  });

  it('moves the reserve day when the reserve percent moves', () => {
    const early = withHistory(40);
    const late = withHistory(10);
    const earlyDay = early.service.forTank(early.scenario.tank.id).forecast.reserveDay as string;
    const lateDay = late.service.forTank(late.scenario.tank.id).forecast.reserveDay as string;
    expect(earlyDay < lateDay).toBe(true);
  });

  it('honours a shorter horizon', () => {
    const { scenario, service } = withHistory();
    const result = service.forTank(scenario.tank.id, { horizonDays: 10 });
    expect(result.forecast.days).toHaveLength(10);
    expect(result.forecast.reserveDay).toBeUndefined();
  });
});

describe('tryForTank', () => {
  it('gives a result when it can', () => {
    const { scenario, service } = withHistory();
    expect(service.tryForTank(scenario.tank.id)).toBeDefined();
  });

  it('gives nothing rather than throwing when the history is thin', () => {
    const scenario = buildScenario();
    scenario.fill('2025-01-01', 180);
    const service = new ForecastingService(scenario.context);
    expect(service.tryForTank(scenario.tank.id)).toBeUndefined();
    expect(scenario.sink.messages()).toContain('no forecast for tank');
  });

  it('still throws on something that is not a data problem', () => {
    const { scenario, service } = withHistory();
    scenario.context.weather.deleteStation('KITH');
    expect(() => service.tryForTank(scenario.tank.id)).toThrowError(/no station with id/);
  });
});

describe('estimates', () => {
  it('says what the tank holds today', () => {
    const { scenario, service } = withHistory();
    const gallons = service.estimatedGallons(scenario.tank.id);
    expect(gallons).toBeCloseTo(400 - 31 * 6, 2);
  });

  it('turns that into a gauge reading', () => {
    const { scenario, service } = withHistory();
    expect(service.estimatedGauge(scenario.tank.id)).toBeCloseTo((400 - 31 * 6) / 5, 2);
  });

  it('writes the projection back as estimated readings', () => {
    const { scenario, service } = withHistory();
    const written = service.writeEstimates(scenario.tank.id, { horizonDays: 20 });
    expect(written).toBe(20);
    expect(scenario.context.readings.count({ tankId: scenario.tank.id, source: 'estimated' })).toBe(
      20,
    );
  });

  it('replaces yesterday estimates rather than piling them up', () => {
    const { scenario, service } = withHistory();
    service.writeEstimates(scenario.tank.id, { horizonDays: 20 });
    service.writeEstimates(scenario.tank.id, { horizonDays: 12 });
    expect(scenario.context.readings.count({ tankId: scenario.tank.id, source: 'estimated' })).toBe(
      12,
    );
  });

  it('writes nothing for a tank it cannot forecast', () => {
    const scenario = buildScenario();
    expect(new ForecastingService(scenario.context).writeEstimates(scenario.tank.id)).toBe(0);
  });

  it('leaves the measured readings alone', () => {
    const { scenario, service } = withHistory();
    scenario.read('2025-01-20', 55, 'monitor');
    service.writeEstimates(scenario.tank.id, { horizonDays: 5 });
    expect(scenario.context.readings.count({ tankId: scenario.tank.id, source: 'monitor' })).toBe(
      1,
    );
  });
});
