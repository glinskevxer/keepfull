import { afterEach, describe, expect, it } from 'vitest';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { Scenario, buildScenario } from '../support/scenario';
import { dayKey, daysBetween } from '../../src/util/dates';
import { makeDriver, makeTruck } from '../../src/model/fleet';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function history(scenario: Scenario, tankId: string) {
  const days = ['2024-08-01', '2024-09-01', '2024-10-01', '2024-11-01', '2024-12-01', '2025-01-01'];
  scenario.fillTank(tankId, days[0] as string, 180);
  for (let index = 1; index < days.length; index += 1) {
    const span = daysBetween(dayKey(days[index - 1] as string), dayKey(days[index] as string));
    scenario.fillTank(tankId, days[index] as string, 6 * span);
  }
}

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
  history(scenario, scenario.tank.id);
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /dispatch/plan', () => {
  it('shows tomorrow with its stops', async () => {
    const { app } = setup();
    const response = await call<{
      day: string;
      routes: { truckId: string; stops: { tankId: string; urgency: number }[] }[];
    }>(app, 'GET', '/dispatch/plan?windowDays=30');
    expect(response.status).toBe(200);
    expect(response.body.day).toBe('2025-02-10');
    expect(response.body.routes[0]?.stops).toHaveLength(1);
  });

  it('says why a tank was left off', async () => {
    const { scenario, app } = setup();
    scenario.addTank();
    const response = await call<{ skipped: { reason: string }[] }>(
      app,
      'GET',
      '/dispatch/plan?windowDays=30',
    );
    expect(response.body.skipped.map((s) => s.reason)).toContain('no_forecast');
  });

  it('reports what would not fit on a truck', async () => {
    const { scenario, app } = setup();
    scenario.context.fleet.retireTruck('b-4');
    const response = await call<{ deferred: { reason: string }[] }>(
      app,
      'GET',
      '/dispatch/plan?windowDays=30',
    );
    expect(response.body.deferred[0]?.reason).toBe('no_trucks');
  });

  it('refuses a window that is not a number', async () => {
    const { app } = setup();
    expect((await call(app, 'GET', '/dispatch/plan?windowDays=lots')).status).toBe(400);
  });

  it('plans nothing when nothing is due', async () => {
    const { app } = setup();
    const response = await call<{ routes: { stops: unknown[] }[] }>(
      app,
      'GET',
      '/dispatch/plan?windowDays=1',
    );
    expect(response.body.routes[0]?.stops).toEqual([]);
  });
});

describe('POST /dispatch/commit', () => {
  it('creates a route for the next day', async () => {
    const { app } = setup();
    const response = await call<{ routes: { runOn: string; status: string }[] }>(
      app,
      'POST',
      '/dispatch/commit?windowDays=30',
      {},
    );
    expect(response.status).toBe(201);
    expect(response.body.routes[0]?.runOn).toBe('2025-02-11');
    expect(response.body.routes[0]?.status).toBe('planned');
  });

  it('assigns a driver when the body names one', async () => {
    const { app } = setup();
    const response = await call<{ routes: { driverId: string }[] }>(
      app,
      'POST',
      '/dispatch/commit?windowDays=30',
      { drivers: { 'b-4': 'drv-3' } },
    );
    expect(response.body.routes[0]?.driverId).toBe('drv-3');
  });

  it('refuses a driver who cannot haul', async () => {
    const { app } = setup({ endorsements: ['tanker'] });
    const response = await call<{ code: string }>(app, 'POST', '/dispatch/commit?windowDays=30', {
      drivers: { 'b-4': 'drv-3' },
    });
    expect(response.status).toBe(409);
  });

  it('refuses a second commit for the same truck and day', async () => {
    const { app } = setup();
    await call(app, 'POST', '/dispatch/commit?windowDays=30', {});
    expect((await call(app, 'POST', '/dispatch/commit?windowDays=30', {})).status).toBe(409);
  });
});

describe('routes', () => {
  async function committed() {
    const context = setup();
    const response = await call<{ routes: { id: string }[] }>(
      context.app,
      'POST',
      '/dispatch/commit?windowDays=30',
      { drivers: { 'b-4': 'drv-3' } },
    );
    return { ...context, routeId: response.body.routes[0]?.id as string };
  }

  it('lists them for a day', async () => {
    const { app } = await committed();
    const response = await call<{ routes: unknown[] }>(app, 'GET', '/routes?runOn=2025-02-11');
    expect(response.body.routes).toHaveLength(1);
  });

  it('fetches one', async () => {
    const { app, routeId } = await committed();
    expect((await call(app, 'GET', `/routes/${routeId}`)).status).toBe(200);
  });

  it('is a 404 for one we do not have', async () => {
    const { app } = await committed();
    expect((await call(app, 'GET', '/routes/rt-nope')).status).toBe(404);
  });

  it('releases it to the driver', async () => {
    const { app, routeId } = await committed();
    const response = await call<{ route: { status: string } }>(
      app,
      'POST',
      `/routes/${routeId}/release`,
      {},
    );
    expect(response.body.route.status).toBe('released');
  });

  it('takes a stop the driver could not make', async () => {
    const { scenario, app, routeId } = await committed();
    await call(app, 'POST', `/routes/${routeId}/release`, {});
    const response = await call<{ route: { stops: { outcome: string; note: string }[] } }>(
      app,
      'POST',
      `/routes/${routeId}/stops`,
      { tankId: scenario.tank.id, outcome: 'no_access', note: 'dog out' },
    );
    expect(response.body.route.stops[0]?.outcome).toBe('no_access');
    expect(response.body.route.stops[0]?.note).toBe('dog out');
  });

  it('insists a delivered stop names its ticket', async () => {
    const { scenario, app, routeId } = await committed();
    const response = await call<{ code: string }>(app, 'POST', `/routes/${routeId}/stops`, {
      tankId: scenario.tank.id,
      outcome: 'delivered',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_input');
  });

  it('refuses to close while a stop is open', async () => {
    const { app, routeId } = await committed();
    await call(app, 'POST', `/routes/${routeId}/release`, {});
    expect((await call(app, 'POST', `/routes/${routeId}/close`, {})).status).toBe(409);
  });

  it('closes once everything is settled', async () => {
    const { scenario, app, routeId } = await committed();
    await call(app, 'POST', `/routes/${routeId}/release`, {});
    await call(app, 'POST', `/routes/${routeId}/stops`, {
      tankId: scenario.tank.id,
      outcome: 'not_needed',
    });
    const response = await call<{ route: { status: string } }>(
      app,
      'POST',
      `/routes/${routeId}/close`,
      {},
    );
    expect(response.body.route.status).toBe('closed');
  });

  it('cancels with a reason', async () => {
    const { app, routeId } = await committed();
    const response = await call<{ route: { status: string } }>(
      app,
      'POST',
      `/routes/${routeId}/cancel`,
      { reason: 'truck broke down' },
    );
    expect(response.body.route.status).toBe('cancelled');
  });
});
