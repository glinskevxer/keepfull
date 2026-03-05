import { Appliance } from '../model/tank';
import { PROPANE } from './units';
import { assertNonNegative } from '../util/assert';

/**
 * What each appliance pulls, in BTU per hour at full fire.
 *
 * These are the input ratings off the plates of what this dealer actually sets,
 * not a catalogue. Where a range of sizes exists the middle of what is on the
 * ground is used, because the point of this table is sizing a tank rather than
 * billing anybody, and being out by fifteen percent on a water heater does not
 * change which tank goes in the hole.
 */
export const APPLIANCE_LOAD: Readonly<Record<Appliance, number>> = {
  furnace: 100_000,
  boiler: 140_000,
  water_heater: 40_000,
  range: 65_000,
  clothes_dryer: 35_000,
  fireplace: 30_000,
  generator: 155_000,
  grain_dryer: 1_800_000,
  poultry_brooder: 350_000,
  shop_heater: 125_000,
};

/**
 * Not everything runs at once, and sizing a tank as though it did puts a
 * thousand gallon tank behind a house. A diversity factor is applied to
 * everything past the largest appliance, which is the rule the sizing tables
 * in this trade use.
 */
export const DIVERSITY_FACTOR = 0.6;

export interface LoadEstimate {
  readonly connectedBtuPerHour: number;
  readonly designBtuPerHour: number;
  readonly largest: Appliance | null;
  readonly appliances: number;
}

/** Everything added up, with no allowance for things not running together. */
export function connectedLoad(appliances: readonly Appliance[]): number {
  return appliances.reduce((total, appliance) => total + APPLIANCE_LOAD[appliance], 0);
}

/**
 * The figure a tank is sized against: the largest appliance at full fire, plus
 * a share of everything else.
 */
export function designLoad(appliances: readonly Appliance[], diversity = DIVERSITY_FACTOR): number {
  assertNonNegative(diversity, 'diversity factor');
  if (appliances.length === 0) {
    return 0;
  }
  const loads = appliances.map((appliance) => APPLIANCE_LOAD[appliance]).sort((a, b) => b - a);
  const [largest = 0, ...rest] = loads;
  return largest + rest.reduce((total, load) => total + load, 0) * diversity;
}

export function estimateLoad(
  appliances: readonly Appliance[],
  diversity = DIVERSITY_FACTOR,
): LoadEstimate {
  const sorted = [...appliances].sort((a, b) => APPLIANCE_LOAD[b] - APPLIANCE_LOAD[a]);
  return {
    connectedBtuPerHour: connectedLoad(appliances),
    designBtuPerHour: Math.round(designLoad(appliances, diversity)),
    largest: sorted[0] ?? null,
    appliances: appliances.length,
  };
}

/** Gallons an hour at full fire, which is what a driver understands. */
export function gallonsPerHour(btuPerHour: number): number {
  assertNonNegative(btuPerHour, 'btu per hour');
  return btuPerHour / PROPANE.btuPerGallon;
}

/** Hours a tank of this many gallons would last at a load, ignoring the weather. */
export function hoursAtFullFire(gallons: number, btuPerHour: number): number {
  assertNonNegative(gallons, 'gallons');
  if (btuPerHour <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (gallons * PROPANE.btuPerGallon) / btuPerHour;
}
