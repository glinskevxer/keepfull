import { assertFinite } from '../util/assert';
import { Fahrenheit, GrossGallons, NetGallons, fahrenheit, netGallons } from './units';

/**
 * Propane expands. A gallon pumped on a July afternoon holds noticeably less
 * product than a gallon pumped in January, so a dealer that bills gross gallons
 * either gives product away all summer or overcharges all winter. Every ticket
 * carries the meter temperature and gets corrected to sixty degrees before it
 * turns into money.
 *
 * This first pass uses the coarse table the office was already working from,
 * bucketed every ten degrees. It is good enough to stop the summer bleed and
 * it is what the paper ticket book prints on the back cover.
 */

/** Temperature bucket to multiplier, for commercial propane at 0.504 specific gravity. */
const COARSE_FACTORS: ReadonlyArray<readonly [number, number]> = [
  [-30, 1.111],
  [-20, 1.096],
  [-10, 1.081],
  [0, 1.066],
  [10, 1.051],
  [20, 1.035],
  [30, 1.02],
  [40, 1.004],
  [50, 0.988],
  [60, 1.0],
  [70, 0.955],
  [80, 0.937],
  [90, 0.918],
  [100, 0.898],
  [110, 0.877],
];

export const REFERENCE_TEMPERATURE: Fahrenheit = fahrenheit(60);

function nearestBucket(temperature: Fahrenheit): readonly [number, number] {
  let best = COARSE_FACTORS[0] as readonly [number, number];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of COARSE_FACTORS) {
    const distance = Math.abs(entry[0] - temperature);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

/**
 * The multiplier that turns gross gallons at `temperature` into net gallons at
 * sixty degrees. Above sixty the factor is below one, below sixty it is above.
 */
export function correctionFactor(temperature: Fahrenheit): number {
  const [, factor] = nearestBucket(temperature);
  return factor;
}

export function toNetGallons(gross: GrossGallons, temperature: Fahrenheit): NetGallons {
  assertFinite(gross, 'gross gallons');
  return netGallons(gross * correctionFactor(temperature));
}

export function toGrossGallons(net: NetGallons, temperature: Fahrenheit): GrossGallons {
  assertFinite(net, 'net gallons');
  const factor = correctionFactor(temperature);
  return (net / factor) as GrossGallons;
}

/** How much a ticket moved because of the correction, in gallons. */
export function correctionSpread(gross: GrossGallons, temperature: Fahrenheit): number {
  return toNetGallons(gross, temperature) - gross;
}

/** The buckets the coarse table knows about, lowest first. */
export function supportedBuckets(): number[] {
  return COARSE_FACTORS.map(([bucket]) => bucket);
}
