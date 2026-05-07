import { describe, expect, it } from 'vitest';
import { DeliveryCalendar, calendarFor, defaultCalendar } from '../../../src/core/calendar';
import { dayKey } from '../../../src/util/dates';

const calendar = defaultCalendar();

describe('typeOf', () => {
  it('runs a full day on an ordinary weekday', () => {
    // 2026-01-14 is a Wednesday.
    expect(calendar.typeOf(dayKey('2026-01-14'))).toBe('full');
  });

  it('is shut on a sunday', () => {
    expect(calendar.typeOf(dayKey('2026-01-18'))).toBe('closed');
  });

  it('runs a half day on a saturday in the season', () => {
    expect(calendar.typeOf(dayKey('2026-01-17'))).toBe('half');
  });

  it('is shut on a saturday out of the season', () => {
    expect(calendar.typeOf(dayKey('2026-07-18'))).toBe('closed');
  });

  it('is shut on the fixed holidays', () => {
    for (const day of ['2026-01-01', '2026-07-04', '2026-12-25', '2026-12-24']) {
      expect(calendar.typeOf(dayKey(day))).toBe('closed');
    }
  });

  it('works out thanksgiving rather than listing it', () => {
    // The fourth Thursday of November 2026 is the twenty sixth.
    expect(calendar.typeOf(dayKey('2026-11-26'))).toBe('closed');
    expect(calendar.typeOf(dayKey('2026-11-27'))).toBe('closed');
    expect(calendar.typeOf(dayKey('2026-11-19'))).toBe('full');
  });

  it('gets thanksgiving right in a year it falls early', () => {
    // 2025: the fourth Thursday is the twenty seventh.
    expect(calendar.typeOf(dayKey('2025-11-27'))).toBe('closed');
    expect(calendar.typeOf(dayKey('2025-11-20'))).toBe('full');
  });

  it('takes a one off closure', () => {
    const blizzard = calendarFor(['2026-01-14']);
    expect(blizzard.typeOf(dayKey('2026-01-14'))).toBe('closed');
  });

  it('can be told saturdays never run', () => {
    const weekdaysOnly = new DeliveryCalendar({ saturdaysInSeason: false });
    expect(weekdaysOnly.typeOf(dayKey('2026-01-17'))).toBe('closed');
  });

  it('takes a different holiday list', () => {
    const own = new DeliveryCalendar({ fixedHolidays: ['03-17'] });
    expect(own.typeOf(dayKey('2026-03-17'))).toBe('closed');
    expect(own.typeOf(dayKey('2026-01-01'))).toBe('full');
  });
});

describe('capacityShare', () => {
  it('counts a half day as half', () => {
    expect(calendar.capacityShare(dayKey('2026-01-14'))).toBe(1);
    expect(calendar.capacityShare(dayKey('2026-01-17'))).toBe(0.5);
    expect(calendar.capacityShare(dayKey('2026-01-18'))).toBe(0);
  });

  it('adds a week up', () => {
    // Monday the twelfth to Sunday the eighteenth: five full and one half.
    expect(calendar.capacityBetween(dayKey('2026-01-12'), dayKey('2026-01-18'))).toBe(5.5);
  });
});

describe('finding a running day', () => {
  it('skips the weekend forward', () => {
    // Friday the sixteenth: the next running day is Saturday, a half day.
    expect(calendar.nextRunningDay(dayKey('2026-01-16'))).toBe('2026-01-17');
    // Out of season the same Friday jumps to Monday.
    expect(calendar.nextRunningDay(dayKey('2026-07-17'))).toBe('2026-07-20');
  });

  it('walks back to the last running day', () => {
    expect(calendar.lastRunningDayOnOrBefore(dayKey('2026-01-18'))).toBe('2026-01-17');
    expect(calendar.lastRunningDayOnOrBefore(dayKey('2026-01-14'))).toBe('2026-01-14');
  });

  it('gives up rather than looping forever', () => {
    const shut = new DeliveryCalendar({ fixedHolidays: [], saturdaysInSeason: false });
    for (let day = 1; day <= 31; day += 1) {
      shut.close(dayKey(`2026-01-${String(day).padStart(2, '0')}`));
    }
    expect(() => shut.nextRunningDay(dayKey('2026-01-01'), 5)).toThrowError(/no running day/);
    expect(() => shut.lastRunningDayOnOrBefore(dayKey('2026-01-20'), 5)).toThrowError(
      /no running day/,
    );
  });
});

describe('serveBy', () => {
  it('leaves a due day that runs alone', () => {
    expect(calendar.serveBy(dayKey('2026-01-14'))).toBe('2026-01-14');
  });

  it('pulls a sunday back to the saturday', () => {
    expect(calendar.serveBy(dayKey('2026-01-18'))).toBe('2026-01-17');
  });

  it('pulls christmas back past the shutdown', () => {
    // The twenty fourth and twenty fifth are shut, the twenty sixth is a
    // Saturday in the season, so a tank due on christmas has to go on the
    // twenty third.
    expect(calendar.serveBy(dayKey('2026-12-25'))).toBe('2026-12-23');
  });
});

describe('runningDaysBetween and shutdownLength', () => {
  it('lists the days a truck could go out', () => {
    const days = calendar.runningDaysBetween(dayKey('2026-01-12'), dayKey('2026-01-18'));
    expect(days).toEqual([
      '2026-01-12',
      '2026-01-13',
      '2026-01-14',
      '2026-01-15',
      '2026-01-16',
      '2026-01-17',
    ]);
  });

  it('is empty over a shutdown', () => {
    expect(calendar.runningDaysBetween(dayKey('2026-12-25'), dayKey('2026-12-25'))).toEqual([]);
  });

  it('measures how long a shutdown runs', () => {
    // Christmas 2026 falls on a Friday, so the twenty fifth is shut and the
    // twenty sixth is a half day in the season.
    expect(calendar.shutdownLength(dayKey('2026-12-25'))).toBe(1);
    expect(calendar.shutdownLength(dayKey('2026-01-14'))).toBe(0);
  });

  it('refuses an absurd limit', () => {
    expect(() => calendar.shutdownLength(dayKey('2026-01-14'), 0)).toThrowError(/limit/);
  });
});
