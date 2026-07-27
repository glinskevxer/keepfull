import { assertFinite, assertInteger } from './assert';

/**
 * Rounding for display.
 *
 * Seven files had grown their own copy of this, with three different defaults,
 * so the same figure came out as 4.3, 4.33 and 4 depending on which one had
 * been reached for. None of them are wrong on their own and the inconsistency
 * was the whole problem: two screens showing a tank's burn rate disagreed and
 * neither was more right than the other.
 *
 * This is for presentation only. Nothing that has to add back to a total goes
 * through here, which is why money has its own integer types.
 */

/** Rounds to a number of decimal places, half away from zero. */
export function round(value: number, places = 1): number {
  assertFinite(value, 'value');
  assertInteger(places, 'places');
  if (places < 0) {
    throw new Error(`cannot round to ${places} places`);
  }
  const factor = 10 ** places;
  const scaled = value * factor;
  // Math.round takes a half towards positive infinity, so -0.5 becomes -0 and
  // -1.5 becomes -1. Rounding the magnitude and putting the sign back is what
  // anybody reading the number expects.
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / factor;
}

/** Gallons, to the tenth, which is the resolution of a truck meter. */
export function roundGallons(value: number): number {
  return round(value, 1);
}

/** A rate, to four places, which is where a gallon per degree day stops mattering. */
export function roundRate(value: number): number {
  return round(value, 4);
}

/** A share, as a percentage to no decimals, for a screen. */
export function roundPercent(value: number): number {
  return round(value * 100, 0);
}
