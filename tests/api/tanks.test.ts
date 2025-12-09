import { afterEach, describe, expect, it } from 'vitest';
import { aCustomer, aReading, aTank } from '../support/fixtures';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    clock: () => new Date('2025-12-08T09:00:00Z'),
  });
  const customer = aCustomer();
  context.customers.insert(customer);
  return { context, sink, customer, app: testServer(context) };
}

const body = {
  customerId: '',
  serialNumber: 'TR-991002',
  waterCapacity: 500,
  owner: 'company',
  appliances: ['furnace', 'water_heater'],
  installedOn: '2020-04-02',
};

describe('POST /tanks', () => {
  it('creates one', async () => {
    const { app, customer } = setup();
    const response = await call<{ tank: { id: string; fillLimit: number } }>(
      app,
      'POST',
      '/tanks',
      {
        ...body,
        customerId: customer.id,
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.tank.fillLimit).toBe(80);
  });

  it('refuses a size that is not on the yard', async () => {
    const { app, customer } = setup();
    const response = await call<{ problems: { message: string }[] }>(app, 'POST', '/tanks', {
      ...body,
      customerId: customer.id,
      waterCapacity: 400,
    });
    expect(response.status).toBe(400);
    expect(response.body.problems[0]?.message).toBe('not a tank size on the yard');
  });

  it('refuses a tank against an account we do not have', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/tanks', { ...body, customerId: 'c-nope' })).status).toBe(404);
  });

  it('refuses a repeated serial number', async () => {
    const { app, customer } = setup();
    await call(app, 'POST', '/tanks', { ...body, customerId: customer.id });
    const second = await call(app, 'POST', '/tanks', { ...body, customerId: customer.id });
    expect(second.status).toBe(409);
  });
});

describe('GET /tanks', () => {
  it('lists and filters', async () => {
    const { app, context, customer } = setup();
    context.tanks.insert(aTank(customer.id));
    context.tanks.insert(aTank(customer.id, { removedOn: '2024-01-01' }));
    expect((await call<{ tanks: unknown[] }>(app, 'GET', '/tanks')).body.tanks).toHaveLength(2);
    expect(
      (await call<{ tanks: unknown[] }>(app, 'GET', '/tanks?inServiceOnly=true')).body.tanks,
    ).toHaveLength(1);
    expect(
      (await call<{ tanks: unknown[] }>(app, 'GET', `/tanks?customerId=${customer.id}`)).body.tanks,
    ).toHaveLength(2);
  });
});

describe('GET /tanks/:id', () => {
  it('brings the last reading and what would fit', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    context.readings.record(aReading(tank.id, { takenOn: '2025-12-01', gauge: 30 }));
    const response = await call<{ lastReading: { gallons: number; roomToFill: number } }>(
      app,
      'GET',
      `/tanks/${tank.id}`,
    );
    expect(response.body.lastReading.gallons).toBe(150);
    expect(response.body.lastReading.roomToFill).toBe(250);
  });

  it('says so when there is no reading', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    const response = await call<{ lastReading: unknown; lastDelivery: unknown }>(
      app,
      'GET',
      `/tanks/${tank.id}`,
    );
    expect(response.body.lastReading).toBeNull();
    expect(response.body.lastDelivery).toBeNull();
  });

  it('is a 404 for a tank we do not have', async () => {
    expect((await call(setup().app, 'GET', '/tanks/t-nope')).status).toBe(404);
  });
});

describe('readings', () => {
  it('takes one from the monitor vendor', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    const response = await call<{ reading: { source: string } }>(app, 'POST', '/readings', {
      tankId: tank.id,
      takenOn: '2025-12-07',
      gauge: 41.5,
      source: 'monitor',
      monitorId: 'WT-4471',
    });
    expect(response.status).toBe(201);
    expect(response.body.reading.source).toBe('monitor');
  });

  it('refuses a monitor reading with no monitor named', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    const response = await call(app, 'POST', '/readings', {
      tankId: tank.id,
      takenOn: '2025-12-07',
      gauge: 41.5,
      source: 'monitor',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a gauge off the dial', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    const response = await call(app, 'POST', '/readings', {
      tankId: tank.id,
      takenOn: '2025-12-07',
      gauge: 140,
      source: 'driver',
    });
    expect(response.status).toBe(400);
  });

  it('lists a tank history newest first', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    context.readings.record(aReading(tank.id, { takenOn: '2025-12-01', gauge: 40 }));
    context.readings.record(aReading(tank.id, { takenOn: '2025-12-05', gauge: 30 }));
    const response = await call<{ readings: { takenOn: string }[] }>(
      app,
      'GET',
      `/tanks/${tank.id}/readings`,
    );
    expect(response.body.readings[0]?.takenOn).toBe('2025-12-05');
  });
});

describe('tank life', () => {
  it('records a leak check with today by default', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    const response = await call<{ tank: { lastLeakCheckOn: string } }>(
      app,
      'POST',
      `/tanks/${tank.id}/leak-check`,
      {},
    );
    expect(response.body.tank.lastLeakCheckOn).toBe('2025-12-08');
  });

  it('pulls a tank and frees its monitor', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id, { monitorId: 'WT-1' });
    context.tanks.insert(tank);
    const response = await call<{ tank: { removedOn: string; monitorId: string | null } }>(
      app,
      'POST',
      `/tanks/${tank.id}/remove`,
      { on: '2025-12-08' },
    );
    expect(response.body.tank.removedOn).toBe('2025-12-08');
    expect(response.body.tank.monitorId).toBeNull();
  });

  it('refuses to pull a tank before it went in', async () => {
    const { app, context, customer } = setup();
    const tank = aTank(customer.id);
    context.tanks.insert(tank);
    expect((await call(app, 'POST', `/tanks/${tank.id}/remove`, { on: '2001-01-01' })).status).toBe(
      409,
    );
  });
});
