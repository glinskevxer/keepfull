import { assertInRange, assertPositive } from '../util/assert';
import { NetGallons, Percent, netGallons, percent } from './units';

/**
 * A propane tank is never filled to the top. Liquid needs room to expand, so
 * the maximum permitted filling limit for an ordinary above ground tank is
 * eighty percent of its water capacity. Every gauge on the yard reads percent
 * of water capacity, not percent of the fillable part, which trips people up
 * constantly: a tank showing eighty is full, and a tank showing forty is
 * halfway through what it can hold, not two fifths.
 */

/** Water capacity in gallons, the number stamped on the data plate. */
export type WaterCapacity = number;

export const DEFAULT_FILL_LIMIT = 80;

/** The tank sizes this dealer actually sets. Anything else is a data entry slip. */
export const STOCK_CAPACITIES: readonly WaterCapacity[] = [120, 250, 320, 500, 1000];

export interface TankGeometry {
  /** Water capacity from the data plate, in gallons. */
  readonly waterCapacity: WaterCapacity;
  /** Maximum permitted filling limit, as a percent of water capacity. */
  readonly fillLimit: number;
  /** The gauge reading at which the customer is treated as needing a delivery. */
  readonly reservePercent: number;
}

export function tankGeometry(
  waterCapacity: WaterCapacity,
  options: { fillLimit?: number; reservePercent?: number } = {},
): TankGeometry {
  assertPositive(waterCapacity, 'water capacity');
  const fillLimit = options.fillLimit ?? DEFAULT_FILL_LIMIT;
  const reservePercent = options.reservePercent ?? 25;
  assertInRange(fillLimit, 10, 90, 'fill limit');
  assertInRange(reservePercent, 0, fillLimit, 'reserve percent');
  return { waterCapacity, fillLimit, reservePercent };
}

/** Gallons of liquid in the tank at a given gauge reading. */
export function gallonsAt(geometry: TankGeometry, gauge: Percent): NetGallons {
  return netGallons((geometry.waterCapacity * gauge) / 100);
}

/** The gauge reading that corresponds to a given number of gallons in the tank. */
export function gaugeFor(geometry: TankGeometry, gallons: NetGallons): Percent {
  const raw = (gallons / geometry.waterCapacity) * 100;
  return percent(Math.min(100, Math.max(0, raw)));
}

/** The most liquid this tank may legally hold. */
export function capacityToFillLimit(geometry: TankGeometry): NetGallons {
  return netGallons((geometry.waterCapacity * geometry.fillLimit) / 100);
}

/** Gallons that would fit right now without going past the filling limit. */
export function roomToFill(geometry: TankGeometry, gauge: Percent): NetGallons {
  const room = ((geometry.fillLimit - gauge) / 100) * geometry.waterCapacity;
  return netGallons(Math.max(0, room));
}

/** Gallons the customer can burn before the gauge reaches its reserve mark. */
export function gallonsAboveReserve(geometry: TankGeometry, gauge: Percent): NetGallons {
  const above = ((gauge - geometry.reservePercent) / 100) * geometry.waterCapacity;
  return netGallons(Math.max(0, above));
}

/** The working span of the tank, reserve mark up to the filling limit. */
export function usableSpan(geometry: TankGeometry): NetGallons {
  return netGallons(
    ((geometry.fillLimit - geometry.reservePercent) / 100) * geometry.waterCapacity,
  );
}

/** Vapour space above the liquid, in gallons of volume. */
export function ullage(geometry: TankGeometry, gauge: Percent): NetGallons {
  return netGallons(((100 - gauge) / 100) * geometry.waterCapacity);
}

export function isOverfilled(geometry: TankGeometry, gauge: Percent): boolean {
  return gauge > geometry.fillLimit;
}

export function isBelowReserve(geometry: TankGeometry, gauge: Percent): boolean {
  return gauge < geometry.reservePercent;
}

/** A gauge this low means the regulator is close to losing pressure. */
export const OUT_OF_GAS_PERCENT = 5;

export function isOutOfGas(gauge: Percent): boolean {
  return gauge <= OUT_OF_GAS_PERCENT;
}

export function isStockCapacity(waterCapacity: number): boolean {
  return STOCK_CAPACITIES.includes(waterCapacity);
}
