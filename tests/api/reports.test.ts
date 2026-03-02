import { afterEach, describe, expect, it } from 'vitest';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { buildScenario } from '../support/scenario';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({
    today: '2026-03-31',
    weatherFrom: '2024-07-01',
    weatherTo: '2026-04-01',
  });
  scenario.fill('2026-01-05', 200, { meterTemperature: 60 });
  scenario.fill('2026-02-05', 300, { meterTemperature: 60 });
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /reports/gallons', () => {
  it('defaults to the last year by month', async () => {
    const { app } = setup();
    const response = await call<{ by: string; periods: { period: string }[] }>(
      app,
      'GET',
      '/reports/gallons',
    );
    expect(response.status).toBe(200);
    expect(response.body.by).toBe('month');
    expect(response.body.periods.map((row) => row.period)).toEqual(['2026-01', '2026-02']);
  });

  it('groups by season on request', async () => {
    const { app } = setup();
    const response = await call<{ by: string; periods: { period: string }[] }>(
      app,
      'GET',
      '/reports/gallons?by=season',
    );
    expect(response.body.by).toBe('season');
    expect(response.body.periods[0]?.period).toBe('2025/26');
  });

  it('narrows to an explicit range', async () => {
    const { app } = setup();
    const response = await call<{ periods: unknown[] }>(
      app,
      'GET',
      '/reports/gallons?from=2026-02-01&to=2026-02-28',
    );
    expect(response.body.periods).toHaveLength(1);
  });
});

describe('GET /reports/seasons', () => {
  it('picks the only station when none is named', async () => {
    const { app } = setup();
    const response = await call<{ stationId: string; seasons: { label: string }[] }>(
      app,
      'GET',
      '/reports/seasons',
    );
    expect(response.body.stationId).toBe('KITH');
    expect(response.body.seasons).toHaveLength(3);
  });

  it('takes an explicit list of seasons', async () => {
    const { app } = setup();
    const response = await call<{ seasons: { season: number }[] }>(
      app,
      'GET',
      '/reports/seasons?seasons=2024,2025',
    );
    expect(response.body.seasons.map((row) => row.season)).toEqual([2024, 2025]);
  });

  it('is a 404 for a station we do not have', async () => {
    const { app } = setup();
    expect((await call(app, 'GET', '/reports/seasons?stationId=KBUF')).status).toBe(404);
  });
});

describe('the other two reports', () => {
  it('reports meter accuracy over a default window', async () => {
    const { app } = setup();
    const response = await call<{ tickets: number; withBothGauges: number }>(
      app,
      'GET',
      '/reports/meter-accuracy',
    );
    expect(response.body.tickets).toBe(2);
    expect(response.body.withBothGauges).toBe(2);
  });

  it('reports route efficiency even when there are no routes', async () => {
    const { app } = setup();
    const response = await call<{ routes: number; fillRate: number | null }>(
      app,
      'GET',
      '/reports/routes',
    );
    expect(response.body.routes).toBe(0);
    expect(response.body.fillRate).toBeNull();
  });
});
