import { AppContext, currentDay } from './context';
import { DayKey, daysBetween } from '../util/dates';
import { ForecastingService } from './forecasting';
import { OUT_OF_GAS_PERCENT } from '../core/tank-math';
import { isForecast } from '../model/customer';

/**
 * Which will call accounts should be offered keep full.
 *
 * Will call is worse for everybody and the customers who are worst served by it
 * are the ones least likely to ask to change. They run out, they get an
 * emergency fill at a premium, and they conclude the dealer is expensive. The
 * ones worth calling are not the biggest accounts, they are the ones whose own
 * ordering is furthest from what a forecast would have done.
 */

export interface ConversionCandidate {
  readonly customerId: string;
  readonly accountNumber: string;
  readonly tankId: string;
  /** Fills that started from a tank at or under the out of gas mark. */
  readonly runOuts: number;
  readonly emergencyFills: number;
  readonly fills: number;
  readonly netGallons: number;
  /** Mean gauge the customer let the tank fall to before calling. */
  readonly meanCallGauge: number | null;
  /** Whether there is enough history to forecast them if they did convert. */
  readonly forecastable: boolean;
  readonly score: number;
  readonly reasons: string[];
}

export interface ConversionOptions {
  readonly from?: DayKey;
  readonly to?: DayKey;
  /** Fewest fills in the window before an account is worth judging. */
  readonly minimumFills?: number;
}

export class ConversionService {
  constructor(private readonly context: AppContext) {}

  candidates(options: ConversionOptions = {}): ConversionCandidate[] {
    const to = options.to ?? currentDay(this.context);
    const from = options.from ?? backTwoYears(to);
    const minimumFills = options.minimumFills ?? 3;
    const forecasting = new ForecastingService(this.context);
    const candidates: ConversionCandidate[] = [];

    for (const customer of this.context.customers.list({ openOnly: true })) {
      if (isForecast(customer)) {
        continue;
      }
      for (const tank of this.context.tanks.list({
        customerId: customer.id,
        inServiceOnly: true,
      })) {
        const fills = this.context.deliveries.list({
          tankId: tank.id,
          from,
          to,
          postedOnly: true,
        });
        if (fills.length < minimumFills) {
          continue;
        }
        const runOuts = fills.filter(
          (fill) => fill.gaugeBefore !== undefined && fill.gaugeBefore <= OUT_OF_GAS_PERCENT,
        ).length;
        const emergencyFills = fills.filter((fill) => fill.reason === 'emergency').length;
        const gauges: number[] = [];
        for (const fill of fills) {
          if (fill.gaugeBefore !== undefined) {
            gauges.push(fill.gaugeBefore);
          }
        }
        const meanCallGauge =
          gauges.length === 0
            ? null
            : Math.round((gauges.reduce((total, gauge) => total + gauge, 0) / gauges.length) * 10) /
              10;
        const netGallons = Math.round(fills.reduce((total, fill) => total + fill.net, 0) * 10) / 10;
        const forecastable = forecasting.tryForTank(tank.id, { asOf: to }) !== undefined;

        const reasons: string[] = [];
        if (runOuts > 0) {
          reasons.push(`${runOuts} run outs`);
        }
        if (emergencyFills > 0) {
          reasons.push(`${emergencyFills} emergency fills`);
        }
        if (meanCallGauge !== null && meanCallGauge < 15) {
          reasons.push(`calls at ${meanCallGauge}% on average`);
        }
        if (!forecastable) {
          reasons.push('not enough clean history to forecast yet');
        }

        candidates.push({
          customerId: customer.id,
          accountNumber: customer.accountNumber,
          tankId: tank.id,
          runOuts,
          emergencyFills,
          fills: fills.length,
          netGallons,
          meanCallGauge,
          forecastable,
          score: score(runOuts, emergencyFills, meanCallGauge, forecastable),
          reasons,
        });
      }
    }
    return candidates.sort((left, right) => right.score - left.score);
  }

  /** The ones worth a phone call this week. */
  worthCalling(options: ConversionOptions & { limit?: number } = {}): ConversionCandidate[] {
    return this.candidates(options)
      .filter((candidate) => candidate.score > 0 && candidate.forecastable)
      .slice(0, options.limit ?? 20);
  }
}

/**
 * A run out is worth far more than a low call, because a run out costs a leak
 * check and a relight as well as the gallons. An account nobody can forecast
 * yet is not worth calling however badly it is being served, so it scores zero.
 */
function score(
  runOuts: number,
  emergencyFills: number,
  meanCallGauge: number | null,
  forecastable: boolean,
): number {
  if (!forecastable) {
    return 0;
  }
  const lowCalling = meanCallGauge === null ? 0 : Math.max(0, 20 - meanCallGauge) / 4;
  return Math.round((runOuts * 10 + emergencyFills * 4 + lowCalling) * 10) / 10;
}

function backTwoYears(to: DayKey): DayKey {
  const date = new Date(`${to}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 2);
  const from = date.toISOString().slice(0, 10) as DayKey;
  // Guard against a leap day landing on a day that does not exist.
  return daysBetween(from, to) > 0 ? from : to;
}
