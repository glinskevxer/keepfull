import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { makeDriver, makeTruck } from '../../src/model/fleet';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2026-01-14', waterCapacity: 1000 });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({ id: 'drv-3', name: 'R Vandemark', licenceNumber: 'NY-1' }),
  );
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /reports/driver-day', () => {
  it('is empty on a quiet day', async () => {
    const { app } = setup();
    const response = await call<{ drivers: unknown[] }>(app, 'GET', '/reports/driver-day');
    expect(response.status).toBe(200);
    expect(response.body.drivers).toEqual([]);
  });

  it('covers everybody who did anything', async () => {
    const { scenario, app } = setup();
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    const response = await call<{ drivers: { driverId: string; netGallons: number }[] }>(
      app,
      'GET',
      '/reports/driver-day',
    );
    expect(response.body.drivers[0]).toMatchObject({ driverId: 'drv-3', netGallons: 300 });
  });

  it('narrows to one driver', async () => {
    const { app } = setup();
    const response = await call<{ drivers: unknown[] }>(
      app,
      'GET',
      '/reports/driver-day?driverId=drv-3',
    );
    expect(response.body.drivers).toHaveLength(1);
  });

  it('is a 404 for a driver we do not have', async () => {
    const { app } = setup();
    expect((await call(app, 'GET', '/reports/driver-day?driverId=drv-nope')).status).toBe(404);
  });
});
