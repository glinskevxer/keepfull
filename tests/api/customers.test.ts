import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';
import { aCustomer, aTank } from '../support/fixtures';
import { makeStation } from '../../src/model/station';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    clock: () => new Date('2025-12-04T09:00:00Z'),
  });
  context.weather.saveStation(
    makeStation({
      id: 'KITH',
      name: 'Ithaca',
      latitude: 42.49,
      longitude: -76.45,
      elevationFeet: 1099,
    }),
  );
  return { context, sink, app: testServer(context) };
}

const body = {
  accountNumber: '04-118372',
  billingName: 'Merrick Farms LLC',
  address: {
    line1: '4412 Bell Hollow Rd',
    town: 'Danby',
    county: 'Tompkins',
    postalCode: '14883',
    latitude: 42.3406,
    longitude: -76.4901,
  },
  deliveryMode: 'keep_full',
  rateClass: 'agricultural',
  stationId: 'KITH',
  openedOn: '2019-09-14',
};

describe('POST /customers', () => {
  it('creates one and gives it back', async () => {
    const { app } = setup();
    const response = await call<{ customer: { id: string; serviceName: string } }>(
      app,
      'POST',
      '/customers',
      body,
    );
    expect(response.status).toBe(201);
    expect(response.body.customer.serviceName).toBe('Merrick Farms LLC');
    expect(response.body.customer.id).toMatch(/^cus_/);
  });

  it('names the field that is wrong', async () => {
    const { app } = setup();
    const response = await call<{ problems: { field: string }[] }>(app, 'POST', '/customers', {
      ...body,
      accountNumber: 'nope',
    });
    expect(response.status).toBe(400);
    expect(response.body.problems[0]?.field).toBe('accountNumber');
  });

  it('refuses an account pointed at a station we do not have', async () => {
    const { app } = setup();
    const response = await call(app, 'POST', '/customers', { ...body, stationId: 'KBUF' });
    expect(response.status).toBe(404);
  });

  it('refuses a repeated account number', async () => {
    const { app } = setup();
    await call(app, 'POST', '/customers', body);
    const response = await call<{ code: string }>(app, 'POST', '/customers', body);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('conflict');
  });
});

describe('GET /customers', () => {
  function seeded() {
    const context = setup();
    context.context.customers.insert(
      aCustomer({ deliveryMode: 'keep_full', town: 'Danby' } as never),
    );
    context.context.customers.insert(aCustomer({ deliveryMode: 'will_call' }));
    context.context.customers.insert(aCustomer({ closedOn: '2024-01-01' }));
    return context;
  }

  it('lists them with a total', async () => {
    const { app } = seeded();
    const response = await call<{ customers: unknown[]; total: number }>(app, 'GET', '/customers');
    expect(response.body.customers).toHaveLength(3);
    expect(response.body.total).toBe(3);
  });

  it('filters', async () => {
    const { app } = seeded();
    const response = await call<{ customers: unknown[] }>(
      app,
      'GET',
      '/customers?deliveryMode=will_call',
    );
    expect(response.body.customers).toHaveLength(1);
  });

  it('leaves out the closed ones when asked', async () => {
    const { app } = seeded();
    const response = await call<{ customers: unknown[] }>(app, 'GET', '/customers?openOnly=true');
    expect(response.body.customers).toHaveLength(2);
  });

  it('pages', async () => {
    const { app } = seeded();
    const response = await call<{ customers: unknown[]; total: number }>(
      app,
      'GET',
      '/customers?limit=2&offset=1',
    );
    expect(response.body.customers).toHaveLength(2);
    expect(response.body.total).toBe(3);
  });

  it('refuses a page size past the cap', async () => {
    const { app } = seeded();
    expect((await call(app, 'GET', '/customers?limit=9000')).status).toBe(400);
  });
});

describe('GET /customers/:id', () => {
  it('brings the tanks along', async () => {
    const { context, app } = setup();
    const customer = aCustomer();
    context.customers.insert(customer);
    context.tanks.insert(aTank(customer.id));
    const response = await call<{ tanks: { inService: boolean }[] }>(
      app,
      'GET',
      `/customers/${customer.id}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.tanks).toHaveLength(1);
    expect(response.body.tanks[0]?.inService).toBe(true);
  });

  it('is a 404 for an account we do not have', async () => {
    const { app } = setup();
    const response = await call<{ code: string }>(app, 'GET', '/customers/c-nope');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('not_found');
  });
});

describe('PATCH and close', () => {
  it('changes one field and leaves the rest', async () => {
    const { context, app } = setup();
    const customer = aCustomer();
    context.customers.insert(customer);
    const response = await call<{ customer: { deliveryMode: string; billingName: string } }>(
      app,
      'PATCH',
      `/customers/${customer.id}`,
      { deliveryMode: 'will_call' },
    );
    expect(response.body.customer.deliveryMode).toBe('will_call');
    expect(response.body.customer.billingName).toBe(customer.billingName);
  });

  it('sets and clears a hold', async () => {
    const { context, app } = setup();
    const customer = aCustomer();
    context.customers.insert(customer);
    await call(app, 'PATCH', `/customers/${customer.id}`, { holdReason: 'past due 90' });
    expect(context.customers.get(customer.id).holdReason).toBe('past due 90');
    await call(app, 'PATCH', `/customers/${customer.id}`, { holdReason: null });
    expect(context.customers.get(customer.id).holdReason).toBeUndefined();
  });

  it('closes an account on a day', async () => {
    const { context, app } = setup();
    const customer = aCustomer();
    context.customers.insert(customer);
    const response = await call<{ customer: { closedOn: string } }>(
      app,
      'POST',
      `/customers/${customer.id}/close`,
      { on: '2025-12-31' },
    );
    expect(response.body.customer.closedOn).toBe('2025-12-31');
  });

  it('refuses a close before the account opened', async () => {
    const { context, app } = setup();
    const customer = aCustomer();
    context.customers.insert(customer);
    const response = await call(app, 'POST', `/customers/${customer.id}/close`, {
      on: '2001-01-01',
    });
    expect(response.status).toBe(409);
  });
});
