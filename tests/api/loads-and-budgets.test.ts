import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { dayKey } from '../../src/util/dates';
import { makeSchedule } from '../../src/core/pricing';
import { makeTruck } from '../../src/model/fleet';
import { parseMills } from '../../src/util/money';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({
    today: '2026-07-08',
    waterCapacity: 1000,
    weatherFrom: '2023-07-01',
    weatherTo: '2026-08-01',
  });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-1',
      rateClass: 'agricultural',
      effectiveFrom: dayKey('2023-01-01'),
      tiers: [{ fromGallons: 0, pricePerGallon: parseMills('2.9990') }],
    }),
  );
  return { scenario, app: testServer(scenario.context) };
}

describe('loads over http', () => {
  it('records a load and numbers it', async () => {
    const { app } = setup();
    const response = await call<{ load: { sequence: number; plantNet: number } }>(
      app,
      'POST',
      '/loads',
      { truckId: 'b-4', plantGross: 600, plantTemperature: 60, meterStart: 100_000 },
    );
    expect(response.status).toBe(201);
    expect(response.body.load.sequence).toBe(1);
    expect(response.body.load.plantNet).toBe(600);
  });

  it('refuses a truck we do not have', async () => {
    const { app } = setup();
    const response = await call(app, 'POST', '/loads', {
      truckId: 'b-nope',
      plantGross: 600,
      plantTemperature: 60,
      meterStart: 100_000,
    });
    expect(response.status).toBe(404);
  });

  it('closes a shift', async () => {
    const { app } = setup();
    const created = await call<{ load: { id: string } }>(app, 'POST', '/loads', {
      truckId: 'b-4',
      plantGross: 600,
      plantTemperature: 60,
      meterStart: 100_000,
    });
    const response = await call<{ load: { meterEnd: number } }>(
      app,
      'POST',
      `/loads/${created.body.load.id}/close`,
      { meterEnd: 100_598 },
    );
    expect(response.body.load.meterEnd).toBe(100_598);
  });

  it('refuses a meter that runs backwards', async () => {
    const { app } = setup();
    const created = await call<{ load: { id: string } }>(app, 'POST', '/loads', {
      truckId: 'b-4',
      plantGross: 600,
      plantTemperature: 60,
      meterStart: 100_000,
    });
    expect(
      (await call(app, 'POST', `/loads/${created.body.load.id}/close`, { meterEnd: 99_000 }))
        .status,
    ).toBe(409);
  });

  it('lists what is still open', async () => {
    const { app } = setup();
    await call(app, 'POST', '/loads', {
      truckId: 'b-4',
      plantGross: 600,
      plantTemperature: 60,
      meterStart: 100_000,
    });
    const response = await call<{ loads: unknown[] }>(app, 'GET', '/loads?openOnly=true');
    expect(response.body.loads).toHaveLength(1);
  });

  it('reconciles the day', async () => {
    const { scenario, app } = setup();
    const created = await call<{ load: { id: string } }>(app, 'POST', '/loads', {
      truckId: 'b-4',
      plantGross: 600,
      plantTemperature: 60,
      meterStart: 100_000,
    });
    await call(app, 'POST', `/loads/${created.body.load.id}/close`, { meterEnd: 100_598 });
    scenario.fill('2026-07-08', 596, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 10,
      gaugeAfter: 70,
    });
    const response = await call<{ shifts: { verdict: string }[]; outOfTolerance: number }>(
      app,
      'GET',
      '/reconciliation?day=2026-07-08',
    );
    expect(response.body.shifts[0]?.verdict).toBe('clean');
    expect(response.body.outOfTolerance).toBe(0);
  });

  it('reconciles one truck and reports its drift', async () => {
    const { app } = setup();
    await call(app, 'POST', '/loads', {
      truckId: 'b-4',
      plantGross: 600,
      plantTemperature: 60,
      meterStart: 100_000,
    });
    expect((await call(app, 'GET', '/reconciliation/b-4?day=2026-07-08')).status).toBe(200);
    const drift = await call<{ drift: { suspect: boolean } }>(
      app,
      'GET',
      '/reconciliation/b-4/drift',
    );
    expect(drift.body.drift.suspect).toBe(false);
  });
});

