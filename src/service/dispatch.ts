import { AppContext, currentDay } from './context';
import { CandidateStop, LoadPlan, TruckCapacity, planLoads } from '../core/route/loadplan';
import { DeliveryCalendar, defaultCalendar } from '../core/calendar';
import { DayKey, addDays, daysBetween } from '../util/dates';
import { ForecastingService, TankForecast } from './forecasting';
import { Point } from '../core/route/distance';
import { isForecast, isOnHold } from '../model/customer';
import { isInService } from '../model/tank';
import { planDrop } from '../core/drop-sizing';
import { meterSealValidOn, workingCapacity } from '../model/fleet';

/**
 * Decides who gets a truck tomorrow.
 *
 * A tank becomes a candidate when its projected reserve day falls inside the
 * planning window. The window is deliberately wider than one day: if a tank
 * three miles past the end of a route hits reserve on Thursday and the truck is
 * going out that way on Tuesday, it goes on Tuesday's sheet. Anything else
 * means two trips down the same dirt road in one week.
 */

export type DispatchSkipReason =
  | 'not_a_forecast_account'
  | 'account_on_hold'
  | 'account_closed'
  | 'tank_out_of_service'
  | 'no_forecast'
  | 'not_due_yet'
  | 'drop_too_small';

export interface SkippedTank {
  readonly tankId: string;
  readonly reason: DispatchSkipReason;
}

export interface DispatchCandidate {
  readonly stop: CandidateStop;
  readonly forecast: TankForecast;
  readonly reserveDay?: DayKey;
  /** The last day a truck can go, once the shutdowns are taken out. */
  readonly serveBy?: DayKey;
}

export interface DispatchOptions {
  readonly asOf?: DayKey;
  /** How far ahead a reserve day still counts as due. */
  readonly windowDays?: number;
  readonly maximumStopsPerTruck?: number;
  readonly returnToYard?: boolean;
  /** Trucks to plan onto. Defaults to every active bobtail. */
  readonly truckIds?: readonly string[];
}

export interface DispatchPlan {
  readonly day: DayKey;
  readonly plan: LoadPlan;
  readonly candidates: DispatchCandidate[];
  readonly skipped: SkippedTank[];
}

export class DispatchService {
  private readonly forecasting: ForecastingService;
  private readonly calendar: DeliveryCalendar;

  constructor(
    private readonly context: AppContext,
    private readonly yard: Point,
    calendar: DeliveryCalendar = defaultCalendar(),
  ) {
    this.forecasting = new ForecastingService(context);
    this.calendar = calendar;
  }

  /** Every tank that should be on a truck inside the window, with its drop sized. */
  candidates(options: DispatchOptions = {}): {
    candidates: DispatchCandidate[];
    skipped: SkippedTank[];
  } {
    const asOf = options.asOf ?? currentDay(this.context);
    const windowDays = options.windowDays ?? 5;
    const cutoff = addDays(asOf, windowDays);
    const candidates: DispatchCandidate[] = [];
    const skipped: SkippedTank[] = [];

    for (const tank of this.context.tanks.list({ inServiceOnly: true })) {
      if (!isInService(tank, asOf)) {
        skipped.push({ tankId: tank.id, reason: 'tank_out_of_service' });
        continue;
      }
      const customer = this.context.customers.get(tank.customerId);
      if (customer.closedOn !== undefined && customer.closedOn < asOf) {
        skipped.push({ tankId: tank.id, reason: 'account_closed' });
        continue;
      }
      if (!isForecast(customer)) {
        skipped.push({ tankId: tank.id, reason: 'not_a_forecast_account' });
        continue;
      }
      if (isOnHold(customer)) {
        skipped.push({ tankId: tank.id, reason: 'account_on_hold' });
        continue;
      }
      const forecast = this.forecasting.tryForTank(tank.id, { asOf });
      if (!forecast) {
        skipped.push({ tankId: tank.id, reason: 'no_forecast' });
        continue;
      }
      const reserveDay = forecast.forecast.reserveDay;
      if (reserveDay === undefined || reserveDay > cutoff) {
        skipped.push({ tankId: tank.id, reason: 'not_due_yet' });
        continue;
      }
      const projected = forecast.forecast.days.find((entry) => entry.day === asOf);
      const gauge = projected?.gauge ?? forecast.startingPoint.gauge;
      const drop = planDrop(tank.geometry, gauge, { confidence: forecast.model.fitQuality });
      if (!drop.worthMaking) {
        skipped.push({ tankId: tank.id, reason: 'drop_too_small' });
        continue;
      }
      // A tank whose reserve day falls on a closed day has to be served before
      // the shutdown, so the urgency is measured against the last running day
      // rather than against the reserve day itself. Over a christmas that moves
      // a tank forward by three days, which is the whole point.
      const serveBy = this.calendar.serveBy(reserveDay);
      candidates.push({
        stop: {
          id: tank.id,
          tankId: tank.id,
          point: { latitude: customer.address.latitude, longitude: customer.address.longitude },
          gallons: drop.gallons,
          urgency: daysBetween(asOf, serveBy),
          ...(serveBy <= asOf ? { overdue: true } : {}),
        },
        forecast,
        reserveDay,
        serveBy,
      });
    }
    return { candidates, skipped };
  }

  /** The trucks to plan onto, as capacities the packer understands. */
  truckCapacities(options: DispatchOptions = {}): TruckCapacity[] {
    const asOf = options.asOf ?? currentDay(this.context);
    const wanted = options.truckIds;
    const trucks = wanted
      ? wanted.map((id) => this.context.fleet.getTruck(id))
      : this.context.fleet.listTrucks({ activeOnly: true, kind: 'bobtail' });
    return trucks
      .filter((truck) => truck.active)
      .filter((truck) => {
        // A truck whose meter seal has lapsed cannot write a legal ticket, so it
        // does not get a route however much capacity it has.
        if (truck.meterSealedOn === undefined) {
          return true;
        }
        return meterSealValidOn(truck, asOf);
      })
      .map((truck) => ({ truckId: truck.id, gallons: workingCapacity(truck) }));
  }

  plan(options: DispatchOptions = {}): DispatchPlan {
    const asOf = options.asOf ?? currentDay(this.context);
    const { candidates, skipped } = this.candidates(options);
    const trucks = this.truckCapacities(options);
    const plan = planLoads(
      candidates.map((candidate) => candidate.stop),
      trucks,
      {
        yard: this.yard,
        ...(options.returnToYard === undefined ? {} : { returnToYard: options.returnToYard }),
        ...(options.maximumStopsPerTruck === undefined
          ? {}
          : { maximumStopsPerTruck: options.maximumStopsPerTruck }),
      },
    );
    this.context.logger.info('planned the day', {
      day: asOf,
      candidates: candidates.length,
      routed: plan.routes.reduce((total, route) => total + route.stops.length, 0),
      deferred: plan.deferred.length,
    });
    return { day: asOf, plan, candidates, skipped };
  }
}
