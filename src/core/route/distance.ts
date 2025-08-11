import { assertInRange, assertPositive } from '../../util/assert';

/**
 * Distances between stops.
 *
 * There is no road network in here and there is not going to be. The territory
 * is rural, the roads run along valleys, and a straight line distance times a
 * fixed factor is within about ten percent of the odometer over the stretches
 * that matter. What the routing actually needs is a consistent ordering of
 * which stop is near which, and that survives the approximation.
 */

export interface Point {
  readonly latitude: number;
  readonly longitude: number;
}

const EARTH_RADIUS_MILES = 3958.7613;

/**
 * The multiplier from straight line to road miles. Measured off forty eight
 * tickets against truck odometer readings over one November, which came out at
 * 1.27 with a fair amount of spread.
 */
export const ROAD_FACTOR = 1.27;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function checkPoint(point: Point, label = 'point'): Point {
  assertInRange(point.latitude, -90, 90, `${label} latitude`);
  assertInRange(point.longitude, -180, 180, `${label} longitude`);
  return point;
}

/** Great circle distance in miles. */
export function straightLineMiles(from: Point, to: Point): number {
  checkPoint(from, 'from');
  checkPoint(to, 'to');
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Straight line miles scaled to something a truck would actually drive. */
export function roadMiles(from: Point, to: Point, factor = ROAD_FACTOR): number {
  assertPositive(factor, 'road factor');
  return straightLineMiles(from, to) * factor;
}

/** A symmetric matrix of road miles, index by position in the input array. */
export class DistanceMatrix {
  private readonly values: number[];

  constructor(
    readonly points: readonly Point[],
    factor = ROAD_FACTOR,
  ) {
    const size = points.length;
    this.values = new Array<number>(size * size).fill(0);
    for (let i = 0; i < size; i += 1) {
      for (let j = i + 1; j < size; j += 1) {
        const miles = roadMiles(points[i] as Point, points[j] as Point, factor);
        this.values[i * size + j] = miles;
        this.values[j * size + i] = miles;
      }
    }
  }

  get size(): number {
    return this.points.length;
  }

  between(from: number, to: number): number {
    if (from < 0 || to < 0 || from >= this.size || to >= this.size) {
      throw new Error(`no stop at index ${from < 0 || from >= this.size ? from : to}`);
    }
    return this.values[from * this.size + to] as number;
  }

  /** Total miles of a tour given as an ordered list of indices. */
  tourLength(order: readonly number[], options: { closed?: boolean } = {}): number {
    if (order.length < 2) {
      return 0;
    }
    let total = 0;
    for (let index = 1; index < order.length; index += 1) {
      total += this.between(order[index - 1] as number, order[index] as number);
    }
    if (options.closed) {
      total += this.between(order[order.length - 1] as number, order[0] as number);
    }
    return total;
  }

  /** Nearest unvisited index to `from`, or undefined when everything is visited. */
  nearest(from: number, visited: ReadonlySet<number>): number | undefined {
    let best: number | undefined;
    let bestMiles = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.size; index += 1) {
      if (index === from || visited.has(index)) {
        continue;
      }
      const miles = this.between(from, index);
      if (miles < bestMiles) {
        bestMiles = miles;
        best = index;
      }
    }
    return best;
  }
}
