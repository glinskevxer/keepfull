import { assertNonNegative, assertPositive } from '../util/assert';
import { round } from '../util/round';

/**
 * Three numbers that should agree, and what it means when they do not.
 *
 * `plant` is what the bulk plant meter put on the truck. `metered` is what the
 * truck's own totalising meter says came off it. `ticketed` is the sum of the
 * gross gallons on the tickets the driver wrote.
 *
 * The two gaps say different things:
 *
 *   plant against metered   the truck meter is drifting, or product is going
 *                           somewhere nobody wrote down
 *   metered against ticketed  paperwork: a ticket missed, keyed twice, or
 *                           written for the wrong figure
 *
 * A shift that is out on both by the same amount is a truck meter. A shift out
 * on the second only is a ticket book. That distinction is the whole point of
 * carrying three numbers instead of two.
 */

export type Verdict = 'clean' | 'meter_drift' | 'paperwork' | 'both' | 'incomplete';

export interface Reconciliation {
  readonly plantGallons: number;
  readonly meteredGallons: number | null;
  readonly ticketedGallons: number;
  readonly tickets: number;
  /** Plant less metered. Positive means the truck says it delivered less than it took. */
  readonly plantVsMetered: number | null;
  /** Metered less ticketed. Positive means the tickets do not account for it all. */
  readonly meteredVsTicketed: number | null;
  readonly verdict: Verdict;
  readonly withinTolerance: boolean;
}

export interface ToleranceOptions {
  /** Share of the load either gap may be off by before it is called out. */
  readonly relative?: number;
  /** Gallons either gap may be off by regardless of load size. */
  readonly absolute?: number;
}

const DEFAULTS = {
  relative: 0.005,
  absolute: 15,
} as const;

/** How far a gap is allowed to be, on a load of this size. */
export function toleranceFor(loadGallons: number, options: ToleranceOptions = {}): number {
  assertNonNegative(loadGallons, 'load gallons');
  const relative = options.relative ?? DEFAULTS.relative;
  const absolute = options.absolute ?? DEFAULTS.absolute;
  assertNonNegative(relative, 'relative tolerance');
  assertNonNegative(absolute, 'absolute tolerance');
  return Math.max(absolute, loadGallons * relative);
}

export function reconcile(
  plantGallons: number,
  meteredGallons: number | null,
  ticketedGallons: number,
  tickets: number,
  options: ToleranceOptions = {},
): Reconciliation {
  assertNonNegative(plantGallons, 'plant gallons');
  assertNonNegative(ticketedGallons, 'ticketed gallons');
  const tolerance = toleranceFor(plantGallons, options);

  if (meteredGallons === null) {
    return {
      plantGallons,
      meteredGallons: null,
      ticketedGallons,
      tickets,
      plantVsMetered: null,
      meteredVsTicketed: null,
      verdict: 'incomplete',
      withinTolerance: false,
    };
  }

  const plantVsMetered = round(plantGallons - meteredGallons);
  const meteredVsTicketed = round(meteredGallons - ticketedGallons);
  const meterOut = Math.abs(plantVsMetered) > tolerance;
  const paperOut = Math.abs(meteredVsTicketed) > tolerance;

  let verdict: Verdict = 'clean';
  if (meterOut && paperOut) {
    verdict = 'both';
  } else if (meterOut) {
    verdict = 'meter_drift';
  } else if (paperOut) {
    verdict = 'paperwork';
  }

  return {
    plantGallons,
    meteredGallons,
    ticketedGallons,
    tickets,
    plantVsMetered,
    meteredVsTicketed,
    verdict,
    withinTolerance: verdict === 'clean',
  };
}

/**
 * A meter drifting shows up as a small gap that keeps the same sign day after
 * day. One bad day is noise; ten in a row in the same direction is a meter
 * that needs pulling, and this is what says which.
 */
export function driftTrend(
  gaps: readonly number[],
  minimumRun = 5,
): {
  run: number;
  direction: 'rich' | 'lean' | 'none';
  meanGap: number;
} {
  assertPositive(minimumRun, 'minimum run');
  if (gaps.length === 0) {
    return { run: 0, direction: 'none', meanGap: 0 };
  }
  let run = 1;
  const last = gaps[gaps.length - 1] as number;
  const sign = Math.sign(last);
  for (let index = gaps.length - 2; index >= 0; index -= 1) {
    if (Math.sign(gaps[index] as number) !== sign || sign === 0) {
      break;
    }
    run += 1;
  }
  const meanGap = round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length, 2);
  if (run < minimumRun || sign === 0) {
    return { run, direction: 'none', meanGap };
  }
  return { run, direction: sign > 0 ? 'lean' : 'rich', meanGap };
}
