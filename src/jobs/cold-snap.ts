import { DegreeDayLedger } from '../core/degree-days';
import { ForecastingService } from '../service/forecasting';
import { Job, JobContext, JobReport } from './runner';
import { addDays, daysBetween } from '../util/dates';
import { isForecast } from '../model/customer';

/**
 * Pulls forward the tanks a cold snap has caught out.
 *
 * A forecast made a fortnight ago walked the tank forward on thirty year
 * normals. When the actual weather comes in ten degree days a day colder than
 * those normals, every one of those projections is late, and the ones that
 * matter are the tanks that were already inside a fortnight of their reserve
 * day. Those go from comfortable to out of gas over a weekend.
 *
 * This does not refit anything. It compares what the weather actually did
 * against what the normals said it would, and where the gap is real it names
 * the tanks whose reserve day has moved in far enough to need a truck sooner.
 */

/** Degree days a day above normal before a stretch counts as a snap. */
export const SNAP_THRESHOLD = 6;

/** Days of it in a row. One cold Tuesday is weather, not a snap. */
export const SNAP_DAYS = 3;

export interface SnapAssessment {
  readonly stationId: string;
  readonly days: number;
  readonly actualDegreeDays: number;
  readonly normalDegreeDays: number;
  readonly excessPerDay: number;
  readonly isSnap: boolean;
}

export interface PulledForward {
  readonly tankId: string;
  readonly customerId: string;
  readonly reserveDay: string;
  readonly daysOut: number;
}

export const coldSnap: Job = {
  name: 'cold-snap',
  description: 'find tanks a cold snap has moved inside the delivery window',

  run(context: JobContext, report: JobReport): void {
    const from = addDays(context.today, -SNAP_DAYS + 1);
    const snapped = new Set<string>();
    const assessments: SnapAssessment[] = [];

    for (const station of context.app.weather.listStations({ activeOnly: true })) {
      const ledger: DegreeDayLedger = context.app.weather.loadLedger(
        station.id,
        from,
        context.today,
      );
      const normals = context.app.weather.loadNormals(station.id);
      const covered = ledger.days().length;
      if (covered < SNAP_DAYS) {
        continue;
      }
      const actual = ledger.accumulate(from, context.today);
      const normal = normals.accumulate(from, context.today);
      const excessPerDay = Math.round(((actual - normal) / covered) * 10) / 10;
      // Every day in the window has to be above normal, not the average of
      // them. One bitter Tuesday in an otherwise mild week averages out over
      // the threshold and is not a snap, it is a Tuesday.
      const isSnap = ledger
        .days()
        .every((day) => (ledger.get(day)?.heating ?? 0) - normals.forDay(day) >= SNAP_THRESHOLD);
      assessments.push({
        stationId: station.id,
        days: covered,
        actualDegreeDays: Math.round(actual),
        normalDegreeDays: Math.round(normal),
        excessPerDay,
        isSnap,
      });
      if (isSnap) {
        snapped.add(station.id);
      }
    }

    report.note('stations', assessments);
    report.note('snapping', [...snapped].sort());
    if (snapped.size === 0) {
      return;
    }

    const forecasting = new ForecastingService(context.app);
    const pulled: PulledForward[] = [];

    for (const tank of context.app.tanks.list({ inServiceOnly: true })) {
      report.attempt(tank.id, () => {
        const customer = context.app.customers.get(tank.customerId);
        if (!snapped.has(customer.stationId) || !isForecast(customer)) {
          return false;
        }
        const result = forecasting.tryForTank(tank.id, { asOf: context.today });
        const reserveDay = result?.forecast.reserveDay;
        if (reserveDay === undefined) {
          return false;
        }
        const daysOut = daysBetween(context.today, reserveDay);
        if (daysOut > 14) {
          return false;
        }
        pulled.push({ tankId: tank.id, customerId: customer.id, reserveDay, daysOut });
        return true;
      });
    }

    pulled.sort((left, right) => left.daysOut - right.daysOut);
    report.note('pulledForward', pulled);
    context.app.logger.warn('cold snap', {
      stations: [...snapped].join(','),
      tanks: pulled.length,
      soonest: pulled[0]?.reserveDay ?? null,
    });
  },
};
