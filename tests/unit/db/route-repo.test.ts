import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { FleetRepository } from '../../../src/db/repo/fleet-repo';
import { RouteRepository } from '../../../src/db/repo/route-repo';
import { TankRepository } from '../../../src/db/repo/tank-repo';
import { aCustomer, aTank } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';
import { makeRoute } from '../../../src/model/route';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const customers = new CustomerRepository(db);
  const tanks = new TankRepository(db);
  const fleet = new FleetRepository(db);
  const customer = aCustomer();
  customers.insert(customer);
  const first = aTank(customer.id);
  const second = aTank(customer.id);
  tanks.insert(first);
  tanks.insert(second);
  fleet.saveTruck(makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }));
  fleet.saveDriver(makeDriver({ id: 'drv-3', name: 'R Vandemark', licenceNumber: 'NY-1' }));
  return { db, routes: new RouteRepository(db), fleet, customer, first, second };
}

function aRoute(context: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? 'rt-1';
  return makeRoute({
    truckId: 'b-4',
    driverId: 'drv-3',
    runOn: '2025-02-11',
    plannedMiles: 84.2,
    stops: [
      {
        id: `${id}-s1`,
        tankId: context.first.id,
        customerId: context.customer.id,
        plannedGallons: 280,
      },
      {
        id: `${id}-s2`,
        tankId: context.second.id,
        customerId: context.customer.id,
        plannedGallons: 415,
      },
    ],
    ...overrides,
    id,
  });
}

describe('save and read back', () => {
  it('round trips the route and its stops', () => {
    const context = setup();
    const route = aRoute(context);
    context.routes.save(route);
    expect(context.routes.get('rt-1')).toEqual(route);
  });

  it('replaces the stops on a second save', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.save(
      aRoute(context, {
        stops: [
          {
            id: 's-9',
            tankId: context.first.id,
            customerId: context.customer.id,
            plannedGallons: 100,
          },
        ],
      }),
    );
    const back = context.routes.get('rt-1');
    expect(back.stops.map((stop) => stop.id)).toEqual(['s-9']);
    expect(back.plannedGallons).toBe(100);
  });

  it('refuses two live routes for one truck on one day', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    expect(() => context.routes.save(aRoute(context, { id: 'rt-2' }))).toThrowError(
      /already has a route on 2025-02-11/,
    );
  });

  it('allows a second route once the first is cancelled', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.setStatus('rt-1', 'cancelled');
    expect(() => context.routes.save(aRoute(context, { id: 'rt-2' }))).not.toThrow();
  });

  it('rolls the whole save back when a stop is bad', () => {
    const context = setup();
    expect(() =>
      context.routes.save(
        aRoute(context, {
          stops: [
            { id: 's-1', tankId: 't-nope', customerId: context.customer.id, plannedGallons: 10 },
          ],
        }),
      ),
    ).toThrowError();
    expect(context.routes.find('rt-1')).toBeUndefined();
  });

  it('throws for a route it does not hold', () => {
    expect(() => setup().routes.get('rt-9')).toThrowError(/no route with id rt-9/);
  });
});

describe('list', () => {
  function seeded() {
    const context = setup();
    context.routes.save(aRoute(context));
    context.fleet.saveTruck(makeTruck({ id: 'b-7', unitNumber: 'B-7', waterCapacity: 2600 }));
    context.routes.save(
      aRoute(context, { id: 'rt-2', truckId: 'b-7', runOn: '2025-02-12', status: 'closed' }),
    );
    return context;
  }

  it('returns them in day then truck order', () => {
    expect(
      seeded()
        .routes.list()
        .map((route) => route.id),
    ).toEqual(['rt-1', 'rt-2']);
  });

  it('filters by day, truck, driver and status', () => {
    const { routes } = seeded();
    expect(routes.list({ runOn: dayKey('2025-02-12') })).toHaveLength(1);
    expect(routes.list({ truckId: 'b-4' })).toHaveLength(1);
    expect(routes.list({ driverId: 'drv-3' })).toHaveLength(2);
    expect(routes.list({ status: 'closed' })).toHaveLength(1);
  });

  it('filters by a day range', () => {
    expect(
      seeded().routes.list({ from: dayKey('2025-02-12'), to: dayKey('2025-02-20') }),
    ).toHaveLength(1);
  });

  it('can leave out the finished ones', () => {
    expect(
      seeded()
        .routes.list({ openOnly: true })
        .map((r) => r.id),
    ).toEqual(['rt-1']);
  });
});

describe('status moves', () => {
  it('walks the route forward', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.setStatus('rt-1', 'released');
    context.routes.setStatus('rt-1', 'in_progress');
    context.routes.setStatus('rt-1', 'closed');
    expect(context.routes.get('rt-1').status).toBe('closed');
  });

  it('refuses to go backwards', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.setStatus('rt-1', 'released');
    expect(() => context.routes.setStatus('rt-1', 'planned')).toThrowError(
      /a released route cannot become planned/,
    );
  });

  it('is a no op when nothing changes', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    expect(() => context.routes.setStatus('rt-1', 'planned')).not.toThrow();
  });
});

describe('stops', () => {
  it('settles one with its ticket', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.settleStop('rt-1-s1', 'delivered', { note: 'left gate open' });
    const stop = context.routes.get('rt-1').stops.find((entry) => entry.id === 'rt-1-s1');
    expect(stop?.outcome).toBe('delivered');
    expect(stop?.note).toBe('left gate open');
  });

  it('refuses a stop that is not there', () => {
    expect(() => setup().routes.settleStop('s-9', 'delivered')).toThrowError(/no route stop/);
  });

  it('lists what is still outstanding on a day', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.settleStop('rt-1-s1', 'delivered');
    const outstanding = context.routes.outstandingStops(dayKey('2025-02-11'));
    expect(outstanding.map((stop) => stop.id)).toEqual(['rt-1-s2']);
  });

  it('ignores a cancelled route when listing outstanding stops', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.setStatus('rt-1', 'cancelled');
    expect(context.routes.outstandingStops(dayKey('2025-02-11'))).toEqual([]);
  });

  it('assigns and clears the driver', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    context.routes.assignDriver('rt-1', null);
    expect(context.routes.get('rt-1').driverId).toBeUndefined();
    context.routes.assignDriver('rt-1', 'drv-3');
    expect(context.routes.get('rt-1').driverId).toBe('drv-3');
    expect(() => context.routes.assignDriver('rt-9', null)).toThrowError(/no route/);
  });

  it('takes the stops with the route when it goes', () => {
    const context = setup();
    context.routes.save(aRoute(context));
    expect(context.routes.delete('rt-1')).toBe(true);
    expect(context.routes.outstandingStops(dayKey('2025-02-11'))).toEqual([]);
    expect(context.routes.delete('rt-1')).toBe(false);
  });
});
