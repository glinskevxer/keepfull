import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

const station = {
  id: 'KITH',
  name: 'Ithaca Tompkins Regional',
  latitude: 42.4908,
  longitude: -76.4584,
  elevationFeet: 1099,
};

function setup() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    clock: () => new Date('2026-01-15T06:00:00Z'),
  });
  return { context, sink, app: testServer(context) };
}

describe('stations', () => {
  it('creates one', async () => {
    const { app } = setup();
    const response = await call<{ station: { baseTemperature: number } }>(
      app,
      'POST',
      '/stations',
      station,
    );
    expect(response.status).toBe(201);
    expect(response.body.station.baseTemperature).toBe(65);
  });

  it('refuses an identifier that is not one', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/stations', { ...station, id: 'ith' })).status).toBe(400);
  });

  it('lists them with how much weather each has', async () => {
    const { app } = setup();
    await call(app, 'POST', '/stations', station);
    const response = await call<{
      stations: { observations: number; latestObservation: string | null }[];
    }>(app, 'GET', '/stations');
    expect(response.body.stations[0]?.observations).toBe(0);
    expect(response.body.stations[0]?.latestObservation).toBeNull();
  });

  it('can leave out the retired ones', async () => {
    const { app } = setup();
    await call(app, 'POST', '/stations', station);
    await call(app, 'POST', '/stations', { ...station, id: 'KELM', active: false });
    const response = await call<{ stations: unknown[] }>(app, 'GET', '/stations?activeOnly=true');
    expect(response.body.stations).toHaveLength(1);
  });
});

describe('observations', () => {
  async function withStation() {
    const context = setup();
    await call(context.app, 'POST', '/stations', station);
    return context;
  }

  it('takes a batch', async () => {
    const { app } = await withStation();
    const response = await call<{ written: number; latestObservation: string }>(
      app,
      'POST',
      '/observations',
      {
        stationId: 'KITH',
        observations: [
          { day: '2026-01-13', high: 30, low: 12 },
          { day: '2026-01-14', high: 28, low: 9 },
        ],
      },
    );
    expect(response.body.written).toBe(2);
    expect(response.body.latestObservation).toBe('2026-01-14');
  });

  it('is idempotent, so the pull can re-send the week', async () => {
    const { app } = await withStation();
    const batch = {
      stationId: 'KITH',
      observations: [{ day: '2026-01-13', high: 30, low: 12 }],
    };
    await call(app, 'POST', '/observations', batch);
    await call(app, 'POST', '/observations', batch);
    const response = await call<{ stations: { observations: number }[] }>(app, 'GET', '/stations');
    expect(response.body.stations[0]?.observations).toBe(1);
  });

  it('drops a day whose low is above its high rather than failing the batch', async () => {
    const { app } = await withStation();
    const response = await call<{ written: number; rejected: number }>(
      app,
      'POST',
      '/observations',
      {
        stationId: 'KITH',
        observations: [
          { day: '2026-01-13', high: 30, low: 12 },
          { day: '2026-01-14', high: 9, low: 28 },
        ],
      },
    );
    expect(response.body.written).toBe(1);
    expect(response.body.rejected).toBe(1);
  });

  it('refuses a batch for a station we do not have', async () => {
    const { app } = setup();
    const response = await call(app, 'POST', '/observations', {
      stationId: 'KBUF',
      observations: [{ day: '2026-01-13', high: 30, low: 12 }],
    });
    expect(response.status).toBe(404);
  });

  it('refuses an empty batch', async () => {
    const { app } = await withStation();
    expect(
      (await call(app, 'POST', '/observations', { stationId: 'KITH', observations: [] })).status,
    ).toBe(400);
  });

  it('says so in the log', async () => {
    const { app, sink } = await withStation();
    await call(app, 'POST', '/observations', {
      stationId: 'KITH',
      observations: [{ day: '2026-01-13', high: 30, low: 12 }],
    });
    expect(sink.messages()).toContain('took a weather batch');
  });
});

describe('degree days', () => {
  it('adds them up over a range and names the gaps', async () => {
    const { app } = setup();
    await call(app, 'POST', '/stations', station);
    await call(app, 'POST', '/observations', {
      stationId: 'KITH',
      observations: [
        { day: '2026-01-13', high: 55, low: 35 },
        { day: '2026-01-15', high: 55, low: 35 },
      ],
    });
    const response = await call<{ total: number; missing: string[] }>(
      app,
      'GET',
      '/stations/KITH/degree-days?from=2026-01-13&to=2026-01-15',
    );
    expect(response.body.total).toBe(40);
    expect(response.body.missing).toEqual(['2026-01-14']);
  });

  it('is a 404 for a station we do not have', async () => {
    const { app } = setup();
    expect((await call(app, 'GET', '/stations/KBUF/degree-days')).status).toBe(404);
  });
});

describe('normals', () => {
  it('stores a year of them', async () => {
    const { app } = setup();
    await call(app, 'POST', '/stations', station);
    const response = await call<{ stored: number }>(app, 'PUT', '/stations/KITH/normals', {
      normals: [
        { monthDay: '01-13', heating: 41 },
        { monthDay: '01-14', heating: 42 },
      ],
    });
    expect(response.body.stored).toBe(2);
  });

  it('refuses a key that is not a month and day', async () => {
    const { app } = setup();
    await call(app, 'POST', '/stations', station);
    const response = await call(app, 'PUT', '/stations/KITH/normals', {
      normals: [{ monthDay: '2026-01-13', heating: 41 }],
    });
    expect(response.status).toBe(400);
  });
});
