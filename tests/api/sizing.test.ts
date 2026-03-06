import { afterEach, describe, expect, it } from 'vitest';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { buildScenario } from '../support/scenario';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup(appliances: string[] = ['furnace', 'water_heater']) {
  const scenario = buildScenario({ today: '2026-01-10' });
  scenario.context.tanks.update({
    ...scenario.context.tanks.get(scenario.tank.id),
    appliances: appliances as never,
  });
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /tanks/:id/sizing', () => {
  it('judges a tank', async () => {
    const { scenario, app } = setup();
    const response = await call<{ sizing: { undersized: boolean } }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/sizing`,
    );
    expect(response.status).toBe(200);
    expect(response.body.sizing.undersized).toBe(false);
  });

  it('fails a grain dryer on a five hundred', async () => {
    const { scenario, app } = setup(['grain_dryer']);
    const response = await call<{ sizing: { undersized: boolean } }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/sizing`,
    );
    expect(response.body.sizing.undersized).toBe(true);
  });

  it('is a 404 for a tank we do not have', async () => {
    expect((await call(setup().app, 'GET', '/tanks/t-nope/sizing')).status).toBe(404);
  });
});

describe('GET /sizing/appliances', () => {
  it('recommends a tank from a list', async () => {
    const { app } = setup();
    const response = await call<{ recommendedCapacity: number }>(
      app,
      'GET',
      '/sizing/appliances?appliances=furnace,water_heater',
    );
    expect(response.body.recommendedCapacity).toBeGreaterThan(0);
  });

  it('recommends nothing for an empty list', async () => {
    const { app } = setup();
    const response = await call<{ recommendedCapacity: number | null }>(
      app,
      'GET',
      '/sizing/appliances',
    );
    expect(response.body.recommendedCapacity ?? null).toBeNull();
  });
});

describe('GET /sizing/undersized', () => {
  it('counts what cannot keep up', async () => {
    const { app } = setup(['grain_dryer']);
    const response = await call<{ count: number }>(app, 'GET', '/sizing/undersized');
    expect(response.body.count).toBe(1);
  });

  it('is empty on a well sized book', async () => {
    const { app } = setup(['furnace']);
    expect((await call<{ count: number }>(app, 'GET', '/sizing/undersized')).body.count).toBe(0);
  });
});
