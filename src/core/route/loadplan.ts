import { DistanceMatrix, Point } from './distance';
import { RouteCapacityError } from '../errors';
import { applyOrder, sequenceStops } from './sequence';
import { assertPositive } from '../../util/assert';

/**
 * Fits a day's candidate stops onto the trucks that are running.
 *
 * This is a bin packing problem with an ordering constraint bolted on, and it
 * is not solved optimally here. The rule the yard already used, and the one
 * this follows, is: the tank closest to running out goes first, and once the
 * truck is full the rest wait for tomorrow. Optimising gallons per mile ahead
 * of urgency is how a customer runs out while the truck drives past the end of
 * their road with four hundred gallons on board.
 */

export interface CandidateStop {
  readonly id: string;
  readonly tankId: string;
  readonly point: Point;
  /** Planned gallons for this stop. */
  readonly gallons: number;
  /** Lower goes first. In practice the projected days until reserve. */
  readonly urgency: number;
  /** Set when the tank is already under its reserve mark. */
  readonly overdue?: boolean;
}

export interface TruckCapacity {
  readonly truckId: string;
  readonly gallons: number;
  readonly maximumStops?: number;
}

export interface PlannedRoute {
  readonly truckId: string;
  readonly stops: CandidateStop[];
  readonly plannedGallons: number;
  readonly miles: number;
  /** Planned gallons as a share of what the truck can carry. */
  readonly utilisation: number;
}

export type DeferralReason = 'no_capacity_left' | 'stop_limit_reached' | 'no_trucks';

export interface DeferredStop {
  readonly stop: CandidateStop;
  readonly reason: DeferralReason;
}

export interface LoadPlan {
  readonly routes: PlannedRoute[];
  readonly deferred: DeferredStop[];
  readonly totalGallons: number;
  readonly totalMiles: number;
}

export interface PlanOptions {
  /** Where the trucks start and, if they reload, come back to. */
  readonly yard: Point;
  readonly returnToYard?: boolean;
  readonly maximumStopsPerTruck?: number;
}

/** Urgent first, and an overdue tank beats a merely urgent one whatever the numbers say. */
export function compareUrgency(left: CandidateStop, right: CandidateStop): number {
  if (Boolean(left.overdue) !== Boolean(right.overdue)) {
    return left.overdue ? -1 : 1;
  }
  if (left.urgency !== right.urgency) {
    return left.urgency - right.urgency;
  }
  return left.id < right.id ? -1 : 1;
}

export function planLoads(
  candidates: readonly CandidateStop[],
  trucks: readonly TruckCapacity[],
  options: PlanOptions,
): LoadPlan {
  const defaultStopLimit = options.maximumStopsPerTruck ?? 40;
  assertPositive(defaultStopLimit, 'maximum stops per truck');

  if (trucks.length === 0) {
    return {
      routes: [],
      deferred: candidates.map((stop) => ({ stop, reason: 'no_trucks' as const })),
      totalGallons: 0,
      totalMiles: 0,
    };
  }

  const assigned = new Map<string, CandidateStop[]>();
  const remaining = new Map<string, number>();
  const limits = new Map<string, number>();
  for (const truck of trucks) {
    assigned.set(truck.truckId, []);
    remaining.set(truck.truckId, truck.gallons);
    limits.set(truck.truckId, truck.maximumStops ?? defaultStopLimit);
  }

  const deferred: DeferredStop[] = [];
  for (const stop of [...candidates].sort(compareUrgency)) {
    // Put each stop on whichever running truck has the most room left, which
    // keeps the trucks balanced rather than filling the first one and sending
    // the second out half empty.
    let chosen: string | undefined;
    let chosenRoom = -1;
    let anyRoomAtAll = false;
    for (const truck of trucks) {
      const room = remaining.get(truck.truckId) as number;
      const used = (assigned.get(truck.truckId) as CandidateStop[]).length;
      if (used >= (limits.get(truck.truckId) as number)) {
        continue;
      }
      anyRoomAtAll = true;
      if (room >= stop.gallons && room > chosenRoom) {
        chosen = truck.truckId;
        chosenRoom = room;
      }
    }
    if (chosen === undefined) {
      deferred.push({
        stop,
        reason: anyRoomAtAll ? 'no_capacity_left' : 'stop_limit_reached',
      });
      continue;
    }
    (assigned.get(chosen) as CandidateStop[]).push(stop);
    remaining.set(chosen, (remaining.get(chosen) as number) - stop.gallons);
  }

  const routes: PlannedRoute[] = [];
  for (const truck of trucks) {
    const stops = assigned.get(truck.truckId) as CandidateStop[];
    if (stops.length === 0) {
      routes.push({
        truckId: truck.truckId,
        stops: [],
        plannedGallons: 0,
        miles: 0,
        utilisation: 0,
      });
      continue;
    }
    const matrix = new DistanceMatrix([options.yard, ...stops.map((stop) => stop.point)]);
    const sequenced = sequenceStops(matrix, {
      startAt: 0,
      ...(options.returnToYard ? { returnToStart: true } : {}),
    });
    // Index zero is the yard, so drop it before mapping back onto the stops.
    const ordered = applyOrder(
      stops,
      sequenced.order.filter((index) => index > 0).map((index) => index - 1),
    );
    const plannedGallons = ordered.reduce((total, stop) => total + stop.gallons, 0);
    routes.push({
      truckId: truck.truckId,
      stops: ordered,
      plannedGallons,
      miles: sequenced.miles,
      utilisation: truck.gallons === 0 ? 0 : plannedGallons / truck.gallons,
    });
  }

  return {
    routes,
    deferred,
    totalGallons: routes.reduce((total, route) => total + route.plannedGallons, 0),
    totalMiles: routes.reduce((total, route) => total + route.miles, 0),
  };
}

/** Guards a route before it is handed to a driver. */
export function assertWithinCapacity(route: PlannedRoute, capacityGallons: number): void {
  if (route.plannedGallons > capacityGallons + 1e-9) {
    throw new RouteCapacityError(
      route.truckId,
      Math.round(route.plannedGallons * 10) / 10,
      capacityGallons,
    );
  }
}
