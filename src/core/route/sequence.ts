import { DistanceMatrix } from './distance';
import { assertNonNegative } from '../../util/assert';

/**
 * Puts a day's stops in an order the driver would not argue with.
 *
 * Nearest neighbour from the yard, then two opt until it stops improving. Two
 * opt is enough here: a bobtail route is fifteen to thirty stops and the
 * savings past two opt are inside the error in the distances themselves. The
 * pass is capped so an odd set of stops cannot spin.
 */

export interface SequenceOptions {
  /** Index of the stop the truck starts from, usually the yard. */
  readonly startAt?: number;
  /** Whether the truck has to come back, which it does when it needs to reload. */
  readonly returnToStart?: boolean;
  readonly maximumPasses?: number;
}

export interface SequenceResult {
  readonly order: number[];
  readonly miles: number;
  readonly passes: number;
  readonly improvedMiles: number;
}

export function nearestNeighbourOrder(matrix: DistanceMatrix, startAt = 0): number[] {
  if (matrix.size === 0) {
    return [];
  }
  const order = [startAt];
  const visited = new Set<number>([startAt]);
  let current = startAt;
  while (visited.size < matrix.size) {
    const next = matrix.nearest(current, visited);
    if (next === undefined) {
      break;
    }
    order.push(next);
    visited.add(next);
    current = next;
  }
  return order;
}

/**
 * Reverses the segment between two positions. This is the whole of two opt: a
 * tour that crosses itself gets shorter when the crossing segment is flipped.
 */
function reverseSegment(order: number[], from: number, to: number): number[] {
  const copy = [...order];
  let left = from;
  let right = to;
  while (left < right) {
    const swap = copy[left] as number;
    copy[left] = copy[right] as number;
    copy[right] = swap;
    left += 1;
    right -= 1;
  }
  return copy;
}

export function twoOpt(
  matrix: DistanceMatrix,
  start: readonly number[],
  options: SequenceOptions = {},
): { order: number[]; passes: number } {
  const closed = options.returnToStart ?? false;
  const maximumPasses = options.maximumPasses ?? 40;
  assertNonNegative(maximumPasses, 'maximum passes');
  let order = [...start];
  let passes = 0;
  let improved = true;

  while (improved && passes < maximumPasses) {
    improved = false;
    passes += 1;
    let best = matrix.tourLength(order, { closed });
    // The first stop is the yard and does not move.
    for (let i = 1; i < order.length - 1; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const candidate = reverseSegment(order, i, j);
        const miles = matrix.tourLength(candidate, { closed });
        if (miles < best - 1e-9) {
          order = candidate;
          best = miles;
          improved = true;
        }
      }
    }
  }
  return { order, passes };
}

export function sequenceStops(
  matrix: DistanceMatrix,
  options: SequenceOptions = {},
): SequenceResult {
  const startAt = options.startAt ?? 0;
  const closed = options.returnToStart ?? false;
  if (matrix.size === 0) {
    return { order: [], miles: 0, passes: 0, improvedMiles: 0 };
  }
  const greedy = nearestNeighbourOrder(matrix, startAt);
  const greedyMiles = matrix.tourLength(greedy, { closed });
  const { order, passes } = twoOpt(matrix, greedy, options);
  const miles = matrix.tourLength(order, { closed });
  return { order, miles, passes, improvedMiles: greedyMiles - miles };
}

/** Reorders any array of stops to match a sequence result. */
export function applyOrder<T>(items: readonly T[], order: readonly number[]): T[] {
  return order.map((index) => {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`the order refers to stop ${index}, which is not in the list`);
    }
    return item;
  });
}
