import { AppContext } from './context';
import { ConflictError, NotFoundError } from '../core/errors';
import { DayKey, addDays } from '../util/dates';
import { DispatchPlan } from './dispatch';
import { Route, RouteStop, isEditable, makeRoute } from '../model/route';
import { canHaulPropane } from '../model/fleet';
import { inTransaction } from '../db/connection';

/**
 * Turns a plan into routes somebody is going to drive, and takes the results
 * back afterwards.
 *
 * Committing a plan is the point where it stops being a suggestion. From then
 * on the stops keep their planned gallons whatever the driver actually pumped,
 * because the gap between the two is the only measure this system has of
 * whether its forecasts are any good.
 */

export interface CommitOptions {
  /** The day the routes run, which is usually the day after the plan was made. */
  readonly runOn?: DayKey;
  /** Driver per truck. A truck with no driver still gets a route, unassigned. */
  readonly drivers?: Readonly<Record<string, string>>;
  /** Throw away any existing planned route for the same truck and day. */
  readonly replaceExisting?: boolean;
}

export class RoutingService {
  constructor(private readonly context: AppContext) {}

  commit(plan: DispatchPlan, options: CommitOptions = {}): Route[] {
    const runOn = options.runOn ?? addDays(plan.day, 1);
    const drivers = options.drivers ?? {};
    const committed: Route[] = [];

    inTransaction(this.context.db, () => {
      for (const planned of plan.plan.routes) {
        if (planned.stops.length === 0) {
          continue;
        }
        const driverId = drivers[planned.truckId];
        if (driverId !== undefined) {
          const driver = this.context.fleet.getDriver(driverId);
          if (!canHaulPropane(driver, runOn)) {
            throw new ConflictError(`${driver.name} cannot haul on ${runOn}`, {
              driverId,
              runOn,
            });
          }
        }
        if (options.replaceExisting) {
          for (const existing of this.context.routes.list({ runOn, truckId: planned.truckId })) {
            if (isEditable(existing)) {
              this.context.routes.delete(existing.id);
            }
          }
        }
        const routeId = this.context.ids.next('rt');
        const route = makeRoute({
          id: routeId,
          truckId: planned.truckId,
          ...(driverId ? { driverId } : {}),
          runOn,
          plannedMiles: Math.round(planned.miles * 10) / 10,
          stops: planned.stops.map((stop, index) => ({
            id: `${routeId}-${index + 1}`,
            tankId: stop.tankId,
            customerId: this.context.tanks.get(stop.tankId).customerId,
            plannedGallons: stop.gallons,
          })),
        });
        this.context.routes.save(route);
        committed.push(route);
      }
    });

    this.context.logger.info('committed the plan', {
      runOn,
      routes: committed.length,
      stops: committed.reduce((total, route) => total + route.stops.length, 0),
    });
    return committed;
  }

  release(routeId: string, driverId?: string): Route {
    const route = this.context.routes.get(routeId);
    if (route.stops.length === 0) {
      throw new ConflictError('an empty route is not worth releasing', { routeId });
    }
    const assigned = driverId ?? route.driverId;
    if (assigned === undefined) {
      throw new ConflictError('a route needs a driver before it goes out', { routeId });
    }
    const driver = this.context.fleet.getDriver(assigned);
    if (!canHaulPropane(driver, route.runOn)) {
      throw new ConflictError(`${driver.name} cannot haul on ${route.runOn}`, {
        driverId: assigned,
        runOn: route.runOn,
      });
    }
    if (assigned !== route.driverId) {
      this.context.routes.assignDriver(routeId, assigned);
    }
    this.context.routes.setStatus(routeId, 'released');
    return this.context.routes.get(routeId);
  }

  /** Ties a posted ticket to the stop it came from and marks the stop done. */
  recordDelivery(routeId: string, tankId: string, deliveryId: string): RouteStop {
    const route = this.context.routes.get(routeId);
    const stop = route.stops.find((entry) => entry.tankId === tankId);
    if (!stop) {
      throw new NotFoundError('stop for tank on this route', tankId);
    }
    this.context.deliveries.get(deliveryId);
    this.context.routes.settleStop(stop.id, 'delivered', { deliveryId });
    if (route.status === 'released') {
      this.context.routes.setStatus(routeId, 'in_progress');
    }
    return this.context.routes
      .get(routeId)
      .stops.find((entry) => entry.id === stop.id) as RouteStop;
  }

  missed(
    routeId: string,
    tankId: string,
    reason: 'no_access' | 'not_needed' | 'skipped',
    note?: string,
  ): void {
    const route = this.context.routes.get(routeId);
    const stop = route.stops.find((entry) => entry.tankId === tankId);
    if (!stop) {
      throw new NotFoundError('stop for tank on this route', tankId);
    }
    this.context.routes.settleStop(stop.id, reason, note === undefined ? {} : { note });
  }

  /** Closes a route once nothing is pending, and refuses while anything is. */
  close(routeId: string): Route {
    const route = this.context.routes.get(routeId);
    const pending = route.stops.filter((stop) => stop.outcome === 'pending');
    if (pending.length > 0) {
      throw new ConflictError(`${pending.length} stops on ${routeId} are still open`, {
        routeId,
        pending: pending.length,
      });
    }
    if (route.status === 'released') {
      this.context.routes.setStatus(routeId, 'in_progress');
    }
    this.context.routes.setStatus(routeId, 'closed');
    return this.context.routes.get(routeId);
  }

  cancel(routeId: string, reason: string): Route {
    this.context.routes.setStatus(routeId, 'cancelled');
    this.context.logger.warn('cancelled a route', { routeId, reason });
    return this.context.routes.get(routeId);
  }
}
