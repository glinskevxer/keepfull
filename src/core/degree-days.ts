import { assertInRange, assertNonEmpty } from '../util/assert';
import { DayKey, addDays, compareDays, dayKey, daysBetween, monthDay } from '../util/dates';
import { DegreeDays, Fahrenheit, degreeDays, fahrenheit } from './units';

/**
 * Heating degree days are the whole basis of the delivery forecast. One degree
 * day is one degree of average daily temperature below the base, so a day whose
 * mean was forty five degrees against a sixty five degree base contributes
 * twenty. Add them up between two fills and you have a measure of how hard the
 * weather worked the customer's furnace, which turns out to predict gallons far
 * better than the calendar does.
 */

export const DEFAULT_BASE_TEMPERATURE: Fahrenheit = fahrenheit(65);

export interface DailyTemperature {
  readonly day: DayKey;
  readonly high: Fahrenheit;
  readonly low: Fahrenheit;
}

export interface DailyDegreeDays {
  readonly day: DayKey;
  readonly heating: DegreeDays;
  readonly cooling: DegreeDays;
  readonly mean: Fahrenheit;
}

/** The mean the weather service publishes is the midpoint of high and low, not an average of readings. */
export function meanTemperature(high: Fahrenheit, low: Fahrenheit): Fahrenheit {
  if (low > high) {
    throw new Error(`low ${low}F is above high ${high}F`);
  }
  return fahrenheit((high + low) / 2);
}

export function heatingDegreeDays(
  mean: Fahrenheit,
  base: Fahrenheit = DEFAULT_BASE_TEMPERATURE,
): DegreeDays {
  return degreeDays(Math.max(0, base - mean));
}

export function coolingDegreeDays(
  mean: Fahrenheit,
  base: Fahrenheit = DEFAULT_BASE_TEMPERATURE,
): DegreeDays {
  return degreeDays(Math.max(0, mean - base));
}

export function degreeDaysFor(
  reading: DailyTemperature,
  base: Fahrenheit = DEFAULT_BASE_TEMPERATURE,
): DailyDegreeDays {
  const mean = meanTemperature(reading.high, reading.low);
  return {
    day: reading.day,
    mean,
    heating: heatingDegreeDays(mean, base),
    cooling: coolingDegreeDays(mean, base),
  };
}

/**
 * A station's daily record, indexed by day so accumulation can ask for a range
 * without scanning. Days may be missing; the caller decides what that means.
 */
export class DegreeDayLedger {
  private readonly byDay = new Map<string, DailyDegreeDays>();

  constructor(
    readonly stationId: string,
    readonly base: Fahrenheit = DEFAULT_BASE_TEMPERATURE,
  ) {
    assertNonEmpty(stationId, 'station id');
  }

  record(reading: DailyTemperature): this {
    const computed = degreeDaysFor(reading, this.base);
    this.byDay.set(computed.day, computed);
    return this;
  }

  recordAll(readings: Iterable<DailyTemperature>): this {
    for (const reading of readings) {
      this.record(reading);
    }
    return this;
  }

  get(day: DayKey): DailyDegreeDays | undefined {
    return this.byDay.get(day);
  }

  has(day: DayKey): boolean {
    return this.byDay.has(day);
  }

  get size(): number {
    return this.byDay.size;
  }

  days(): DayKey[] {
    return [...this.byDay.keys()].sort().map((value) => dayKey(value));
  }

  /** Days in the closed range that the ledger has no record for. */
  missing(from: DayKey, to: DayKey): DayKey[] {
    const gaps: DayKey[] = [];
    for (let offset = 0; offset <= daysBetween(from, to); offset += 1) {
      const day = addDays(from, offset);
      if (!this.byDay.has(day)) {
        gaps.push(day);
      }
    }
    return gaps;
  }

  /** Heating degree days over a closed range, skipping days with no record. */
  accumulate(from: DayKey, to: DayKey): DegreeDays {
    if (compareDays(from, to) > 0) {
      return degreeDays(0);
    }
    let total = 0;
    for (let offset = 0; offset <= daysBetween(from, to); offset += 1) {
      const entry = this.byDay.get(addDays(from, offset));
      if (entry) {
        total += entry.heating;
      }
    }
    return degreeDays(total);
  }
}

/**
 * A thirty year normal, keyed by month and day so it applies to any year. The
 * forecast walks these forward when it has run out of real weather.
 */
export class NormalYear {
  private readonly byMonthDay = new Map<string, DegreeDays>();

  constructor(readonly stationId: string) {
    assertNonEmpty(stationId, 'station id');
  }

  set(key: string, value: number): this {
    if (!/^\d{2}-\d{2}$/.test(key)) {
      throw new Error(`normal key must look like MM-DD, got "${key}"`);
    }
    assertInRange(value, 0, 100, 'normal degree days');
    this.byMonthDay.set(key, degreeDays(value));
    return this;
  }

  forDay(day: DayKey): DegreeDays {
    return this.byMonthDay.get(monthDay(day)) ?? degreeDays(0);
  }

  get size(): number {
    return this.byMonthDay.size;
  }

  /** Sum of the normals over a closed range of real days. */
  accumulate(from: DayKey, to: DayKey): DegreeDays {
    if (compareDays(from, to) > 0) {
      return degreeDays(0);
    }
    let total = 0;
    for (let offset = 0; offset <= daysBetween(from, to); offset += 1) {
      total += this.forDay(addDays(from, offset));
    }
    return degreeDays(total);
  }
}
