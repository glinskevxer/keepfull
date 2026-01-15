import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink: new MemorySink(), level: 'debug' }),
    clock: () => new Date('2026-02-02T09:00:00Z'),
  });
  return { context, app: testServer(context) };
}

const truck = { unitNumber: 'B-4', waterCapacity: 3000, meterSealedOn: '2025-06-01' };
const driver = {
  name: 'R Vandemark',
  licenceNumber: 'NY-882-441',
  endorsements: ['hazmat', 'tanker'],
};

describe('trucks', () => {
  it('creates one and works out its working capacity', async () => {
    const { app } = setup();
    const response = await call<{ truck: { workingCapacity: number; id: string } }>(
      app,
      'POST',
      '/trucks',
      truck,
    );
    expect(response.status).toBe(201);
    expect(response.body.truck.workingCapacity).toBe(2350);
    expect(response.body.truck.id).toMatch(/^trk_/);
  });

  it('says whether the truck may write tickets today', async () => {
    const { app } = setup();
    const good = await call<{ truck: { canWriteTickets: boolean } }>(app, 'POST', '/trucks', truck);
    expect(good.body.truck.canWriteTickets).toBe(true);
    const stale = await call<{ truck: { canWriteTickets: boolean } }>(app, 'POST', '/trucks', {
      ...truck,
      unitNumber: 'B-7',
      meterSealedOn: '2024-06-01',
    });
    expect(stale.body.truck.canWriteTickets).toBe(false);
  });

  it('says no when there is no seal on file at all', async () => {
    const { app } = setup();
    const response = await call<{ truck: { canWriteTickets: boolean; meterSealExpiresOn: null } }>(
      app,
      'POST',
      '/trucks',
      { unitNumber: 'B-9', waterCapacity: 2600 },
    );
    expect(response.body.truck.canWriteTickets).toBe(false);
    expect(response.body.truck.meterSealExpiresOn).toBeNull();
  });

  it('refuses a repeated unit number', async () => {
    const { app } = setup();
    await call(app, 'POST', '/trucks', truck);
    expect((await call(app, 'POST', '/trucks', truck)).status).toBe(409);
  });

  it('refuses a kind it does not know', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/trucks', { ...truck, kind: 'flatbed' })).status).toBe(400);
  });

  it('lists and filters', async () => {
    const { app } = setup();
    await call(app, 'POST', '/trucks', truck);
    await call(app, 'POST', '/trucks', {
      unitNumber: 'T-1',
      kind: 'transport',
      waterCapacity: 11500,
    });
    expect((await call<{ trucks: unknown[] }>(app, 'GET', '/trucks')).body.trucks).toHaveLength(2);
    expect(
      (await call<{ trucks: unknown[] }>(app, 'GET', '/trucks?kind=transport')).body.trucks,
    ).toHaveLength(1);
  });

  it('records a new seal and retires a truck', async () => {
    const { app } = setup();
    const created = await call<{ truck: { id: string } }>(app, 'POST', '/trucks', truck);
    const id = created.body.truck.id;
    const sealed = await call<{ truck: { meterSealedOn: string } }>(
      app,
      'POST',
      `/trucks/${id}/meter-seal`,
      { on: '2026-02-01' },
    );
    expect(sealed.body.truck.meterSealedOn).toBe('2026-02-01');
    const retired = await call<{ truck: { active: boolean } }>(
      app,
      'POST',
      `/trucks/${id}/retire`,
      {},
    );
    expect(retired.body.truck.active).toBe(false);
  });

  it('is a 404 for one we do not have', async () => {
    expect((await call(setup().app, 'GET', '/trucks/trk-nope')).status).toBe(404);
  });
});

describe('drivers', () => {
  it('creates one and says whether they can haul', async () => {
    const { app } = setup();
    const response = await call<{ driver: { canHaul: boolean } }>(app, 'POST', '/drivers', driver);
    expect(response.status).toBe(201);
    expect(response.body.driver.canHaul).toBe(true);
  });

  it('says no when an endorsement is missing', async () => {
    const { app } = setup();
    const response = await call<{ driver: { canHaul: boolean } }>(app, 'POST', '/drivers', {
      ...driver,
      endorsements: ['tanker'],
    });
    expect(response.body.driver.canHaul).toBe(false);
  });

  it('says no when the medical card has lapsed', async () => {
    const { app } = setup();
    const response = await call<{ driver: { canHaul: boolean } }>(app, 'POST', '/drivers', {
      ...driver,
      medicalCardExpiresOn: '2026-01-01',
    });
    expect(response.body.driver.canHaul).toBe(false);
  });

  it('refuses a repeated licence number', async () => {
    const { app } = setup();
    await call(app, 'POST', '/drivers', driver);
    expect((await call(app, 'POST', '/drivers', driver)).status).toBe(409);
  });

  it('lists in name order and retires one', async () => {
    const { app } = setup();
    await call(app, 'POST', '/drivers', driver);
    const created = await call<{ driver: { id: string } }>(app, 'POST', '/drivers', {
      name: 'A Olney',
      licenceNumber: 'NY-114-902',
    });
    const listed = await call<{ drivers: { name: string }[] }>(app, 'GET', '/drivers');
    expect(listed.body.drivers.map((d) => d.name)).toEqual(['A Olney', 'R Vandemark']);
    await call(app, 'POST', `/drivers/${created.body.driver.id}/retire`, {});
    expect(
      (await call<{ drivers: unknown[] }>(app, 'GET', '/drivers?activeOnly=true')).body.drivers,
    ).toHaveLength(1);
  });

  it('is a 404 for one we do not have', async () => {
    expect((await call(setup().app, 'GET', '/drivers/drv-nope')).status).toBe(404);
  });
});
