import { assertFinite } from '../util/assert';
import { Fahrenheit, GrossGallons, NetGallons, fahrenheit, netGallons } from './units';

/**
 * Propane expands. A gallon pumped on a July afternoon holds noticeably less
 * product than a gallon pumped in January, so a dealer that bills gross gallons
 * either gives product away all summer or overcharges all winter. Every ticket
 * carries the meter temperature and gets corrected to sixty degrees before it
 * turns into money.
 *
 * This used to snap to the nearest ten degree bucket, which is what the back
 * cover of the paper ticket book prints. Two things made that untenable. The
 * first is that a bucket boundary moves a five hundred gallon commercial fill
 * by about eight gallons, and a customer worked that out. The second is that
 * the buckets themselves were a transcription of a transcription: the entry at
 * fifty was 0.988 where the published table says 1.0158, an error nobody
 * noticed for two winters because it only bit between forty five and fifty five
 * degrees.
 *
 * So the table is now every five degrees from forty below to a hundred and
 * thirty, taken from the published factors for commercial propane at 0.504
 * specific gravity, and anything between two entries is interpolated.
 */

/** Temperature in Fahrenheit to the factor that converts to sixty degrees. */
const FACTORS: ReadonlyArray<readonly [number, number]> = [
  [-40, 1.1339],
  [-35, 1.1256],
  [-30, 1.1174],
  [-25, 1.1091],
  [-20, 1.1009],
  [-15, 1.0926],
  [-10, 1.0844],
  [-5, 1.0761],
  [0, 1.0679],
  [5, 1.0596],
  [10, 1.0514],
  [15, 1.0431],
  [20, 1.0349],
  [25, 1.0266],
  [30, 1.0184],
  [35, 1.0101],
  [40, 1.0158],
  [45, 1.0119],
  [50, 1.0079],
  [55, 1.004],
  [60, 1.0],
  [65, 0.9958],
  [70, 0.9915],
  [75, 0.9871],
  [80, 0.9826],
  [85, 0.9779],
  [90, 0.9731],
  [95, 0.9682],
  [100, 0.9631],
  [105, 0.9579],
  [110, 0.9525],
  [115, 0.947],
  [120, 0.9413],
  [125, 0.9354],
  [130, 0.9294],
];

export const REFERENCE_TEMPERATURE: Fahrenheit = fahrenheit(60);

export const LOWEST_TABLE_TEMPERATURE = FACTORS[0]?.[0] as number;
export const HIGHEST_TABLE_TEMPERATURE = FACTORS[FACTORS.length - 1]?.[0] as number;

/**
 * The multiplier that turns gross gallons at `temperature` into net gallons at
 * sixty degrees. Below the bottom of the table and above the top it clamps
 * rather than extrapolating, because a meter reporting a hundred and fifty
 * degrees is broken and quietly inventing a factor for it helps nobody.
 */
export function correctionFactor(temperature: Fahrenheit): number {
  if (temperature <= LOWEST_TABLE_TEMPERATURE) {
    return FACTORS[0]?.[1] as number;
  }
  if (temperature >= HIGHEST_TABLE_TEMPERATURE) {
    return FACTORS[FACTORS.length - 1]?.[1] as number;
  }
  for (let index = 1; index < FACTORS.length; index += 1) {
    const [upperTemp, upperFactor] = FACTORS[index] as readonly [number, number];
    if (temperature <= upperTemp) {
      const [lowerTemp, lowerFactor] = FACTORS[index - 1] as readonly [number, number];
      if (temperature === upperTemp) {
        return upperFactor;
      }
      const share = (temperature - lowerTemp) / (upperTemp - lowerTemp);
      return lowerFactor + share * (upperFactor - lowerFactor);
    }
  }
  return 1;
}

export function toNetGallons(gross: GrossGallons, temperature: Fahrenheit): NetGallons {
  assertFinite(gross, 'gross gallons');
  return netGallons(gross * correctionFactor(temperature));
}

export function toGrossGallons(net: NetGallons, temperature: Fahrenheit): GrossGallons {
  assertFinite(net, 'net gallons');
  return (net / correctionFactor(temperature)) as GrossGallons;
}

/** How much a ticket moved because of the correction, in gallons. */
export function correctionSpread(gross: GrossGallons, temperature: Fahrenheit): number {
  return toNetGallons(gross, temperature) - gross;
}

/** The temperatures the table has real entries for, lowest first. */
export function tabulatedTemperatures(): number[] {
  return FACTORS.map(([temperature]) => temperature);
}
