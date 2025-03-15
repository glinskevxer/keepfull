import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_TEMPERATURE,
  DegreeDayLedger,
  NormalYear,
  coolingDegreeDays,
  degreeDaysFor,
  heatingDegreeDays,
  meanTemperature,
} from '../../../src/core/degree-days';
import { fahrenheit } from '../../../src/core/units';
import { dayKey } from '../../../src/util/dates';

describe('meanTemperature', () => {
  it('takes the midpoint of high and low', () => {
    expect(meanTemperature(fahrenheit(50), fahrenheit(30))).toBe(40);
  });

  it('rejects a low above the high', () => {
    expect(() => meanTemperature(fahrenheit(20), fahrenheit(30))).toThrowError(/above high/);
  });
});

describe('heatingDegreeDays', () => {
  it('counts degrees below the base', () => {
    expect(heatingDegreeDays(fahrenheit(45))).toBe(20);
  });

  it('is zero on a warm day', () => {
    expect(heatingDegreeDays(fahrenheit(72))).toBe(0);
  });

  it('honours a different base', () => {
    expect(heatingDegreeDays(fahrenheit(45), fahrenheit(60))).toBe(15);
  });

  it('is zero exactly at the base', () => {
    expect(heatingDegreeDays(DEFAULT_BASE_TEMPERATURE)).toBe(0);
  });
});

describe('coolingDegreeDays', () => {
  it('counts degrees above the base', () => {
    expect(coolingDegreeDays(fahrenheit(80))).toBe(15);
    expect(coolingDegreeDays(fahrenheit(50))).toBe(0);
  });
});

describe('degreeDaysFor', () => {
  it('reports both sides and the mean', () => {
    const result = degreeDaysFor({
      day: dayKey('2025-01-10'),
      high: fahrenheit(30),
      low: fahrenheit(10),
    });
    expect(result.mean).toBe(20);
    expect(result.heating).toBe(45);
    expect(result.cooling).toBe(0);
    expect(result.day).toBe('2025-01-10');
  });
});

describe('DegreeDayLedger', () => {
  const ledger = new DegreeDayLedger('KRUT').recordAll([
    { day: dayKey('2025-01-01'), high: fahrenheit(35), low: fahrenheit(15) },
    { day: dayKey('2025-01-02'), high: fahrenheit(40), low: fahrenheit(20) },
    { day: dayKey('2025-01-04'), high: fahrenheit(55), low: fahrenheit(35) },
  ]);

  it('rejects a blank station id', () => {
    expect(() => new DegreeDayLedger('  ')).toThrowError(/station id/);
  });

  it('holds one entry per day', () => {
    expect(ledger.size).toBe(3);
    expect(ledger.has(dayKey('2025-01-01'))).toBe(true);
    expect(ledger.has(dayKey('2025-01-03'))).toBe(false);
  });

  it('reports the days it holds, in order', () => {
    expect(ledger.days()).toEqual(['2025-01-01', '2025-01-02', '2025-01-04']);
  });

  it('overwrites a day when the station revises it', () => {
    const revised = new DegreeDayLedger('KRUT')
      .record({ day: dayKey('2025-01-01'), high: fahrenheit(35), low: fahrenheit(15) })
      .record({ day: dayKey('2025-01-01'), high: fahrenheit(45), low: fahrenheit(25) });
    expect(revised.size).toBe(1);
    expect(revised.get(dayKey('2025-01-01'))?.heating).toBe(30);
  });

  it('adds up a range and skips the gap', () => {
    expect(ledger.accumulate(dayKey('2025-01-01'), dayKey('2025-01-04'))).toBe(40 + 35 + 20);
  });

  it('returns zero for a backwards range', () => {
    expect(ledger.accumulate(dayKey('2025-01-04'), dayKey('2025-01-01'))).toBe(0);
  });

  it('names the days it is missing', () => {
    expect(ledger.missing(dayKey('2025-01-01'), dayKey('2025-01-05'))).toEqual([
      '2025-01-03',
      '2025-01-05',
    ]);
  });
});

describe('NormalYear', () => {
  it('rejects a blank station id', () => {
    expect(() => new NormalYear('')).toThrowError(/station id/);
  });

  it('rejects a key that is not a month and day', () => {
    expect(() => new NormalYear('KRUT').set('2025-01-01', 30)).toThrowError(/MM-DD/);
  });

  it('rejects an implausible normal', () => {
    expect(() => new NormalYear('KRUT').set('01-01', 140)).toThrowError(/normal degree days/);
  });

  it('applies to any year', () => {
    const normals = new NormalYear('KRUT').set('01-01', 42);
    expect(normals.forDay(dayKey('2025-01-01'))).toBe(42);
    expect(normals.forDay(dayKey('2031-01-01'))).toBe(42);
  });

  it('treats an unset day as no heating load', () => {
    expect(new NormalYear('KRUT').forDay(dayKey('2025-07-04'))).toBe(0);
  });

  it('accumulates across a year boundary', () => {
    const normals = new NormalYear('KRUT').set('12-31', 30).set('01-01', 32).set('01-02', 28);
    expect(normals.accumulate(dayKey('2025-12-31'), dayKey('2026-01-02'))).toBe(90);
    expect(normals.size).toBe(3);
  });

  it('returns zero for a backwards range', () => {
    expect(new NormalYear('KRUT').accumulate(dayKey('2026-01-02'), dayKey('2025-12-31'))).toBe(0);
  });
});
