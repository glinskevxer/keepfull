import { assertInteger, assertNonEmpty } from './assert';

/**
 * Calendar days, not instants.
 *
 * A delivery happens on a day. Degree days accumulate over a day. Nothing in
 * the forecasting math cares what time the truck pulled up, and carrying a
 * timestamp around just invites a timezone to shift a reading into the wrong
 * heating season. So the whole domain speaks in `DayKey`, a plain
 * `YYYY-MM-DD` string, and conversions to a real Date always go through UTC.
 */
export type DayKey = string & { readonly __day: unique symbol };

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function dayKey(value: string): DayKey {
  assertNonEmpty(value, 'day');
  const match = DAY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`day must look like YYYY-MM-DD, got "${value}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new Error(`month ${month} is not a month, in "${value}"`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`"${value}" is not a real calendar day`);
  }
  return value as DayKey;
}

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    dayKey(value);
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function toDate(day: DayKey): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function fromDate(date: Date): DayKey {
  if (Number.isNaN(date.getTime())) {
    throw new Error('cannot take a day from an invalid date');
  }
  return date.toISOString().slice(0, 10) as DayKey;
}

export function addDays(day: DayKey, count: number): DayKey {
  assertInteger(count, 'day count');
  return fromDate(new Date(toDate(day).getTime() + count * MS_PER_DAY));
}

export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY);
}

export function compareDays(a: DayKey, b: DayKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDay(a: DayKey, b: DayKey): DayKey {
  return a <= b ? a : b;
}

export function maxDay(a: DayKey, b: DayKey): DayKey {
  return a >= b ? a : b;
}

export function year(day: DayKey): number {
  return Number(day.slice(0, 4));
}

export function month(day: DayKey): number {
  return Number(day.slice(5, 7));
}

export function dayOfMonth(day: DayKey): number {
  return Number(day.slice(8, 10));
}

/** One based, so the first of January is one. */
export function dayOfYear(day: DayKey): number {
  const start = Date.UTC(year(day), 0, 1);
  return Math.round((toDate(day).getTime() - start) / MS_PER_DAY) + 1;
}

/**
 * The month and day, without the year, as `MM-DD`. Degree day normals are
 * keyed this way because a thirty year normal has no year of its own.
 */
export function monthDay(day: DayKey): string {
  return day.slice(5);
}

export function* eachDay(from: DayKey, to: DayKey): Generator<DayKey> {
  if (compareDays(from, to) > 0) {
    return;
  }
  let cursor = from;
  while (compareDays(cursor, to) <= 0) {
    yield cursor;
    cursor = addDays(cursor, 1);
  }
}

export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  return [...eachDay(from, to)];
}

/**
 * Heating seasons run July through June, so a cold January belongs with the
 * December before it rather than starting a new year halfway through the
 * winter. The season is named for the year it starts in.
 */
export function heatingSeason(day: DayKey): number {
  return month(day) >= 7 ? year(day) : year(day) - 1;
}

export function heatingSeasonBounds(season: number): { start: DayKey; end: DayKey } {
  return {
    start: dayKey(`${season}-07-01`),
    end: dayKey(`${season + 1}-06-30`),
  };
}

export function today(now: Date = new Date()): DayKey {
  return fromDate(now);
}
