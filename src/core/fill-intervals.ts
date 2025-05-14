import { DayKey, addDays, daysBetween } from '../util/dates';
import { DegreeDayLedger } from './degree-days';
import { Delivery, compareByDay, isAnchorFill, isPosted } from '../model/delivery';
import { FillInterval } from './burn-model';

/**
 * Turns a tank's ticket history into the intervals the burn model can fit.
 *
 * An interval runs from one fill to the next, and it only means anything if the
 * earlier fill topped the tank out. If the driver stopped at sixty percent
 * because the truck was empty, the tank started the next stretch from a level
 * nobody wrote down, and the gallons that come back at the end of it measure a
 * different thing entirely. Those get dropped, with a reason, because the
 * office asks why a tank has no forecast and "we threw away four of its six
 * fills" is a better answer than silence.
 */

export type SkipReason =
  | 'opening_fill_not_anchored'
  | 'closing_fill_voided'
  | 'interval_too_short'
  | 'interval_too_long'
  | 'weather_gap'
  | 'no_gallons';

export interface SkippedInterval {
  readonly from: DayKey;
  readonly to: DayKey;
  readonly reason: SkipReason;
  readonly detail?: string;
}

export interface IntervalOptions {
  /** Below this many days the fill is a top off, not a burn. */
  readonly minimumDays?: number;
  /** Above this the account probably sat empty for a season. */
  readonly maximumDays?: number;
  /** Share of days in the interval the weather ledger has to cover. */
  readonly minimumWeatherCoverage?: number;
}

export interface IntervalResult {
  readonly intervals: FillInterval[];
  readonly skipped: SkippedInterval[];
}

const DEFAULTS = {
  minimumDays: 7,
  maximumDays: 400,
  minimumWeatherCoverage: 0.9,
} as const;

export function buildFillIntervals(
  deliveries: readonly Delivery[],
  ledger: DegreeDayLedger,
  fillLimit: number,
  options: IntervalOptions = {},
): IntervalResult {
  const minimumDays = options.minimumDays ?? DEFAULTS.minimumDays;
  const maximumDays = options.maximumDays ?? DEFAULTS.maximumDays;
  const coverage = options.minimumWeatherCoverage ?? DEFAULTS.minimumWeatherCoverage;

  const ordered = [...deliveries].filter(isPosted).sort(compareByDay);
  const intervals: FillInterval[] = [];
  const skipped: SkippedInterval[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const opening = ordered[index - 1] as Delivery;
    const closing = ordered[index] as Delivery;
    const from = opening.deliveredOn;
    const to = closing.deliveredOn;

    if (!isAnchorFill(opening, fillLimit)) {
      skipped.push({ from, to, reason: 'opening_fill_not_anchored' });
      continue;
    }
    const days = daysBetween(from, to);
    if (days < minimumDays) {
      skipped.push({ from, to, reason: 'interval_too_short', detail: `${days} days` });
      continue;
    }
    if (days > maximumDays) {
      skipped.push({ from, to, reason: 'interval_too_long', detail: `${days} days` });
      continue;
    }
    if (closing.net <= 0) {
      skipped.push({ from, to, reason: 'no_gallons' });
      continue;
    }
    const windowStart = addDays(from, 1);
    const missing = ledger.missing(windowStart, to).length;
    const covered = 1 - missing / days;
    if (covered < coverage) {
      skipped.push({
        from,
        to,
        reason: 'weather_gap',
        detail: `${missing} of ${days} days missing`,
      });
      continue;
    }
    intervals.push({
      days,
      degreeDays: ledger.accumulate(windowStart, to),
      gallons: closing.net,
      label: `${from}..${to}`,
    });
  }

  return { intervals, skipped };
}

/** The share of candidate intervals that survived, for reporting on data quality. */
export function usableShare(result: IntervalResult): number {
  const total = result.intervals.length + result.skipped.length;
  return total === 0 ? 0 : result.intervals.length / total;
}

export function countSkipsByReason(result: IntervalResult): Record<SkipReason, number> {
  const counts: Record<SkipReason, number> = {
    opening_fill_not_anchored: 0,
    closing_fill_voided: 0,
    interval_too_short: 0,
    interval_too_long: 0,
    weather_gap: 0,
    no_gallons: 0,
  };
  for (const skip of result.skipped) {
    counts[skip.reason] += 1;
  }
  return counts;
}
