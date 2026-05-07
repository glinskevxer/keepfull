import { DayKey, addDays, dayKey, monthDay, toDate } from '../util/dates';
import { assertInRange, assertPositive } from '../util/assert';

/**
 * Which days the trucks run.
 *
 * Saturdays are a half day in the heating season and nothing the rest of the
 * year. Sundays nobody runs. And there are eight days the plant is shut, which
 * matters more than it sounds: a keep full account whose reserve day lands on
 * Christmas Eve has to be served before the shutdown, not after it, and the
 * only place that decision can be made correctly is in the planning window.
 */

export type DayType = 'full' | 'half' | 'closed';

export interface CalendarOptions {
  /** `MM-DD` for fixed holidays. Movable ones are worked out. */
  readonly fixedHolidays?: readonly string[];
  /** Saturdays run in the heating season only, unless this is off. */
  readonly saturdaysInSeason?: boolean;
  readonly closedDays?: readonly DayKey[];
}

/** The days the plant is shut, as month and day. */
export const FIXED_HOLIDAYS: readonly string[] = [
  '01-01', // new year
  '07-04', // independence day
  '11-11', // veterans day
  '12-24', // christmas eve, plant shuts at noon and nobody loads
  '12-25', // christmas
  '12-31', // new year's eve
];

/** The months a saturday is worth running. */
const SEASON_MONTHS = new Set([11, 12, 1, 2, 3]);

export class DeliveryCalendar {
  private readonly fixed: Set<string>;
  private readonly closed: Set<string>;
  private readonly saturdaysInSeason: boolean;

  constructor(options: CalendarOptions = {}) {
    this.fixed = new Set(options.fixedHolidays ?? FIXED_HOLIDAYS);
    this.closed = new Set(options.closedDays ?? []);
    this.saturdaysInSeason = options.saturdaysInSeason ?? true;
  }

  /** Zero is Sunday, matching what Date reports in UTC. */
  weekday(day: DayKey): number {
    return toDate(day).getUTCDay();
  }

  typeOf(day: DayKey): DayType {
    if (this.closed.has(day) || this.fixed.has(monthDay(day))) {
      return 'closed';
    }
    const weekday = this.weekday(day);
    if (weekday === 0) {
      return 'closed';
    }
    if (weekday === 6) {
      if (!this.saturdaysInSeason) {
        return 'closed';
      }
      return SEASON_MONTHS.has(Number(monthDay(day).slice(0, 2))) ? 'half' : 'closed';
    }
    // Thanksgiving is the fourth thursday in november, which has to be worked
    // out rather than listed, and the friday after it is taken as well.
    if (this.isThanksgivingWeekend(day)) {
      return 'closed';
    }
    return 'full';
  }

  private isThanksgivingWeekend(day: DayKey): boolean {
    const month = Number(monthDay(day).slice(0, 2));
    if (month !== 11) {
      return false;
    }
    const dayOfMonth = Number(monthDay(day).slice(3));
    const weekday = this.weekday(day);
    if (weekday === 4) {
      return dayOfMonth >= 22 && dayOfMonth <= 28;
    }
    if (weekday === 5) {
      return dayOfMonth >= 23 && dayOfMonth <= 29;
    }
    return false;
  }

  runs(day: DayKey): boolean {
    return this.typeOf(day) !== 'closed';
  }

  /** How much of a normal day's work a day is worth, for capacity planning. */
  capacityShare(day: DayKey): number {
    const type = this.typeOf(day);
    return type === 'full' ? 1 : type === 'half' ? 0.5 : 0;
  }

  /** The next day the trucks run, not counting the day given. */
  nextRunningDay(from: DayKey, limit = 30): DayKey {
    assertPositive(limit, 'limit');
    let cursor = addDays(from, 1);
    for (let step = 0; step < limit; step += 1) {
      if (this.runs(cursor)) {
        return cursor;
      }
      cursor = addDays(cursor, 1);
    }
    throw new Error(`no running day inside ${limit} days of ${from}`);
  }

  /** The last day the trucks run on or before the day given. */
  lastRunningDayOnOrBefore(day: DayKey, limit = 30): DayKey {
    assertPositive(limit, 'limit');
    let cursor = day;
    for (let step = 0; step < limit; step += 1) {
      if (this.runs(cursor)) {
        return cursor;
      }
      cursor = addDays(cursor, -1);
    }
    throw new Error(`no running day inside ${limit} days before ${day}`);
  }

  /** Running days in a closed range, which is what a week's capacity comes from. */
  runningDaysBetween(from: DayKey, to: DayKey): DayKey[] {
    const days: DayKey[] = [];
    let cursor = from;
    while (cursor <= to) {
      if (this.runs(cursor)) {
        days.push(cursor);
      }
      cursor = addDays(cursor, 1);
    }
    return days;
  }

  /**
   * A tank due on a closed day has to be served before the shutdown. This is
   * the day dispatch should actually aim for.
   */
  serveBy(dueOn: DayKey, limit = 30): DayKey {
    return this.runs(dueOn) ? dueOn : this.lastRunningDayOnOrBefore(addDays(dueOn, -1), limit);
  }

  /** Total capacity over a range, in whole day equivalents. */
  capacityBetween(from: DayKey, to: DayKey): number {
    let total = 0;
    let cursor = from;
    while (cursor <= to) {
      total += this.capacityShare(cursor);
      cursor = addDays(cursor, 1);
    }
    return Math.round(total * 10) / 10;
  }

  /** Adds a one off closure, such as a blizzard or the plant losing power. */
  close(day: DayKey): void {
    this.closed.add(day);
  }

  /** How many days of the shutdown run consecutively from a day. */
  shutdownLength(from: DayKey, limit = 14): number {
    assertInRange(limit, 1, 60, 'limit');
    let length = 0;
    let cursor = from;
    while (length < limit && !this.runs(cursor)) {
      length += 1;
      cursor = addDays(cursor, 1);
    }
    return length;
  }
}

export function defaultCalendar(): DeliveryCalendar {
  return new DeliveryCalendar();
}

export function calendarFor(closedDays: readonly string[]): DeliveryCalendar {
  return new DeliveryCalendar({ closedDays: closedDays.map((day) => dayKey(day)) });
}
