import { DayKey, dayKey, daysBetween, isDayKey } from '../util/dates';
import { InvalidInputError } from '../core/errors';
import { Percent, percent } from '../core/units';
import { assertNonEmpty } from '../util/assert';

/**
 * A tank gauge reading, from wherever it came.
 *
 * Four things read a gauge and they are not equally trustworthy. A telemetry
 * monitor reads every few hours and is right unless the battery is going. A
 * driver reads the dial standing next to it. A customer reads it over the phone
 * and rounds to a quarter. An estimate is the forecast talking to itself. When
 * two readings land on the same day the better source wins, which is what
 * `sourceRank` is for.
 */

export type ReadingSource = 'monitor' | 'driver' | 'customer' | 'estimated';

export const READING_SOURCES: readonly ReadingSource[] = [
  'monitor',
  'driver',
  'customer',
  'estimated',
];

const SOURCE_RANK: Record<ReadingSource, number> = {
  monitor: 0,
  driver: 1,
  customer: 2,
  estimated: 3,
};

export interface TankReading {
  readonly id: string;
  readonly tankId: string;
  readonly takenOn: DayKey;
  readonly gauge: Percent;
  readonly source: ReadingSource;
  readonly monitorId?: string;
  readonly note?: string;
}

export interface TankReadingDraft {
  readonly id: string;
  readonly tankId: string;
  readonly takenOn: string;
  readonly gauge: number;
  readonly source: ReadingSource;
  readonly monitorId?: string;
  readonly note?: string;
}

export function makeReading(draft: TankReadingDraft): TankReading {
  assertNonEmpty(draft.id, 'reading id');
  assertNonEmpty(draft.tankId, 'tank id');
  if (!READING_SOURCES.includes(draft.source)) {
    throw new InvalidInputError(`"${draft.source}" is not a reading source`);
  }
  if (!isDayKey(draft.takenOn)) {
    throw new InvalidInputError(`"${draft.takenOn}" is not a day a reading could be taken`);
  }
  if (draft.source === 'monitor' && !draft.monitorId) {
    throw new InvalidInputError('a monitor reading has to say which monitor it came from');
  }
  return {
    id: draft.id,
    tankId: draft.tankId,
    takenOn: dayKey(draft.takenOn),
    gauge: percent(draft.gauge),
    source: draft.source,
    ...(draft.monitorId ? { monitorId: draft.monitorId } : {}),
    ...(draft.note ? { note: draft.note } : {}),
  };
}

export function sourceRank(source: ReadingSource): number {
  return SOURCE_RANK[source];
}

export function isMeasured(reading: TankReading): boolean {
  return reading.source !== 'estimated';
}

/** Later day wins, and on the same day the better source wins. */
export function preferReading(left: TankReading, right: TankReading): TankReading {
  if (left.takenOn !== right.takenOn) {
    return left.takenOn > right.takenOn ? left : right;
  }
  return sourceRank(left.source) <= sourceRank(right.source) ? left : right;
}

export function bestReading(readings: readonly TankReading[]): TankReading | undefined {
  return readings.reduce<TankReading | undefined>(
    (best, reading) => (best === undefined ? reading : preferReading(best, reading)),
    undefined,
  );
}

/** How stale a reading is, in days, as of some day. */
export function ageInDays(reading: TankReading, on: DayKey): number {
  return daysBetween(reading.takenOn, on);
}

/**
 * A reading old enough that dispatch should not plan a drop size from it. A
 * monitor going quiet for a week in January means the battery died, not that
 * the tank stopped moving.
 */
export function isStale(reading: TankReading, on: DayKey, maxAgeDays = 5): boolean {
  return ageInDays(reading, on) > maxAgeDays;
}
