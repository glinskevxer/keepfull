import { OverfillError } from './errors';
import { Percent, percent } from './units';
import { TankGeometry, roomToFill } from './tank-math';
import { assertInRange, assertNonNegative } from '../util/assert';

/**
 * How many gallons to plan for a stop.
 *
 * The naive answer is "whatever fits", and it is wrong in both directions. Plan
 * the full room and the truck runs out three stops early whenever the tanks are
 * emptier than expected. Plan the full room off a projected gauge and the
 * driver arrives at a tank that is fuller than the projection said, which is
 * how a bobtail ends up carrying two hundred gallons it could not deliver.
 *
 * So the planned drop is the room at the projected gauge, less a margin that
 * grows as the projection gets shakier, and rounded down to something a
 * dispatcher would write on a sheet.
 */

/** Below this the stop costs more than the gallons are worth. */
export const MINIMUM_ECONOMIC_DROP = 100;

export interface DropOptions {
  /** Zero to one, from the burn model fit. A poor fit buys a bigger margin. */
  readonly confidence?: number;
  /** Never plan more than this, whatever the tank could take. */
  readonly maximumDrop?: number;
  /** Rounded down to a multiple of this. */
  readonly roundTo?: number;
  readonly minimumDrop?: number;
}

export interface PlannedDrop {
  readonly gallons: number;
  /** What would have fitted with no margin at all. */
  readonly roomGallons: number;
  readonly marginGallons: number;
  /** False when the stop is not worth making yet. */
  readonly worthMaking: boolean;
}

/**
 * The safety margin, as a share of the tank's room. A perfect fit still keeps
 * two percent back because the gauge itself is only good to about that.
 */
export function marginShare(confidence: number): number {
  assertInRange(confidence, 0, 1, 'confidence');
  return 0.02 + 0.13 * (1 - confidence);
}

export function planDrop(
  geometry: TankGeometry,
  projectedGauge: Percent,
  options: DropOptions = {},
): PlannedDrop {
  const confidence = options.confidence ?? 0.8;
  const roundTo = options.roundTo ?? 5;
  const minimumDrop = options.minimumDrop ?? MINIMUM_ECONOMIC_DROP;
  assertNonNegative(roundTo, 'rounding step');
  assertNonNegative(minimumDrop, 'minimum drop');

  const room = roomToFill(geometry, projectedGauge);
  const margin = room * marginShare(confidence);
  let gallons = Math.max(0, room - margin);
  if (options.maximumDrop !== undefined) {
    assertNonNegative(options.maximumDrop, 'maximum drop');
    gallons = Math.min(gallons, options.maximumDrop);
  }
  if (roundTo > 0) {
    gallons = Math.floor(gallons / roundTo) * roundTo;
  }
  return {
    gallons,
    roomGallons: room,
    marginGallons: room - gallons,
    worthMaking: gallons >= minimumDrop,
  };
}

/**
 * Checks a drop the driver is about to make against what the tank can hold.
 * This runs at the truck, on the real gauge, not on the projection.
 */
export function assertFits(
  tankId: string,
  geometry: TankGeometry,
  currentGauge: Percent,
  gallons: number,
): void {
  const room = roomToFill(geometry, currentGauge);
  if (gallons > room + 1e-9) {
    throw new OverfillError(tankId, gallons, Math.round(room * 10) / 10);
  }
}

/** The gauge a tank would read after a drop of this size. */
export function gaugeAfterDrop(
  geometry: TankGeometry,
  currentGauge: Percent,
  gallons: number,
): Percent {
  assertNonNegative(gallons, 'gallons');
  const raw = currentGauge + (gallons / geometry.waterCapacity) * 100;
  return percent(Math.min(100, raw));
}

/**
 * Total planned gallons for a set of stops. Dispatch compares this against the
 * truck before it commits to a route.
 */
export function totalPlanned(drops: readonly PlannedDrop[]): number {
  return drops.reduce((total, drop) => total + drop.gallons, 0);
}
