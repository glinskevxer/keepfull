import { afterEach, describe, expect, it } from 'vitest';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { buildScenario } from '../support/scenario';
import { dayKey } from '../../src/util/dates';
import { makeSchedule } from '../../src/core/pricing';
import { makeTruck } from '../../src/model/fleet';
import { parseMills } from '../../src/util/money';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2026-05-01' });
  scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2021-06-01'));
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000, meterSealedOn: '2025-06-01' }),
  );
  scenario.context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-1',
      rateClass: 'agricultural',
      effectiveFrom: dayKey('2025-09-01'),
      tiers: [
        { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
        { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
      ],
    }),
  );
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /compliance', () => {
  it('lists what is coming due', async () => {
    const { app } = setup();
    const response = await call<{ items: { kind: string }[]; watch: number }>(
      app,
      'GET',
      '/compliance',
    );
    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.kind).sort()).toEqual([
      'leak_check_due',
      'meter_seal_due',
    ]);
  });

  it('counts the blocking ones once they are past', async () => {
    const { app } = setup();
    const response = await call<{ blocking: number }>(app, 'GET', '/compliance?asOf=2026-07-01');
    expect(response.body.blocking).toBe(2);
  });

  it('takes a narrower notice window', async () => {
    const { app } = setup();
    const response = await call<{ items: unknown[] }>(app, 'GET', '/compliance?noticeDays=5');
    expect(response.body.items).toEqual([]);
  });
});

describe('GET /tanks/:id/can-fill', () => {
  it('says yes when the tank is current', async () => {
    const { scenario, app } = setup();
    scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2026-01-01'));
    const response = await call<{ allowed: boolean }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/can-fill`,
    );
    expect(response.body.allowed).toBe(true);
  });

  it('says no and why when it is not', async () => {
    const { scenario, app } = setup();
    const response = await call<{ allowed: boolean; reasons: string[] }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/can-fill?on=2026-07-01`,
    );
    expect(response.body.allowed).toBe(false);
    expect(response.body.reasons[0]).toMatch(/leak check/);
  });

  it('is a 404 for a tank we do not have', async () => {
    expect((await call(setup().app, 'GET', '/tanks/t-nope/can-fill')).status).toBe(404);
  });
});

describe('interruptions and grounded trucks', () => {
  it('finds a tank that ran out and says it is outstanding', async () => {
    const { scenario, app } = setup();
    scenario.fill('2026-01-14', 380, { gaugeBefore: 3 });
    const response = await call<{ outstanding: number; interruptions: unknown[] }>(
      app,
      'GET',
      '/compliance/interruptions?from=2026-01-01&to=2026-02-01',
    );
    expect(response.body.interruptions).toHaveLength(1);
    expect(response.body.outstanding).toBe(1);
  });

  it('has nothing to report on a clean year', async () => {
    const { app } = setup();
    const response = await call<{ interruptions: unknown[] }>(
      app,
      'GET',
      '/compliance/interruptions',
    );
    expect(response.body.interruptions).toEqual([]);
  });

  it('grounds nothing while the seals hold', async () => {
    const { app } = setup();
    expect(
      (await call<{ grounded: unknown[] }>(app, 'GET', '/compliance/grounded')).body.grounded,
    ).toEqual([]);
  });
});

describe('prices', () => {
  it('quotes a fill', async () => {
    const { scenario, app } = setup();
    const response = await call<{ quote: { quote: { subtotal: number } } }>(
      app,
      'GET',
      `/prices/quote?customerId=${scenario.customer.id}&gallons=400`,
    );
    expect(response.body.quote.quote.subtotal).toBe(119960);
  });

  it('refuses a quote with no gallons named', async () => {
    const { scenario, app } = setup();
    expect(
      (await call(app, 'GET', `/prices/quote?customerId=${scenario.customer.id}`)).status,
    ).toBe(400);
  });

  it('lists the schedules', async () => {
    const { app } = setup();
    const response = await call<{ schedules: unknown[] }>(app, 'GET', '/prices/schedules');
    expect(response.body.schedules).toHaveLength(1);
  });

  it('creates a new one', async () => {
    const { app } = setup();
    const response = await call<{ schedule: { id: string } }>(app, 'POST', '/prices/schedules', {
      rateClass: 'residential',
      effectiveFrom: '2026-01-01',
      tiers: [{ fromGallons: 0, pricePerGallon: 32490 }],
    });
    expect(response.status).toBe(201);
    expect(response.body.schedule.id).toMatch(/^prc_/);
  });

  it('refuses one that does not start at zero gallons', async () => {
    const { app } = setup();
    const response = await call(app, 'POST', '/prices/schedules', {
      rateClass: 'residential',
      effectiveFrom: '2026-01-01',
      tiers: [{ fromGallons: 150, pricePerGallon: 32490 }],
    });
    expect(response.status).toBe(400);
  });

  it('reports the gallons still committed', async () => {
    const { app } = setup();
    expect((await call<{ gallons: number }>(app, 'GET', '/prices/committed')).body.gallons).toBe(0);
  });
});
