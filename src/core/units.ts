import { assertFinite, assertInRange, assertNonNegative } from '../util/assert';

/**
 * Branded numbers for the quantities that move through the delivery math.
 *
 * Everything in this codebase that says "gallons" means US liquid gallons of
 * commercial propane, and unless the name says gross it means gallons already
 * corrected to sixty degrees. Mixing gross and net is the single most common
 * way a dealer's gallon accounting drifts, so the two are separate types.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Gallons as they came off the truck meter, at whatever temperature the liquid was. */
export type GrossGallons = Brand<number, 'GrossGallons'>;
/** Gallons corrected to sixty degrees Fahrenheit. This is what gets billed. */
export type NetGallons = Brand<number, 'NetGallons'>;
/** Degrees Fahrenheit. */
export type Fahrenheit = Brand<number, 'Fahrenheit'>;
/** Heating degree days, always relative to a stated base temperature. */
export type DegreeDays = Brand<number, 'DegreeDays'>;
/** A tank gauge reading, zero to one hundred. */
export type Percent = Brand<number, 'Percent'>;

export function grossGallons(value: number): GrossGallons {
  return assertNonNegative(value, 'gross gallons') as GrossGallons;
}

export function netGallons(value: number): NetGallons {
  return assertNonNegative(value, 'net gallons') as NetGallons;
}

export function fahrenheit(value: number): Fahrenheit {
  assertFinite(value, 'temperature');
  if (value < -80 || value > 160) {
    throw new Error(`temperature ${value}F is outside anything a meter would report`);
  }
  return value as Fahrenheit;
}

export function degreeDays(value: number): DegreeDays {
  return assertNonNegative(value, 'degree days') as DegreeDays;
}

export function percent(value: number): Percent {
  return assertInRange(value, 0, 100, 'percent') as Percent;
}

/** Physical constants for commercial propane, HD-5 grade, at sixty degrees. */
export const PROPANE = {
  /** Higher heating value of one net gallon. */
  btuPerGallon: 91_502,
  /** Weight of one net gallon at sixty degrees. */
  poundsPerGallon: 4.24,
  /** Specific gravity of the liquid at sixty degrees, referred to water. */
  specificGravity: 0.504,
  /** Cubic feet of vapour from one net gallon. */
  vapourCubicFeetPerGallon: 36.38,
} as const;

export function gallonsToBtu(gallons: NetGallons): number {
  return gallons * PROPANE.btuPerGallon;
}

export function gallonsToTherms(gallons: NetGallons): number {
  return (gallons * PROPANE.btuPerGallon) / 100_000;
}

export function gallonsToPounds(gallons: NetGallons): number {
  return gallons * PROPANE.poundsPerGallon;
}

export function poundsToGallons(pounds: number): NetGallons {
  return netGallons(assertNonNegative(pounds, 'pounds') / PROPANE.poundsPerGallon);
}

export function celsiusToFahrenheit(celsius: number): Fahrenheit {
  return fahrenheit(assertFinite(celsius, 'celsius') * 1.8 + 32);
}

export function fahrenheitToCelsius(value: Fahrenheit): number {
  return (value - 32) / 1.8;
}

/** Rounds to the tenth of a gallon, which is the resolution of a truck meter. */
export function roundGallons(value: number): number {
  assertFinite(value, 'gallons');
  return Math.round(value * 10) / 10;
}

/** Rounds a gauge reading to the nearest whole percent, which is all a dial gives. */
export function roundPercent(value: number): number {
  assertFinite(value, 'percent');
  return Math.round(value);
}
