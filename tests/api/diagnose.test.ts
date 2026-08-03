import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { dayKey } from '../../src/util/dates';
import { makeDriver, makeTruck } from '../../src/model/fleet';
import { makeSchedule } from '../../src/core/pricing';
import { parseMills } from '../../src/util/money';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function healthy() {
  const scenario = buildScenario({ today: '2026-08-01', weatherTo: '2026-08-01' });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({ id: 'drv-1', name: 'R Vandemark', licenceNumber: 'NY-1' }),
  );
  scenario.context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-1',
      rateClass: 'agricultural',
      effectiveFrom: dayKey('2026-01-01'),
      tiers: [{ fromGallons: 0, pricePerGallon: parseMills('2.9990') }],
    }),
  );
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /diagnose', () => {
  it('needs no key, like the other operational endpoints', async () => {
    const { app } = healthy();
    const response = await app.inject({ method: 'GET', url: '/diagnose' });
    expect(response.statusCode).toBe(200);
  });

  it('is a two hundred and empty when nothing is wrong', async () => {
    const { app } = healthy();
    const response = await call<{ healthy: boolean; findings: unknown[] }>(app, 'GET', '/diagnose');
    expect(response.body.healthy).toBe(true);
    expect(response.body.findings).toEqual([]);
  });

  it('is a five oh three when something blocks', async () => {
    const scenario = buildScenario({ today: '2026-08-01', weatherTo: '2026-07-01' });
    const app = testServer(scenario.context);
    const response = await call<{ healthy: boolean; blocking: number }>(app, 'GET', '/diagnose');
    expect(response.status).toBe(503);
    expect(response.body.healthy).toBe(false);
    expect(response.body.blocking).toBeGreaterThan(0);
  });

  it('stays a two hundred for a warning', async () => {
    const { scenario, app } = healthy();
    scenario.context.customers.update({ ...scenario.customer, rateClass: 'commercial' });
    const response = await call<{ warnings: number }>(app, 'GET', '/diagnose');
    expect(response.status).toBe(200);
    expect(response.body.warnings).toBeGreaterThan(0);
  });

  it('is listed as an open path', async () => {
    const { app } = healthy();
    const response = await call<{ open: string[] }>(app, 'GET', '/');
    expect(response.body.open).toContain('/diagnose');
  });
});

describe('GET /customers/search', () => {
  it('finds an account by part of a name', async () => {
    const { app } = healthy();
    const response = await call<{ hits: { matchedOn: string }[] }>(
      app,
      'GET',
      '/customers/search?q=Merrick',
    );
    expect(response.status).toBe(200);
    expect(response.body.hits).toHaveLength(1);
    expect(response.body.hits[0]?.matchedOn).toBe('name');
  });

  it('finds nothing for a term nobody matches', async () => {
    const { app } = healthy();
    const response = await call<{ hits: unknown[] }>(app, 'GET', '/customers/search?q=zzzz');
    expect(response.body.hits).toEqual([]);
  });

  it('finds nothing when no term is given at all', async () => {
    const { app } = healthy();
    const response = await call<{ hits: unknown[]; term: string }>(app, 'GET', '/customers/search');
    expect(response.body.hits).toEqual([]);
    expect(response.body.term).toBe('');
  });

  it('does not swallow the by id route', async () => {
    const { scenario, app } = healthy();
    const response = await call<{ customer: { id: string } }>(
      app,
      'GET',
      `/customers/${scenario.customer.id}`,
    );
    expect(response.body.customer.id).toBe(scenario.customer.id);
  });
});
