import { describe, expect, it } from 'vitest';
import { DistanceMatrix, Point } from '../../../../src/core/route/distance';
import {
  applyOrder,
  nearestNeighbourOrder,
  sequenceStops,
  twoOpt,
} from '../../../../src/core/route/sequence';

/** Five stops laid out along a line, so the best order is obvious. */
function alongALine(): Point[] {
  return [0, 4, 1, 3, 2].map((offset) => ({
    latitude: 42.4 + offset * 0.05,
    longitude: -76.5,
  }));
}

/** A square with the yard at one corner. */
function square(): Point[] {
  return [
    { latitude: 42.4, longitude: -76.5 },
    { latitude: 42.5, longitude: -76.5 },
    { latitude: 42.5, longitude: -76.4 },
    { latitude: 42.4, longitude: -76.4 },
  ];
}

describe('nearestNeighbourOrder', () => {
  it('starts at the yard and walks outward', () => {
    const matrix = new DistanceMatrix(alongALine());
    expect(nearestNeighbourOrder(matrix)).toEqual([0, 2, 4, 3, 1]);
  });

  it('visits every stop exactly once', () => {
    const order = nearestNeighbourOrder(new DistanceMatrix(square()));
    expect(new Set(order).size).toBe(4);
    expect(order).toHaveLength(4);
  });

  it('can start somewhere other than the first stop', () => {
    expect(nearestNeighbourOrder(new DistanceMatrix(alongALine()), 1)[0]).toBe(1);
  });

  it('handles an empty list', () => {
    expect(nearestNeighbourOrder(new DistanceMatrix([]))).toEqual([]);
  });
});

describe('twoOpt', () => {
  it('unpicks a crossing', () => {
    const matrix = new DistanceMatrix(square());
    const crossed = [0, 2, 1, 3];
    const { order } = twoOpt(matrix, crossed, { returnToStart: true });
    expect(matrix.tourLength(order, { closed: true })).toBeLessThan(
      matrix.tourLength(crossed, { closed: true }),
    );
  });

  it('leaves an already good order alone', () => {
    const matrix = new DistanceMatrix(alongALine());
    const best = [0, 2, 4, 3, 1];
    expect(twoOpt(matrix, best).order).toEqual(best);
  });

  it('never moves the first stop', () => {
    const matrix = new DistanceMatrix(square());
    expect(twoOpt(matrix, [0, 2, 1, 3]).order[0]).toBe(0);
  });

  it('stops after the pass cap', () => {
    const matrix = new DistanceMatrix(square());
    expect(twoOpt(matrix, [0, 2, 1, 3], { maximumPasses: 1 }).passes).toBe(1);
  });

  it('refuses a negative pass cap', () => {
    const matrix = new DistanceMatrix(square());
    expect(() => twoOpt(matrix, [0, 1], { maximumPasses: -1 })).toThrowError(/maximum passes/);
  });

  it('does nothing to a two stop tour', () => {
    const matrix = new DistanceMatrix(square());
    expect(twoOpt(matrix, [0, 1]).order).toEqual([0, 1]);
  });
});

describe('sequenceStops', () => {
  it('reports the miles it settled on', () => {
    const matrix = new DistanceMatrix(alongALine());
    const result = sequenceStops(matrix);
    expect(result.miles).toBeCloseTo(matrix.tourLength(result.order), 9);
  });

  it('never comes out worse than nearest neighbour', () => {
    const result = sequenceStops(new DistanceMatrix(square()), { returnToStart: true });
    expect(result.improvedMiles).toBeGreaterThanOrEqual(0);
  });

  it('finds the run along the line', () => {
    expect(sequenceStops(new DistanceMatrix(alongALine())).order).toEqual([0, 2, 4, 3, 1]);
  });

  it('handles no stops at all', () => {
    expect(sequenceStops(new DistanceMatrix([]))).toEqual({
      order: [],
      miles: 0,
      passes: 0,
      improvedMiles: 0,
    });
  });

  it('handles a single stop', () => {
    const result = sequenceStops(new DistanceMatrix([{ latitude: 42.4, longitude: -76.5 }]));
    expect(result.order).toEqual([0]);
    expect(result.miles).toBe(0);
  });

  it('closes the loop when the truck has to come back', () => {
    const matrix = new DistanceMatrix(square());
    const open = sequenceStops(matrix);
    const closed = sequenceStops(matrix, { returnToStart: true });
    expect(closed.miles).toBeGreaterThan(open.miles);
  });
});

describe('applyOrder', () => {
  it('reorders a parallel array', () => {
    expect(applyOrder(['yard', 'a', 'b', 'c'], [0, 2, 1, 3])).toEqual(['yard', 'b', 'a', 'c']);
  });

  it('refuses an order that points at nothing', () => {
    expect(() => applyOrder(['a'], [0, 4])).toThrowError(/stop 4, which is not in the list/);
  });

  it('handles an empty order', () => {
    expect(applyOrder(['a'], [])).toEqual([]);
  });
});
