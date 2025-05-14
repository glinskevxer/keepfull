import { InsufficientHistoryError } from './errors';
import { assertNonNegative, assertPositive } from '../util/assert';

/**
 * What a tank burns, split into the part that tracks the weather and the part
 * that does not.
 *
 * The old rule of thumb in this trade is a single K factor, degree days per
 * gallon, fitted off the last two fills. It works until it does not: a house
 * with propane hot water burns a gallon and a half a day in July when there are
 * no degree days at all, and a single K factor either has to pretend that
 * summer gallon does not exist or has to smear it across the winter and send
 * the truck early all season.
 *
 * So the fit here has two terms. Gallons over an interval are
 *
 *     gallons = baseGallonsPerDay * days + weatherGallonsPerDegreeDay * degreeDays
 *
 * which is an ordinary least squares fit through the origin on two predictors.
 * K factor is still reported, because that is the number the office reads, but
 * it is derived from the weather term rather than being the model itself.
 */

export interface FillInterval {
  /** Days from the opening fill to the closing fill. */
  readonly days: number;
  /** Heating degree days accumulated over those days. */
  readonly degreeDays: number;
  /** Net gallons the closing fill put back in. */
  readonly gallons: number;
  /** Identifies the interval when a caller wants to say which one was dropped. */
  readonly label?: string;
}

export interface BurnModel {
  readonly baseGallonsPerDay: number;
  readonly weatherGallonsPerDegreeDay: number;
  /** Degree days per gallon, the number the office still asks for. */
  readonly kFactor: number | undefined;
  readonly intervalsUsed: number;
  readonly intervalsRejected: number;
  /** Share of the variation in gallons the fit accounts for, zero to one. */
  readonly fitQuality: number;
}

export interface FitOptions {
  /** Fewest intervals that will produce a model at all. */
  readonly minimumIntervals?: number;
  /** Residuals beyond this many standard deviations get dropped and the fit repeated. */
  readonly outlierSigma?: number;
  /** Upper bound on the base load, to stop a bad interval producing nonsense. */
  readonly maximumBaseGallonsPerDay?: number;
}

const DEFAULTS = {
  minimumIntervals: 3,
  outlierSigma: 2.5,
  maximumBaseGallonsPerDay: 12,
} as const;

interface Coefficients {
  readonly base: number;
  readonly weather: number;
}

/** Solves the two by two normal equations for a fit through the origin. */
function solve(intervals: readonly FillInterval[], maximumBase: number): Coefficients {
  let sumDD = 0;
  let sumHH = 0;
  let sumDH = 0;
  let sumDG = 0;
  let sumHG = 0;
  for (const interval of intervals) {
    sumDD += interval.days * interval.days;
    sumHH += interval.degreeDays * interval.degreeDays;
    sumDH += interval.days * interval.degreeDays;
    sumDG += interval.days * interval.gallons;
    sumHG += interval.degreeDays * interval.gallons;
  }
  const determinant = sumDD * sumHH - sumDH * sumDH;

  // When every interval sat in the same season the two predictors move together
  // and the system is singular. Fall back to a weather only fit, which is what
  // the single K factor rule of thumb would have given anyway.
  if (Math.abs(determinant) < 1e-9) {
    if (sumHH > 0) {
      return { base: 0, weather: sumHG / sumHH };
    }
    return { base: sumDD > 0 ? sumDG / sumDD : 0, weather: 0 };
  }

  let base = (sumHH * sumDG - sumDH * sumHG) / determinant;
  let weather = (sumDD * sumHG - sumDH * sumDG) / determinant;

  // Neither term can be negative in the real world. A house does not produce
  // propane on a mild day. Clamp and refit the other term against the residual.
  if (base < 0) {
    base = 0;
    weather = sumHH > 0 ? sumHG / sumHH : 0;
  }
  if (weather < 0) {
    weather = 0;
    base = sumDD > 0 ? sumDG / sumDD : 0;
  }
  if (base > maximumBase) {
    base = maximumBase;
    const residualHG = sumHG - base * sumDH;
    weather = sumHH > 0 ? Math.max(0, residualHG / sumHH) : 0;
  }
  return { base, weather };
}

export function predictGallons(model: BurnModel, days: number, degreeDays: number): number {
  assertNonNegative(days, 'days');
  assertNonNegative(degreeDays, 'degree days');
  return model.baseGallonsPerDay * days + model.weatherGallonsPerDegreeDay * degreeDays;
}

function residuals(intervals: readonly FillInterval[], coefficients: Coefficients): number[] {
  return intervals.map(
    (interval) =>
      interval.gallons -
      (coefficients.base * interval.days + coefficients.weather * interval.degreeDays),
  );
}

function fitQualityOf(intervals: readonly FillInterval[], coefficients: Coefficients): number {
  const mean = intervals.reduce((total, i) => total + i.gallons, 0) / intervals.length;
  const totalSquares = intervals.reduce((total, i) => total + (i.gallons - mean) ** 2, 0);
  if (totalSquares === 0) {
    return 1;
  }
  const errorSquares = residuals(intervals, coefficients).reduce((total, r) => total + r * r, 0);
  return Math.max(0, Math.min(1, 1 - errorSquares / totalSquares));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Median absolute deviation scaled so it matches a standard deviation on
 * normal data, with a plain standard deviation as the fallback for the case
 * where more than half the residuals are identical and the deviation is zero.
 */
function robustSpread(values: readonly number[], centre: number): number {
  const scaled = 1.4826 * median(values.map((value) => Math.abs(value - centre)));
  if (scaled > 1e-9) {
    return scaled;
  }
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function fitBurnModel(
  intervals: readonly FillInterval[],
  tankId = 'unknown',
  options: FitOptions = {},
): BurnModel {
  const minimum = options.minimumIntervals ?? DEFAULTS.minimumIntervals;
  const sigma = options.outlierSigma ?? DEFAULTS.outlierSigma;
  const maximumBase = options.maximumBaseGallonsPerDay ?? DEFAULTS.maximumBaseGallonsPerDay;
  assertPositive(minimum, 'minimum intervals');
  assertPositive(sigma, 'outlier sigma');

  const usable = intervals.filter(
    (interval) => interval.days > 0 && interval.gallons > 0 && interval.degreeDays >= 0,
  );
  if (usable.length < minimum) {
    throw new InsufficientHistoryError(tankId, usable.length, minimum);
  }

  let kept = usable;
  let coefficients = solve(kept, maximumBase);

  // One pass of outlier rejection, off the median absolute deviation rather
  // than the standard deviation. A single fill keyed as 2400 gallons instead of
  // 240 inflates the standard deviation enough to hide itself, which is exactly
  // the case this is here to catch.
  if (kept.length > minimum) {
    const errors = residuals(kept, coefficients);
    const centre = median(errors);
    const spread = robustSpread(errors, centre);
    if (spread > 0) {
      const survivors = kept.filter(
        (_, index) => Math.abs((errors[index] as number) - centre) <= sigma * spread,
      );
      if (survivors.length >= minimum && survivors.length < kept.length) {
        kept = survivors;
        coefficients = solve(kept, maximumBase);
      }
    }
  }

  return {
    baseGallonsPerDay: coefficients.base,
    weatherGallonsPerDegreeDay: coefficients.weather,
    kFactor: coefficients.weather > 0 ? 1 / coefficients.weather : undefined,
    intervalsUsed: kept.length,
    intervalsRejected: usable.length - kept.length,
    fitQuality: fitQualityOf(kept, coefficients),
  };
}
