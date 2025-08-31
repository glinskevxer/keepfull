import { describe, expect, it } from 'vitest';
import {
  CandidateStop,
  TruckCapacity,
  assertWithinCapacity,
  compareUrgency,
  planLoads,
} from '../../../../src/core/route/loadplan';
import { Point } from '../../../../src/core/route/distance';
import { RouteCapacityError } from '../../../../src/core/errors';

const yard: Point = { latitude: 42.4432, longitude: -76.5019 };

function stop(id: string, gallons: number, urgency: number, offset = 0): CandidateStop {
  return {
    id,
    tankId: `t-${id}`,
    gallons,
    urgency,
    point: { latitude: 42.4 + offset * 0.03, longitude: -76.5 + offset * 0.02 },
  };
}

const oneTruck: TruckCapacity[] = [{ truckId: 'B-4', gallons: 2350 }];

describe('compareUrgency', () => {
  it('puts the soonest first', () => {
    expect(compareUrgency(stop('a', 100, 2), stop('b', 100, 9))).toBeLessThan(0);
  });

  it('puts an overdue tank ahead of everything', () => {
    const overdue = { ...stop('b', 100, 30), overdue: true };
    expect(compareUrgency(overdue, stop('a', 100, 1))).toBeLessThan(0);
  });

  it('breaks a tie on the stop id so the order is stable', () => {
    expect(compareUrgency(stop('a', 100, 4), stop('b', 100, 4))).toBeLessThan(0);
  });
});

describe('planLoads', () => {
  it('puts every stop on the truck when they all fit', () => {
    const plan = planLoads([stop('a', 300, 3), stop('b', 400, 5, 1)], oneTruck, { yard });
    expect(plan.routes[0]?.stops).toHaveLength(2);
    expect(plan.deferred).toEqual([]);
    expect(plan.totalGallons).toBe(700);
  });

  it('defers what does not fit and says why', () => {
    const plan = planLoads([stop('a', 2000, 1), stop('b', 1000, 2, 1)], oneTruck, { yard });
    expect(plan.routes[0]?.stops.map((s) => s.id)).toEqual(['a']);
    expect(plan.deferred).toEqual([
      { stop: expect.objectContaining({ id: 'b' }), reason: 'no_capacity_left' },
    ]);
  });

  it('serves the urgent tank first when only one fits', () => {
    const plan = planLoads([stop('a', 2000, 9), stop('b', 2000, 1, 1)], oneTruck, { yard });
    expect(plan.routes[0]?.stops.map((s) => s.id)).toEqual(['b']);
  });

  it('drives past a nearby stop to reach an overdue one', () => {
    const near = stop('near', 2000, 4, 0);
    const far = { ...stop('far', 2000, 20, 5), overdue: true };
    const plan = planLoads([near, far], oneTruck, { yard });
    expect(plan.routes[0]?.stops.map((s) => s.id)).toEqual(['far']);
  });

  it('reports utilisation against the truck', () => {
    const plan = planLoads([stop('a', 1175, 1)], oneTruck, { yard });
    expect(plan.routes[0]?.utilisation).toBeCloseTo(0.5, 9);
  });

  it('honours a stop limit', () => {
    const stops = [1, 2, 3, 4].map((n) => stop(`s${n}`, 100, n, n));
    const plan = planLoads(stops, [{ truckId: 'B-4', gallons: 2350, maximumStops: 2 }], { yard });
    expect(plan.routes[0]?.stops).toHaveLength(2);
    expect(plan.deferred.map((d) => d.reason)).toEqual([
      'stop_limit_reached',
      'stop_limit_reached',
    ]);
  });

  it('takes a default stop limit from the options', () => {
    const stops = [1, 2, 3].map((n) => stop(`s${n}`, 100, n, n));
    const plan = planLoads(stops, oneTruck, { yard, maximumStopsPerTruck: 1 });
    expect(plan.routes[0]?.stops).toHaveLength(1);
  });

  it('refuses a stop limit of zero', () => {
    expect(() => planLoads([], oneTruck, { yard, maximumStopsPerTruck: 0 })).toThrowError(
      /maximum stops/,
    );
  });
});

describe('several trucks', () => {
  const twoTrucks: TruckCapacity[] = [
    { truckId: 'B-4', gallons: 2350 },
    { truckId: 'B-7', gallons: 1800 },
  ];

  it('balances rather than filling the first truck', () => {
    const stops = [1, 2, 3, 4].map((n) => stop(`s${n}`, 600, n, n));
    const plan = planLoads(stops, twoTrucks, { yard });
    expect(plan.routes[0]?.stops.length).toBeGreaterThan(0);
    expect(plan.routes[1]?.stops.length).toBeGreaterThan(0);
    expect(plan.deferred).toEqual([]);
  });

  it('gives an empty route for a truck that got nothing', () => {
    const plan = planLoads([stop('a', 100, 1)], twoTrucks, { yard });
    const empty = plan.routes.find((route) => route.stops.length === 0);
    expect(empty).toMatchObject({ plannedGallons: 0, miles: 0, utilisation: 0 });
  });

  it('defers everything when no truck is running', () => {
    const plan = planLoads([stop('a', 100, 1)], [], { yard });
    expect(plan.routes).toEqual([]);
    expect(plan.deferred[0]?.reason).toBe('no_trucks');
    expect(plan.totalGallons).toBe(0);
  });
});

describe('the route that comes out', () => {
  it('sequences the stops it was given', () => {
    const stops = [stop('far', 200, 1, 5), stop('near', 200, 2, 1), stop('mid', 200, 3, 3)];
    const plan = planLoads(stops, oneTruck, { yard });
    expect(plan.routes[0]?.stops.map((s) => s.id)).toEqual(['near', 'mid', 'far']);
  });

  it('drives further when the truck has to come back', () => {
    const stops = [stop('a', 200, 1, 1), stop('b', 200, 2, 4)];
    const open = planLoads(stops, oneTruck, { yard });
    const closed = planLoads(stops, oneTruck, { yard, returnToYard: true });
    expect(closed.totalMiles).toBeGreaterThan(open.totalMiles);
  });

  it('reports zero miles for an empty day', () => {
    const plan = planLoads([], oneTruck, { yard });
    expect(plan.totalMiles).toBe(0);
    expect(plan.routes[0]?.stops).toEqual([]);
  });
});

describe('assertWithinCapacity', () => {
  it('passes a route that fits', () => {
    const plan = planLoads([stop('a', 300, 1)], oneTruck, { yard });
    expect(() => assertWithinCapacity(plan.routes[0]!, 2350)).not.toThrow();
  });

  it('refuses one that does not', () => {
    const plan = planLoads([stop('a', 300, 1)], oneTruck, { yard });
    expect(() => assertWithinCapacity(plan.routes[0]!, 200)).toThrowError(RouteCapacityError);
    expect(() => assertWithinCapacity(plan.routes[0]!, 200)).toThrowError(
      /against a working capacity of 200/,
    );
  });
});
