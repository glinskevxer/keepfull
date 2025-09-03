import { describe, expect, it } from 'vitest';
import {
  Route,
  RouteDraft,
  ROUTE_STATUSES,
  canMoveTo,
  completionShare,
  deliveredStops,
  isEditable,
  isFinished,
  makeRoute,
  missedStops,
  pendingStops,
} from '../../../src/model/route';

const draft: RouteDraft = {
  id: 'rt-1',
  truckId: 'b-4',
  driverId: 'drv-3',
  runOn: '2025-02-11',
  plannedMiles: 84.2,
  stops: [
    { id: 's-1', tankId: 't-1', customerId: 'c-1', plannedGallons: 280 },
    { id: 's-2', tankId: 't-2', customerId: 'c-2', plannedGallons: 415 },
  ],
};

function route(overrides: Partial<RouteDraft> = {}): Route {
  return makeRoute({ ...draft, ...overrides });
}

describe('makeRoute', () => {
  it('numbers the stops from one in the order given', () => {
    expect(route().stops.map((stop) => stop.position)).toEqual([1, 2]);
  });

  it('adds up the planned gallons', () => {
    expect(route().plannedGallons).toBe(695);
  });

  it('defaults to a planned route with pending stops', () => {
    const built = route();
    expect(built.status).toBe('planned');
    expect(built.stops.every((stop) => stop.outcome === 'pending')).toBe(true);
  });

  it('stamps the route id onto every stop', () => {
    expect(route().stops.every((stop) => stop.routeId === 'rt-1')).toBe(true);
  });

  it('refuses the same tank twice on one route', () => {
    expect(() =>
      route({
        stops: [
          { id: 's-1', tankId: 't-1', customerId: 'c-1', plannedGallons: 100 },
          { id: 's-2', tankId: 't-1', customerId: 'c-1', plannedGallons: 100 },
        ],
      }),
    ).toThrowError(/on this route twice/);
  });

  it('refuses a status it does not know', () => {
    expect(() => route({ status: 'running' as never })).toThrowError(/not a route status/);
  });

  it('refuses an outcome it does not know', () => {
    expect(() =>
      route({
        stops: [
          {
            id: 's-1',
            tankId: 't-1',
            customerId: 'c-1',
            plannedGallons: 100,
            outcome: 'late' as never,
          },
        ],
      }),
    ).toThrowError(/not a stop outcome/);
  });

  it('refuses a day that is not a day', () => {
    expect(() => route({ runOn: 'tuesday' })).toThrowError(/day a route could run/);
  });

  it('refuses negative gallons or miles', () => {
    expect(() => route({ plannedMiles: -1 })).toThrowError(/planned miles/);
    expect(() =>
      route({ stops: [{ id: 's-1', tankId: 't-1', customerId: 'c-1', plannedGallons: -1 }] }),
    ).toThrowError(/planned gallons/);
  });

  it('takes a route with no stops at all', () => {
    const empty = route({ stops: [] });
    expect(empty.plannedGallons).toBe(0);
    expect(completionShare(empty)).toBe(1);
  });
});

describe('status', () => {
  it('is editable only while planned', () => {
    expect(isEditable(route())).toBe(true);
    expect(isEditable(route({ status: 'released' }))).toBe(false);
  });

  it('is finished when closed or cancelled', () => {
    expect(isFinished(route({ status: 'closed' }))).toBe(true);
    expect(isFinished(route({ status: 'cancelled' }))).toBe(true);
    expect(isFinished(route({ status: 'in_progress' }))).toBe(false);
  });

  it('only moves forward', () => {
    expect(canMoveTo('planned', 'released')).toBe(true);
    expect(canMoveTo('released', 'planned')).toBe(false);
    expect(canMoveTo('in_progress', 'closed')).toBe(true);
    expect(canMoveTo('closed', 'in_progress')).toBe(false);
  });

  it('can be cancelled from anywhere it is still live', () => {
    for (const status of ROUTE_STATUSES) {
      const expected = status !== 'closed' && status !== 'cancelled';
      expect(canMoveTo(status, 'cancelled')).toBe(expected);
    }
  });
});

describe('stop groupings', () => {
  const mixed = route({
    stops: [
      { id: 's-1', tankId: 't-1', customerId: 'c-1', plannedGallons: 100, outcome: 'delivered' },
      { id: 's-2', tankId: 't-2', customerId: 'c-2', plannedGallons: 100, outcome: 'no_access' },
      { id: 's-3', tankId: 't-3', customerId: 'c-3', plannedGallons: 100, outcome: 'pending' },
      { id: 's-4', tankId: 't-4', customerId: 'c-4', plannedGallons: 100, outcome: 'skipped' },
      { id: 's-5', tankId: 't-5', customerId: 'c-5', plannedGallons: 100, outcome: 'not_needed' },
    ],
  });

  it('splits by outcome', () => {
    expect(deliveredStops(mixed).map((s) => s.id)).toEqual(['s-1']);
    expect(pendingStops(mixed).map((s) => s.id)).toEqual(['s-3']);
    expect(missedStops(mixed).map((s) => s.id)).toEqual(['s-2', 's-4']);
  });

  it('measures how much of the sheet is settled', () => {
    expect(completionShare(mixed)).toBeCloseTo(0.8, 9);
  });
});
