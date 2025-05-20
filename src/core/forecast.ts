import { BurnModel } from './burn-model';
import { DayKey, addDays } from '../util/dates';
import { DegreeDayLedger, NormalYear } from './degree-days';
import { OUT_OF_GAS_PERCENT, TankGeometry, gallonsAt, gaugeFor } from './tank-math';
import { NetGallons, Percent, netGallons, percent } from './units';
import { assertPositive } from '../util/assert';

/**
 * Walks a tank forward a day at a time and says when it will need a truck.
 *
 * Real weather is used for as long as the ledger has it, which in practice is
 * up to yesterday, and after that the thirty year normals take over. That seam
 * matters: the first few days of a projection are close to certain and day
 * ninety is a guess, so the projection carries the day the weather stopped
 * being real and dispatch shows it.
 */

export interface ProjectedDay {
  readonly day: DayKey;
  readonly degreeDays: number;
  readonly gallonsBurned: number;
  readonly gallonsRemaining: number;
  readonly gauge: Percent;
  /** False once the projection has run past the end of the real weather. */
  readonly actualWeather: boolean;
}

export interface Forecast {
  readonly tankId: string;
  readonly from: DayKey;
  readonly startingGauge: Percent;
  readonly days: ProjectedDay[];
  /** First day the gauge is at or under the tank's reserve mark. */
  readonly reserveDay?: DayKey;
  /** First day the tank is effectively out. */
  readonly outOfGasDay?: DayKey;
  /** Last day the projection had real weather for. */
  readonly lastActualWeatherDay?: DayKey;
  readonly horizonDays: number;
}

export interface ForecastOptions {
  readonly horizonDays?: number;
}

export function projectTank(
  tankId: string,
  geometry: TankGeometry,
  model: BurnModel,
  from: DayKey,
  startingGauge: Percent,
  ledger: DegreeDayLedger,
  normals: NormalYear,
  options: ForecastOptions = {},
): Forecast {
  const horizonDays = options.horizonDays ?? 120;
  assertPositive(horizonDays, 'horizon days');

  const days: ProjectedDay[] = [];
  let remaining: NetGallons = gallonsAt(geometry, startingGauge);
  let reserveDay: DayKey | undefined;
  let outOfGasDay: DayKey | undefined;
  let lastActualWeatherDay: DayKey | undefined;
  const reserveGallons = gallonsAt(geometry, percent(geometry.reservePercent));
  const emptyGallons = gallonsAt(geometry, percent(OUT_OF_GAS_PERCENT));

  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const day = addDays(from, offset);
    const actual = ledger.get(day);
    const degreeDays = actual ? actual.heating : normals.forDay(day);
    if (actual) {
      lastActualWeatherDay = day;
    }
    const burned = model.baseGallonsPerDay + model.weatherGallonsPerDegreeDay * degreeDays;
    remaining = netGallons(Math.max(0, remaining - burned));
    const gauge = gaugeFor(geometry, remaining);
    if (reserveDay === undefined && remaining <= reserveGallons) {
      reserveDay = day;
    }
    if (outOfGasDay === undefined && remaining <= emptyGallons) {
      outOfGasDay = day;
    }
    days.push({
      day,
      degreeDays,
      gallonsBurned: burned,
      gallonsRemaining: remaining,
      gauge,
      actualWeather: actual !== undefined,
    });
    if (outOfGasDay !== undefined) {
      break;
    }
  }

  return {
    tankId,
    from,
    startingGauge,
    days,
    ...(reserveDay ? { reserveDay } : {}),
    ...(outOfGasDay ? { outOfGasDay } : {}),
    ...(lastActualWeatherDay ? { lastActualWeatherDay } : {}),
    horizonDays,
  };
}

/** Days from the start of the forecast until the reserve mark, if it gets there. */
export function daysToReserve(forecast: Forecast): number | undefined {
  const index = forecast.days.findIndex((day) => day.day === forecast.reserveDay);
  return index < 0 ? undefined : index + 1;
}

export function daysToEmpty(forecast: Forecast): number | undefined {
  const index = forecast.days.findIndex((day) => day.day === forecast.outOfGasDay);
  return index < 0 ? undefined : index + 1;
}

/** What the projection thinks the gauge will read on a given day. */
export function gaugeOn(forecast: Forecast, day: DayKey): Percent | undefined {
  return forecast.days.find((entry) => entry.day === day)?.gauge;
}

export function gallonsBurnedThrough(forecast: Forecast, day: DayKey): number {
  let total = 0;
  for (const entry of forecast.days) {
    if (entry.day > day) {
      break;
    }
    total += entry.gallonsBurned;
  }
  return total;
}

/**
 * How much of the projection rests on real weather rather than normals. A
 * forecast that is ninety percent normals is still worth acting on, but it is
 * not worth arguing with a customer about.
 */
export function actualWeatherShare(forecast: Forecast): number {
  if (forecast.days.length === 0) {
    return 0;
  }
  const actual = forecast.days.filter((day) => day.actualWeather).length;
  return actual / forecast.days.length;
}
