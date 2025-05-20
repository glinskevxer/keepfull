import { describe, expect, it } from 'vitest';
import {
  actualWeatherShare,
  daysToEmpty,
  daysToReserve,
  gallonsBurnedThrough,
  gaugeOn,
  projectTank,
} from '../../../src/core/forecast';
import { BurnModel } from '../../../src/core/burn-model';
import { DegreeDayLedger, NormalYear } from '../../../src/core/degree-days';
import { dayKey, dayRange } from '../../../src/util/dates';
import { fahrenheit, percent } from '../../../src/core/units';
import { tankGeometry } from '../../../src/core/tank-math';

const model: BurnModel = {
  baseGallonsPerDay: 1,
  weatherGallonsPerDegreeDay: 0.2,
  kFactor: 5,
  intervalsUsed: 6,
  intervalsRejected: 0,
  fitQuality: 0.94,
};

const geometry = tankGeometry(500, { reservePercent: 25 });

/** Twenty degree days a day, so the tank burns exactly five gallons a day. */
function ledgerThrough(from: string, to: string): DegreeDayLedger {
  const ledger = new DegreeDayLedger('KITH');
  for (const day of dayRange(dayKey(from), dayKey(to))) {
    ledger.record({ day, high: fahrenheit(55), low: fahrenheit(35) });
  }
  return ledger;
}

/** Normals that also give twenty degree days, so the seam does not change the rate. */
function flatNormals(): NormalYear {
  const normals = new NormalYear('KITH');
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 31; day += 1) {
      normals.set(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 20);
    }
  }
  return normals;
}

describe('projectTank', () => {
  const ledger = ledgerThrough('2025-01-01', '2025-01-20');
  const normals = flatNormals();

  it('burns the base load plus the weather term each day', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
    );
    expect(forecast.days[0]).toMatchObject({ day: '2025-01-02', gallonsBurned: 5 });
    expect(forecast.days[0]?.gallonsRemaining).toBe(395);
  });

  it('walks the gauge down', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
    );
    expect(gaugeOn(forecast, dayKey('2025-01-11'))).toBeCloseTo(70, 6);
  });

  it('finds the day the tank hits its reserve mark', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
    );
    expect(forecast.reserveDay).toBe('2025-02-25');
    expect(daysToReserve(forecast)).toBe(55);
  });

  it('finds the day it is effectively out and stops there', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
      { horizonDays: 200 },
    );
    expect(forecast.outOfGasDay).toBe('2025-03-17');
    expect(daysToEmpty(forecast)).toBe(75);
    expect(forecast.days[forecast.days.length - 1]?.day).toBe('2025-03-17');
  });

  it('reports nothing when the horizon runs out first', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
      { horizonDays: 10 },
    );
    expect(forecast.reserveDay).toBeUndefined();
    expect(forecast.outOfGasDay).toBeUndefined();
    expect(daysToReserve(forecast)).toBeUndefined();
    expect(daysToEmpty(forecast)).toBeUndefined();
    expect(forecast.days).toHaveLength(10);
  });

  it('refuses a horizon of nothing', () => {
    expect(() =>
      projectTank('t-1', geometry, model, dayKey('2025-01-01'), percent(80), ledger, normals, {
        horizonDays: 0,
      }),
    ).toThrowError(/horizon days/);
  });
});

describe('the seam between real weather and normals', () => {
  const ledger = ledgerThrough('2025-01-01', '2025-01-20');
  const normals = flatNormals();

  it('marks which days had real weather', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
      { horizonDays: 30 },
    );
    expect(forecast.days[0]?.actualWeather).toBe(true);
    expect(forecast.days[25]?.actualWeather).toBe(false);
  });

  it('names the last day the weather was real', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
      { horizonDays: 30 },
    );
    expect(forecast.lastActualWeatherDay).toBe('2025-01-20');
  });

  it('measures how much of the projection is real', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledger,
      normals,
      { horizonDays: 38 },
    );
    expect(actualWeatherShare(forecast)).toBeCloseTo(0.5, 6);
  });

  it('has no share to report on an empty projection', () => {
    expect(
      actualWeatherShare({
        tankId: 't-1',
        from: dayKey('2025-01-01'),
        startingGauge: percent(80),
        days: [],
        horizonDays: 0,
      }),
    ).toBe(0);
  });

  it('falls back to nothing when the normals have no entry either', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-06-01'),
      percent(80),
      new DegreeDayLedger('KITH'),
      new NormalYear('KITH'),
      { horizonDays: 5 },
    );
    expect(forecast.days.every((day) => day.gallonsBurned === 1)).toBe(true);
  });
});

describe('gallonsBurnedThrough', () => {
  it('adds up the burn to a day', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledgerThrough('2025-01-01', '2025-01-20'),
      flatNormals(),
      { horizonDays: 20 },
    );
    expect(gallonsBurnedThrough(forecast, dayKey('2025-01-11'))).toBeCloseTo(50, 6);
  });

  it('is zero before the projection starts', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(80),
      ledgerThrough('2025-01-01', '2025-01-20'),
      flatNormals(),
      { horizonDays: 20 },
    );
    expect(gallonsBurnedThrough(forecast, dayKey('2024-12-31'))).toBe(0);
  });
});

describe('a tank that starts near empty', () => {
  it('is out almost immediately', () => {
    const forecast = projectTank(
      't-1',
      geometry,
      model,
      dayKey('2025-01-01'),
      percent(6),
      ledgerThrough('2025-01-01', '2025-01-20'),
      flatNormals(),
    );
    expect(forecast.outOfGasDay).toBe('2025-01-02');
    expect(forecast.days).toHaveLength(1);
  });
});
