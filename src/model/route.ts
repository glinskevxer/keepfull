import { DayKey, dayKey, isDayKey } from '../util/dates';
import { InvalidInputError } from '../core/errors';
import { assertNonEmpty, assertNonNegative } from '../util/assert';

/**
 * A day's work for one truck, once dispatch has committed to it.
 *
 * The plan and the route are different things on purpose. A plan is what the
 * packer produced and can be thrown away. A route has been printed, handed to a
 * driver, and is going to be reconciled against tickets tonight, so its stops
 * keep their planned gallons even after the real drop comes back different.
 */

export type RouteStatus = 'planned' | 'released' | 'in_progress' | 'closed' | 'cancelled';

export const ROUTE_STATUSES: readonly RouteStatus[] = [
  'planned',
  'released',
  'in_progress',
  'closed',
  'cancelled',
];

export type StopOutcome = 'pending' | 'delivered' | 'no_access' | 'not_needed' | 'skipped';

export const STOP_OUTCOMES: readonly StopOutcome[] = [
  'pending',
  'delivered',
  'no_access',
  'not_needed',
  'skipped',
];

export interface RouteStop {
  readonly id: string;
  readonly routeId: string;
  readonly tankId: string;
  readonly customerId: string;
  /** One based position on the printed sheet. */
  readonly position: number;
  readonly plannedGallons: number;
  readonly outcome: StopOutcome;
  /** Ticket the driver wrote, once there is one. */
  readonly deliveryId?: string;
  readonly note?: string;
}

export interface Route {
  readonly id: string;
  readonly truckId: string;
  readonly driverId?: string;
  readonly runOn: DayKey;
  readonly status: RouteStatus;
  readonly plannedGallons: number;
  readonly plannedMiles: number;
  readonly stops: readonly RouteStop[];
}

export interface RouteStopDraft {
  readonly id: string;
  readonly tankId: string;
  readonly customerId: string;
  readonly plannedGallons: number;
  readonly outcome?: StopOutcome;
  readonly deliveryId?: string;
  readonly note?: string;
}

export interface RouteDraft {
  readonly id: string;
  readonly truckId: string;
  readonly driverId?: string;
  readonly runOn: string;
  readonly status?: RouteStatus;
  readonly plannedMiles?: number;
  readonly stops: readonly RouteStopDraft[];
}

export function makeRoute(draft: RouteDraft): Route {
  assertNonEmpty(draft.id, 'route id');
  assertNonEmpty(draft.truckId, 'truck id');
  if (!isDayKey(draft.runOn)) {
    throw new InvalidInputError(`"${draft.runOn}" is not a day a route could run`);
  }
  const status = draft.status ?? 'planned';
  if (!ROUTE_STATUSES.includes(status)) {
    throw new InvalidInputError(`"${status}" is not a route status`);
  }
  const plannedMiles = assertNonNegative(draft.plannedMiles ?? 0, 'planned miles');
  const seen = new Set<string>();
  const stops = draft.stops.map((stop, index) => {
    assertNonEmpty(stop.id, 'stop id');
    assertNonEmpty(stop.tankId, 'tank id');
    if (seen.has(stop.tankId)) {
      throw new InvalidInputError(`tank ${stop.tankId} is on this route twice`, {
        tankId: stop.tankId,
      });
    }
    seen.add(stop.tankId);
    const outcome = stop.outcome ?? 'pending';
    if (!STOP_OUTCOMES.includes(outcome)) {
      throw new InvalidInputError(`"${outcome}" is not a stop outcome`);
    }
    return {
      id: stop.id,
      routeId: draft.id,
      tankId: stop.tankId,
      customerId: stop.customerId,
      position: index + 1,
      plannedGallons: assertNonNegative(stop.plannedGallons, 'planned gallons'),
      outcome,
      ...(stop.deliveryId ? { deliveryId: stop.deliveryId } : {}),
      ...(stop.note ? { note: stop.note } : {}),
    } satisfies RouteStop;
  });
  return {
    id: draft.id,
    truckId: draft.truckId,
    ...(draft.driverId ? { driverId: draft.driverId } : {}),
    runOn: dayKey(draft.runOn),
    status,
    plannedGallons: stops.reduce((total, stop) => total + stop.plannedGallons, 0),
    plannedMiles,
    stops,
  };
}

/** A route can still be changed until it has been handed to a driver. */
export function isEditable(route: Route): boolean {
  return route.status === 'planned';
}

export function isFinished(route: Route): boolean {
  return route.status === 'closed' || route.status === 'cancelled';
}

export function pendingStops(route: Route): RouteStop[] {
  return route.stops.filter((stop) => stop.outcome === 'pending');
}

export function deliveredStops(route: Route): RouteStop[] {
  return route.stops.filter((stop) => stop.outcome === 'delivered');
}

/** Stops the driver could not make, which go back into tomorrow's candidates. */
export function missedStops(route: Route): RouteStop[] {
  return route.stops.filter((stop) => stop.outcome === 'no_access' || stop.outcome === 'skipped');
}

export function completionShare(route: Route): number {
  if (route.stops.length === 0) {
    return 1;
  }
  const settled = route.stops.filter((stop) => stop.outcome !== 'pending').length;
  return settled / route.stops.length;
}

const ALLOWED_NEXT: Record<RouteStatus, readonly RouteStatus[]> = {
  planned: ['released', 'cancelled'],
  released: ['in_progress', 'cancelled'],
  in_progress: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

export function canMoveTo(from: RouteStatus, to: RouteStatus): boolean {
  return (ALLOWED_NEXT[from] as readonly RouteStatus[]).includes(to);
}
