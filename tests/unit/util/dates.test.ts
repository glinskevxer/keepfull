import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDays,
  dayKey,
  dayOfMonth,
  dayOfYear,
  dayRange,
  daysBetween,
  daysInMonth,
  eachDay,
  fromDate,
  heatingSeason,
  heatingSeasonBounds,
  isDayKey,
  isLeapYear,
  maxDay,
  minDay,
  month,
  monthDay,
  toDate,
  today,
  year,
} from '../../../src/util/dates';

describe('dayKey', () => {
  it('accepts a well formed day', () => {
    expect(dayKey('2025-02-17')).toBe('2025-02-17');
  });

  it.each(['2025-2-17', '17/02/2025', '2025-02-17T00:00:00Z', ''])('rejects %s', (value) => {
    expect(() => dayKey(value)).toThrowError();
  });

  it('rejects a month that is not a month', () => {
    expect(() => dayKey('2025-13-01')).toThrowError(/is not a month/);
  });

  it('rejects the thirtieth of February', () => {
    expect(() => dayKey('2025-02-30')).toThrowError(/not a real calendar day/);
  });

  it('accepts the twenty ninth of February in a leap year and refuses it otherwise', () => {
    expect(dayKey('2024-02-29')).toBe('2024-02-29');
    expect(() => dayKey('2025-02-29')).toThrowError(/not a real calendar day/);
  });
});

describe('isDayKey', () => {
  it('reports on strings without throwing', () => {
    expect(isDayKey('2025-06-01')).toBe(true);
    expect(isDayKey('2025-06-31')).toBe(false);
    expect(isDayKey(20250601)).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});

describe('calendar helpers', () => {
  it('counts days in a month', () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 12)).toBe(31);
  });

  it('knows the leap year rule including the century cases', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe('conversion', () => {
  it('round trips through Date at midnight UTC', () => {
    const day = dayKey('2025-11-03');
    expect(toDate(day).toISOString()).toBe('2025-11-03T00:00:00.000Z');
    expect(fromDate(toDate(day))).toBe(day);
  });

  it('refuses an invalid Date', () => {
    expect(() => fromDate(new Date('nope'))).toThrowError(/invalid date/);
  });

  it('takes today from an injected clock', () => {
    expect(today(new Date('2026-01-09T23:40:00Z'))).toBe('2026-01-09');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts across a month boundary', () => {
    expect(addDays(dayKey('2025-01-31'), 1)).toBe('2025-02-01');
    expect(addDays(dayKey('2025-03-01'), -1)).toBe('2025-02-28');
  });

  it('adds across a leap day', () => {
    expect(addDays(dayKey('2024-02-28'), 1)).toBe('2024-02-29');
  });

  it('rejects a fractional day count', () => {
    expect(() => addDays(dayKey('2025-01-01'), 1.5)).toThrowError(/whole number/);
  });

  it('counts days between, signed', () => {
    expect(daysBetween(dayKey('2025-01-01'), dayKey('2025-02-01'))).toBe(31);
    expect(daysBetween(dayKey('2025-02-01'), dayKey('2025-01-01'))).toBe(-31);
  });
});

describe('ordering', () => {
  it('compares lexically, which is also chronologically', () => {
    expect(compareDays(dayKey('2025-01-01'), dayKey('2025-01-02'))).toBe(-1);
    expect(compareDays(dayKey('2025-01-02'), dayKey('2025-01-01'))).toBe(1);
    expect(compareDays(dayKey('2025-01-01'), dayKey('2025-01-01'))).toBe(0);
  });

  it('picks the smaller and larger', () => {
    const a = dayKey('2025-01-01');
    const b = dayKey('2025-06-01');
    expect(minDay(a, b)).toBe(a);
    expect(maxDay(a, b)).toBe(b);
  });
});

describe('parts', () => {
  it('pulls out the pieces', () => {
    const day = dayKey('2025-09-14');
    expect(year(day)).toBe(2025);
    expect(month(day)).toBe(9);
    expect(dayOfMonth(day)).toBe(14);
    expect(monthDay(day)).toBe('09-14');
  });

  it('numbers the day of the year from one', () => {
    expect(dayOfYear(dayKey('2025-01-01'))).toBe(1);
    expect(dayOfYear(dayKey('2025-12-31'))).toBe(365);
    expect(dayOfYear(dayKey('2024-12-31'))).toBe(366);
  });
});

describe('ranges', () => {
  it('walks a range inclusively', () => {
    expect(dayRange(dayKey('2025-01-30'), dayKey('2025-02-02'))).toEqual([
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
      '2025-02-02',
    ]);
  });

  it('yields a single day when both ends match', () => {
    expect(dayRange(dayKey('2025-01-30'), dayKey('2025-01-30'))).toEqual(['2025-01-30']);
  });

  it('yields nothing when the range runs backwards', () => {
    expect([...eachDay(dayKey('2025-02-02'), dayKey('2025-01-30'))]).toEqual([]);
  });
});

describe('heating season', () => {
  it('puts January with the December before it', () => {
    expect(heatingSeason(dayKey('2025-12-20'))).toBe(2025);
    expect(heatingSeason(dayKey('2026-01-20'))).toBe(2025);
    expect(heatingSeason(dayKey('2026-07-01'))).toBe(2026);
  });

  it('gives the bounds of a season', () => {
    expect(heatingSeasonBounds(2025)).toEqual({ start: '2025-07-01', end: '2026-06-30' });
  });
});
