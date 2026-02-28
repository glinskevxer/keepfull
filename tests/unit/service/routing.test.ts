import { afterEach, describe, expect, it } from 'vitest';
import { DispatchService } from '../../../src/service/dispatch';
import { RoutingService } from '../../../src/service/routing';
import { buildScenario, seedCleanHistory } from '../../support/scenario';
import { aDelivery } from '../../support/fixtures';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';

afterEach(closeTestDatabases);

const yard = { latitude: 42.4432, longitude: -76.5019 };

function setup(driverOverrides: Record<string, unknown> = {}) {
  const scenario = buildScenario({ today: '2025-02-10' });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({
      id: 'drv-3',
      name: 'R Vandemark',
      licenceNumber: 'NY-882-441',
      endorsements: ['hazmat', 'tanker'],
      ...driverOverrides,
    }),
  );
  seedCleanHistory(scenario);
  const dispatch = new DispatchService(scenario.context, yard);
  return { scenario, dispatch, routing: new RoutingService(scenario.context) };
}

describe('commit', () => {
  it('turns a plan into a route for the next day', () => {
    const { dispatch, routing } = setup();
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }));
    expect(routes).toHaveLength(1);
    expect(routes[0]?.runOn).toBe('2025-02-11');
    expect(routes[0]?.stops).toHaveLength(1);
  });

  it('carries the planned gallons onto the stop', () => {
    const { dispatch, routing } = setup();
    const plan = dispatch.plan({ windowDays: 30 });
    const routes = routing.commit(plan);
    expect(routes[0]?.plannedGallons).toBe(plan.plan.routes[0]?.plannedGallons);
  });

  it('runs on a day the caller names', () => {
    const { dispatch, routing } = setup();
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }), {
      runOn: dayKey('2025-02-14'),
    });
    expect(routes[0]?.runOn).toBe('2025-02-14');
  });

  it('assigns a driver when one is given', () => {
    const { dispatch, routing } = setup();
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }), {
      drivers: { 'b-4': 'drv-3' },
    });
    expect(routes[0]?.driverId).toBe('drv-3');
  });

  it('refuses a driver who cannot haul', () => {
    const { dispatch, routing } = setup({ endorsements: ['tanker'] });
    expect(() =>
      routing.commit(dispatch.plan({ windowDays: 30 }), { drivers: { 'b-4': 'drv-3' } }),
    ).toThrowError(/cannot haul on 2025-02-11/);
  });

  it('writes nothing at all when a driver is refused', () => {
    const { scenario, dispatch, routing } = setup({ endorsements: ['tanker'] });
    expect(() =>
      routing.commit(dispatch.plan({ windowDays: 30 }), { drivers: { 'b-4': 'drv-3' } }),
    ).toThrowError();
    expect(scenario.context.routes.list()).toEqual([]);
  });

  it('skips a truck that got no stops', () => {
    const { dispatch, routing } = setup();
    expect(routing.commit(dispatch.plan({ windowDays: 1 }))).toEqual([]);
  });

  it('refuses a second route for the same truck and day', () => {
    const { dispatch, routing } = setup();
    const plan = dispatch.plan({ windowDays: 30 });
    routing.commit(plan);
    expect(() => routing.commit(plan)).toThrowError(/already has a route/);
  });

  it('replaces the earlier planned route when told to', () => {
    const { scenario, dispatch, routing } = setup();
    const plan = dispatch.plan({ windowDays: 30 });
    routing.commit(plan);
    routing.commit(plan, { replaceExisting: true });
    expect(scenario.context.routes.list()).toHaveLength(1);
  });

  it('says so in the log', () => {
    const { scenario, dispatch, routing } = setup();
    routing.commit(dispatch.plan({ windowDays: 30 }));
    expect(scenario.sink.messages()).toContain('committed the plan');
  });
});

describe('release', () => {
  it('moves a route to released with its driver', () => {
    const { dispatch, routing } = setup();
    const route = routing.commit(dispatch.plan({ windowDays: 30 }))[0];
    const released = routing.release(route?.id as string, 'drv-3');
    expect(released.status).toBe('released');
    expect(released.driverId).toBe('drv-3');
  });

  it('refuses a route with nobody to drive it', () => {
    const { dispatch, routing } = setup();
    const route = routing.commit(dispatch.plan({ windowDays: 30 }))[0];
    expect(() => routing.release(route?.id as string)).toThrowError(/needs a driver/);
  });

  it('refuses a driver whose card has lapsed', () => {
    const { dispatch, routing } = setup({ medicalCardExpiresOn: '2024-01-01' });
    const route = routing.commit(dispatch.plan({ windowDays: 30 }))[0];
    expect(() => routing.release(route?.id as string, 'drv-3')).toThrowError(/cannot haul/);
  });
});

describe('recording what happened', () => {
  function released() {
    const context = setup();
    const route = context.routing.commit(context.dispatch.plan({ windowDays: 30 }), {
      drivers: { 'b-4': 'drv-3' },
    })[0];
    context.routing.release(route?.id as string);
    return { ...context, routeId: route?.id as string };
  }

  it('ties a ticket to the stop and starts the route', () => {
    const { scenario, routing, routeId } = released();
    const ticket = aDelivery(scenario.customer.id, scenario.tank.id, {
      deliveredOn: '2025-02-11',
    });
    scenario.context.deliveries.insert(ticket);
    const stop = routing.recordDelivery(routeId, scenario.tank.id, ticket.id);
    expect(stop.outcome).toBe('delivered');
    expect(stop.deliveryId).toBe(ticket.id);
    expect(scenario.context.routes.get(routeId).status).toBe('in_progress');
  });

  it('refuses a tank that is not on the route', () => {
    const { routing, routeId } = released();
    expect(() => routing.recordDelivery(routeId, 't-nope', 'd-1')).toThrowError(
      /no stop for tank on this route/,
    );
  });

  it('refuses a ticket that is not posted', () => {
    const { scenario, routing, routeId } = released();
    expect(() => routing.recordDelivery(routeId, scenario.tank.id, 'd-nope')).toThrowError(
      /no delivery with id/,
    );
  });

  it('records a stop the driver could not make', () => {
    const { scenario, routing, routeId } = released();
    routing.missed(routeId, scenario.tank.id, 'no_access', 'dog out');
    const stop = scenario.context.routes.get(routeId).stops[0];
    expect(stop?.outcome).toBe('no_access');
    expect(stop?.note).toBe('dog out');
  });

  it('refuses to mark a tank missed that is not on the route', () => {
    const { routing, routeId } = released();
    expect(() => routing.missed(routeId, 't-nope', 'skipped')).toThrowError(/no stop for tank/);
  });
});

describe('closing out', () => {
  function released() {
    const context = setup();
    const route = context.routing.commit(context.dispatch.plan({ windowDays: 30 }), {
      drivers: { 'b-4': 'drv-3' },
    })[0];
    context.routing.release(route?.id as string);
    return { ...context, routeId: route?.id as string };
  }

  it('refuses while a stop is still open', () => {
    const { routing, routeId } = released();
    expect(() => routing.close(routeId)).toThrowError(/1 stops on .* are still open/);
  });

  it('closes once everything is settled', () => {
    const { scenario, routing, routeId } = released();
    routing.missed(routeId, scenario.tank.id, 'not_needed');
    expect(routing.close(routeId).status).toBe('closed');
  });

  it('cancels with a reason in the log', () => {
    const { scenario, routing, routeId } = released();
    expect(routing.cancel(routeId, 'truck broke down').status).toBe('cancelled');
    expect(scenario.sink.messages()).toContain('cancelled a route');
  });
});
