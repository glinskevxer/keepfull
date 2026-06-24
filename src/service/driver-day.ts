import { AppContext, currentDay } from './context';
import { DayKey } from '../util/dates';
import { DistanceMatrix, Point } from '../core/route/distance';
import { NotFoundError } from '../core/errors';
import { meteredOut } from '../model/truck-load';

/**
 * What one driver did in a day.
 *
 * This is not a scorecard and it is not used as one, which matters because the
 * first version was and it changed behaviour immediately: drivers started
 * skipping the small drops that made their gallons per stop look bad, which is
 * exactly the opposite of what the yard wanted. What it is for is answering
 * questions after the fact, and for spotting a truck whose numbers stop making
 * sense.
 */

export interface DriverDay {
  readonly driverId: string;
  readonly day: DayKey;
  readonly stops: number;
  readonly delivered: number;
  readonly missed: number;
  readonly grossGallons: number;
  readonly netGallons: number;
  readonly plannedGallons: number;
  /** Delivered as a share of planned, where there was a route. */
  readonly fillRate: number | null;
  readonly plannedMiles: number;
  readonly gallonsPerStop: number | null;
  readonly gallonsPerMile: number | null;
  /** Gallons the truck came back with, when the shift was closed out. */
  readonly returnedGallons: number | null;
  readonly flags: string[];
}

export class DriverDayService {
  constructor(private readonly context: AppContext) {}

  forDriver(driverId: string, day?: DayKey): DriverDay {
    const on = day ?? currentDay(this.context);
    this.context.fleet.getDriver(driverId);

    const tickets = this.context.deliveries.list({
      driverId,
      from: on,
      to: on,
      postedOnly: true,
    });
    const routes = this.context.routes.list({ driverId, runOn: on });
    const loads = this.context.loads.list({ driverId, from: on, to: on });

    const grossGallons = round(tickets.reduce((total, ticket) => total + ticket.gross, 0));
    const netGallons = round(tickets.reduce((total, ticket) => total + ticket.net, 0));
    const stops = routes.reduce((total, route) => total + route.stops.length, 0);
    const delivered = routes.reduce(
      (total, route) => total + route.stops.filter((stop) => stop.outcome === 'delivered').length,
      0,
    );
    const missed = routes.reduce(
      (total, route) =>
        total +
        route.stops.filter((stop) => stop.outcome === 'no_access' || stop.outcome === 'skipped')
          .length,
      0,
    );
    const plannedGallons = round(routes.reduce((total, route) => total + route.plannedGallons, 0));
    const plannedMiles = round(routes.reduce((total, route) => total + route.plannedMiles, 0));
    const metered = loads.reduce<number | null>((total, load) => {
      const out = meteredOut(load);
      return out === undefined || total === null ? null : total + out;
    }, 0);
    const loaded = round(loads.reduce((total, load) => total + load.plantGross, 0));

    const flags: string[] = [];
    if (missed > 0) {
      flags.push(`${missed} stops not made`);
    }
    if (plannedGallons > 0 && grossGallons / plannedGallons < 0.7) {
      flags.push('delivered well under what was planned');
    }
    if (metered !== null && Math.abs(metered - grossGallons) > Math.max(15, loaded * 0.005)) {
      flags.push('the truck meter and the tickets disagree');
    }

    return {
      driverId,
      day: on,
      stops,
      delivered,
      missed,
      grossGallons,
      netGallons,
      plannedGallons,
      fillRate: plannedGallons > 0 ? round(grossGallons / plannedGallons, 4) : null,
      plannedMiles,
      gallonsPerStop: tickets.length > 0 ? round(netGallons / tickets.length) : null,
      gallonsPerMile: plannedMiles > 0 ? round(netGallons / plannedMiles, 2) : null,
      returnedGallons: metered === null ? null : round(loaded - metered),
      flags,
    };
  }

  /** Every driver who did anything on a day. */
  forDay(day?: DayKey): DriverDay[] {
    const on = day ?? currentDay(this.context);
    const ids = new Set<string>();
    for (const ticket of this.context.deliveries.list({ from: on, to: on, postedOnly: true })) {
      ids.add(ticket.driverId);
    }
    for (const route of this.context.routes.list({ runOn: on })) {
      if (route.driverId) {
        ids.add(route.driverId);
      }
    }
    return [...ids]
      .sort()
      .filter((id) => this.context.fleet.findDriver(id) !== undefined)
      .map((id) => this.forDriver(id, on));
  }

  /**
   * Miles the stops actually sat apart, as opposed to what dispatch planned.
   * A route driven out of order shows up here and nowhere else.
   */
  drivenOrderMiles(routeId: string, yard: Point): number {
    const route = this.context.routes.get(routeId);
    if (route.stops.length === 0) {
      return 0;
    }
    const points: Point[] = [yard];
    for (const stop of route.stops) {
      const customer = this.context.customers.find(stop.customerId);
      if (!customer) {
        throw new NotFoundError('customer', stop.customerId);
      }
      points.push({
        latitude: customer.address.latitude,
        longitude: customer.address.longitude,
      });
    }
    const matrix = new DistanceMatrix(points);
    return round(matrix.tourLength(points.map((_point, index) => index)));
  }
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
