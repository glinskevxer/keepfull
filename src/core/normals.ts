import { DailyDegreeDays, NormalYear } from './degree-days';
import { assertInRange, assertNonNegative } from '../util/assert';
import { monthDay } from '../util/dates';

/**
 * Builds a normal year out of whatever weather we actually hold.
 *
 * The published thirty year normals are the right thing to use and they are not
 * always available for the small stations this dealer watches. So the fallback
 * is to compute them from history, with two things done to stop that being
 * worse than useless:
 *
 * The first is smoothing. A raw day of year average over six years is spiky
 * enough that the fourteenth of January can come out ten degree days colder
 * than the thirteenth for no reason but which years happened to have a cold
 * snap. A centred window across neighbouring days flattens that out.
 *
 * The second is the leap day, which has a quarter as many observations behind
 * it as any other day. It is filled from its neighbours rather than trusted.
 */

export interface NormalsOptions {
  /** Days either side to average over. Seven gives a fortnight wide window. */
  readonly windowDays?: number;
  /** Fewest observations for a day before it is filled from its neighbours. */
  readonly minimumObservations?: number;
}

export interface NormalsSummary {
  readonly days: number;
  readonly observations: number;
  readonly filledFromNeighbours: string[];
  readonly seasonTotal: number;
}

const LEAP_DAY = '02-29';

/** Every `MM-DD` in a year, leap day included. */
export function allMonthDays(): string[] {
  const keys: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) {
      keys.push(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }
  return keys;
}

/**
 * Groups the observations by month and day. A `MM-DD` with several years behind
 * it gets one entry per year.
 */
export function groupByMonthDay(observations: readonly DailyDegreeDays[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const observation of observations) {
    const key = monthDay(observation.day);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(observation.heating);
    } else {
      grouped.set(key, [observation.heating]);
    }
  }
  return grouped;
}

export function buildNormals(
  stationId: string,
  observations: readonly DailyDegreeDays[],
  options: NormalsOptions = {},
): { normals: NormalYear; summary: NormalsSummary } {
  const windowDays = options.windowDays ?? 7;
  const minimum = options.minimumObservations ?? 2;
  assertNonNegative(windowDays, 'window days');
  assertInRange(minimum, 1, 50, 'minimum observations');

  const grouped = groupByMonthDay(observations);
  const calendar = allMonthDays();
  const index = new Map(calendar.map((key, position) => [key, position]));
  const normals = new NormalYear(stationId);
  const filled: string[] = [];
  let seasonTotal = 0;

  for (const key of calendar) {
    const position = index.get(key) as number;
    const values: number[] = [];
    let ownCount = 0;
    for (let offset = -windowDays; offset <= windowDays; offset += 1) {
      const neighbour = calendar[(position + offset + calendar.length) % calendar.length] as string;
      // The leap day never contributes to anybody else's window, because three
      // years in four it is not there and the fourth it is one observation.
      if (neighbour === LEAP_DAY && key !== LEAP_DAY) {
        continue;
      }
      const bucket = grouped.get(neighbour);
      if (!bucket) {
        continue;
      }
      values.push(...bucket);
      if (offset === 0) {
        ownCount = bucket.length;
      }
    }
    if (values.length === 0) {
      continue;
    }
    if (ownCount < minimum && key === LEAP_DAY) {
      filled.push(key);
    }
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    const rounded = Math.round(mean * 10) / 10;
    normals.set(key, Math.min(100, rounded));
    seasonTotal += rounded;
  }

  return {
    normals,
    summary: {
      days: normals.size,
      observations: observations.length,
      filledFromNeighbours: filled,
      seasonTotal: Math.round(seasonTotal),
    },
  };
}
