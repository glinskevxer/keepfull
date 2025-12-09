import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';
import { aCustomer, aTank } from '../support/fixtures';
import { makeSchedule } from '../../src/core/pricing';
import { dayKey } from '../../src/util/dates';
import { parseMills } from '../../src/util/money';
import { ticketNumber } from '../../src/util/ids';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

let serial = 700_000;

function setup() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    clock: () => new Date('2025-12-12T09:00:00Z'),
  });
  const customer = aCustomer({ rateClass: 'residential' });
  context.customers.insert(customer);
  const tank = aTank(customer.id);
  context.tanks.insert(tank);
  context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-1',
      rateClass: 'residential',
      effectiveFrom: dayKey('2025-09-01'),
      tiers: [
        { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
        { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
      ],
    }),
  );
  return { context, sink, customer, tank, app: testServer(context) };
}

function ticket(customerId: string, tankId: string, overrides: Record<string, unknown> = {}) {
  serial += 1;
  return {
    ticketNumber: ticketNumber(serial),
    customerId,
    tankId,
    deliveredOn: '2025-12-12',
    gross: 280,
    meterTemperature: 60,
    gaugeBefore: 22,
    gaugeAfter: 80,
    driverId: 'drv-3',
    truckId: 'b-4',
    ...overrides,
  };
}

describe('POST /deliveries', () => {
  it('posts a ticket and reports no flags', async () => {
    const { app, customer, tank } = setup();
    const response = await call<{ delivery: { net: number }; flags: string[] }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id),
    );
    expect(response.status).toBe(201);
    expect(response.body.delivery.net).toBe(280);
    expect(response.body.flags).toEqual([]);
  });

  it('writes a driver reading as a side effect', async () => {
    const { app, context, customer, tank } = setup();
    await call(app, 'POST', '/deliveries', ticket(customer.id, tank.id));
    expect(context.readings.latestFor(tank.id)?.gauge).toBe(80);
  });

  it('reports the flags it noticed', async () => {
    const { app, customer, tank } = setup();
    const response = await call<{ flags: string[] }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id, { gaugeBefore: 2, gross: 390 }),
    );
    expect(response.body.flags).toContain('was_out_of_gas');
  });

  it('refuses a drop that would overfill', async () => {
    const { app, customer, tank } = setup();
    const response = await call<{ code: string }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id, { gaugeBefore: 70, gross: 400 }),
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('tank_would_overfill');
  });

  it('names a bad field rather than failing deeper', async () => {
    const { app, customer, tank } = setup();
    const response = await call<{ problems: { field: string }[] }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id, { ticketNumber: '881' }),
    );
    expect(response.status).toBe(400);
    expect(response.body.problems[0]?.field).toBe('ticketNumber');
  });

  it('refuses the same ticket number twice', async () => {
    const { app, customer, tank } = setup();
    const first = ticket(customer.id, tank.id);
    await call(app, 'POST', '/deliveries', first);
    expect((await call(app, 'POST', '/deliveries', first)).status).toBe(409);
  });
});

describe('GET /deliveries', () => {
  it('lists and filters by tank and day', async () => {
    const { app, customer, tank } = setup();
    await call(app, 'POST', '/deliveries', ticket(customer.id, tank.id));
    await call(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id, { deliveredOn: '2025-11-01', gaugeBefore: 22 }),
    );
    expect(
      (await call<{ deliveries: unknown[] }>(app, 'GET', '/deliveries')).body.deliveries,
    ).toHaveLength(2);
    const filtered = await call<{ deliveries: unknown[] }>(
      app,
      'GET',
      '/deliveries?from=2025-12-01&to=2025-12-31',
    );
    expect(filtered.body.deliveries).toHaveLength(1);
  });

  it('fetches one by id', async () => {
    const { app, customer, tank } = setup();
    const posted = await call<{ delivery: { id: string } }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id),
    );
    const response = await call<{ delivery: { id: string } }>(
      app,
      'GET',
      `/deliveries/${posted.body.delivery.id}`,
    );
    expect(response.body.delivery.id).toBe(posted.body.delivery.id);
  });

  it('is a 404 for a ticket we do not have', async () => {
    expect((await call(setup().app, 'GET', '/deliveries/d-nope')).status).toBe(404);
  });

  it('adds up the totals for a day', async () => {
    const { app, customer, tank } = setup();
    await call(app, 'POST', '/deliveries', ticket(customer.id, tank.id));
    const response = await call<{ totals: { tickets: number; net: number } }>(
      app,
      'GET',
      '/deliveries/totals?from=2025-12-01&to=2025-12-31',
    );
    expect(response.body.totals).toEqual({ tickets: 1, gross: 280, net: 280 });
  });
});

describe('pricing and voiding', () => {
  it('prices a posted ticket', async () => {
    const { app, customer, tank } = setup();
    const posted = await call<{ delivery: { id: string } }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id),
    );
    const response = await call<{ price: { quote: { subtotal: number } } }>(
      app,
      'GET',
      `/deliveries/${posted.body.delivery.id}/price`,
    );
    expect(response.body.price.quote.subtotal).toBe(97972);
  });

  it('voids one with a note', async () => {
    const { app, customer, tank } = setup();
    const posted = await call<{ delivery: { id: string } }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id),
    );
    const response = await call<{ delivery: { status: string; notes: string } }>(
      app,
      'POST',
      `/deliveries/${posted.body.delivery.id}/void`,
      { note: 'wrong tank' },
    );
    expect(response.body.delivery.status).toBe('void');
    expect(response.body.delivery.notes).toBe('wrong tank');
  });

  it('refuses to void twice', async () => {
    const { app, customer, tank } = setup();
    const posted = await call<{ delivery: { id: string } }>(
      app,
      'POST',
      '/deliveries',
      ticket(customer.id, tank.id),
    );
    await call(app, 'POST', `/deliveries/${posted.body.delivery.id}/void`, {});
    expect(
      (await call(app, 'POST', `/deliveries/${posted.body.delivery.id}/void`, {})).status,
    ).toBe(409);
  });
});