describe('budgets over http', () => {
  function withHistory(scenario: ReturnType<typeof setup>['scenario']) {
    for (const day of ['2024-11-01', '2025-01-15']) {
      scenario.fill(day, 300, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    }
    for (const day of ['2025-11-01', '2026-01-15']) {
      scenario.fill(day, 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    }
  }

  it('opens a plan', async () => {
    const { scenario, app } = setup();
    withHistory(scenario);
    const response = await call<{ plan: { season: number; instalments: unknown[] } }>(
      app,
      'POST',
      '/budgets',
      { customerId: scenario.customer.id },
    );
    expect(response.status).toBe(201);
    expect(response.body.plan.season).toBe(2026);
    expect(response.body.plan.instalments).toHaveLength(12);
  });

  it('refuses an account with nothing behind it', async () => {
    const { scenario, app } = setup();
    expect((await call(app, 'POST', '/budgets', { customerId: scenario.customer.id })).status).toBe(
      404,
    );
  });

  it('shows a plan with how it is tracking', async () => {
    const { scenario, app } = setup();
    withHistory(scenario);
    const created = await call<{ plan: { id: string } }>(app, 'POST', '/budgets', {
      customerId: scenario.customer.id,
    });
    const response = await call<{ health: { runningShort: boolean } }>(
      app,
      'GET',
      `/budgets/${created.body.plan.id}`,
    );
    expect(response.body.health.runningShort).toBe(false);
  });

  it('records a payment and refuses a second one', async () => {
    const { scenario, app } = setup();
    withHistory(scenario);
    const created = await call<{ plan: { id: string } }>(app, 'POST', '/budgets', {
      customerId: scenario.customer.id,
    });
    const id = created.body.plan.id;
    const paid = await call<{ plan: { instalments: { paidOn: string | null }[] } }>(
      app,
      'POST',
      `/budgets/${id}/payments`,
      { number: 1, amount: 25_000, on: '2026-07-09' },
    );
    expect(paid.body.plan.instalments[0]?.paidOn).toBe('2026-07-09');
    expect(
      (await call(app, 'POST', `/budgets/${id}/payments`, { number: 1, amount: 1 })).status,
    ).toBe(409);
  });

  it('settles and then refuses to cancel', async () => {
    const { scenario, app } = setup();
    withHistory(scenario);
    const created = await call<{ plan: { id: string } }>(app, 'POST', '/budgets', {
      customerId: scenario.customer.id,
    });
    const id = created.body.plan.id;
    const settled = await call<{ plan: { status: string } }>(app, 'POST', `/budgets/${id}/settle`, {
      on: '2027-06-30',
    });
    expect(settled.body.plan.status).toBe('settled');
    expect((await call(app, 'POST', `/budgets/${id}/cancel`, {})).status).toBe(409);
  });

  it('lists what is at risk and what is overdue', async () => {
    const { scenario, app } = setup();
    withHistory(scenario);
    await call(app, 'POST', '/budgets', { customerId: scenario.customer.id });
    expect((await call<{ count: number }>(app, 'GET', '/budgets/at-risk')).body.count).toBe(0);
    const overdue = await call<{ overdue: unknown[] }>(
      app,
      'GET',
      '/budgets/overdue?on=2026-09-15',
    );
    expect(overdue.body.overdue.length).toBeGreaterThan(0);
  });

  it('lists plans by customer', async () => {
    const { scenario, app } = setup();
    withHistory(scenario);
    await call(app, 'POST', '/budgets', { customerId: scenario.customer.id });
    const response = await call<{ plans: unknown[] }>(
      app,
      'GET',
      `/budgets?customerId=${scenario.customer.id}`,
    );
    expect(response.body.plans).toHaveLength(1);
  });
});

describe('audit over http', () => {
  it('reads the trail a voided ticket left', async () => {
    const { scenario, app } = setup();
    scenario.fill('2026-07-08', 300, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 50 });
    const delivery = scenario.context.deliveries.list()[0];
    await call(app, 'POST', `/deliveries/${delivery?.id}/void`, { note: 'wrong tank' });
    const response = await call<{ entries: { action: string; actor: string }[] }>(
      app,
      'GET',
      '/audit?subjectKind=delivery',
    );
    expect(response.body.entries[0]?.action).toBe('void');
    expect(response.body.entries[0]?.actor).toBe('tests');
  });

  it('reads one subject history', async () => {
    const { scenario, app } = setup();
    scenario.fill('2026-07-08', 300, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 50 });
    const delivery = scenario.context.deliveries.list()[0];
    await call(app, 'POST', `/deliveries/${delivery?.id}/void`, {});
    const response = await call<{ history: unknown[] }>(
      app,
      'GET',
      `/audit/delivery/${delivery?.id}`,
    );
    expect(response.body.history).toHaveLength(1);
  });

  it('is empty for something nothing has happened to', async () => {
    const { app } = setup();
    const response = await call<{ entries: unknown[] }>(app, 'GET', '/audit?actor=nobody');
    expect(response.body.entries).toEqual([]);
  });
});
