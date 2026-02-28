import { afterEach, describe, expect, it } from 'vitest';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { buildScenario, seedCleanHistory } from '../support/scenario';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

/** Six clean fills a month apart, six gallons a day at twenty degree days. */
function setup(options: { withHistory?: boolean } = {}) {
  const scenario = buildScenario({ today: '2025-02-10' });
  if (options.withHistory !== false) {
    seedCleanHistory(scenario);
  }
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /tanks/:id/forecast', () => {
  it('gives the projection with the evidence behind it', async () => {
    const { scenario, app } = setup();
    const response = await call<{
      forecast: {
        reserveDay: string;
        model: { intervalsUsed: number; kFactor: number; baseGallonsPerDay: number };
        evidence: { usableShare: number };
      };
    }>(app, 'GET', `/tanks/${scenario.tank.id}/forecast`);
    expect(response.status).toBe(200);
    expect(response.body.forecast.reserveDay).toBe('2025-02-16');
    expect(response.body.forecast.model.intervalsUsed).toBe(5);
    expect(response.body.forecast.evidence.usableShare).toBe(1);
  });

  it('reports the k factor the office asks for', async () => {
    const { scenario, app } = setup();
    const response = await call<{
      forecast: { model: { kFactor: number; baseGallonsPerDay: number } };
    }>(app, 'GET', `/tanks/${scenario.tank.id}/forecast`);
    // This yard's test weather is flat, so degree days and elapsed days move
    // together and the two terms cannot be told apart. The fit collapses to the
    // weather term alone, which is the old single k factor: twenty degree days
    // a day against six gallons a day is one gallon every three and a third.
    expect(response.body.forecast.model.kFactor).toBeCloseTo(3.33, 1);
    expect(response.body.forecast.model.baseGallonsPerDay).toBe(0);
  });

  it('takes a horizon', async () => {
    const { scenario, app } = setup();
    const response = await call<{ forecast: { horizonDays: number; reserveDay: string | null } }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/forecast?horizonDays=5`,
    );
    expect(response.body.forecast.horizonDays).toBe(5);
    expect(response.body.forecast.reserveDay).toBeNull();
  });

  it('refuses a horizon that is not a number', async () => {
    const { scenario, app } = setup();
    expect(
      (await call(app, 'GET', `/tanks/${scenario.tank.id}/forecast?horizonDays=lots`)).status,
    ).toBe(400);
  });

  it('says a thin history is a data problem, not a server one', async () => {
    const { scenario, app } = setup({ withHistory: false });
    const response = await call<{ code: string }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/forecast`,
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('insufficient_history');
  });

  it('is a 404 for a tank we do not have', async () => {
    const { app } = setup();
    expect((await call(app, 'GET', '/tanks/t-nope/forecast')).status).toBe(404);
  });
});

describe('GET /tanks/:id/forecast/days', () => {
  it('walks the tank down day by day', async () => {
    const { scenario, app } = setup();
    const response = await call<{ days: { day: string; gallonsRemaining: number }[] }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/forecast/days?horizonDays=3`,
    );
    expect(response.body.days).toHaveLength(3);
    expect(response.body.days[0]?.gallonsRemaining).toBeCloseTo(394, 1);
  });

  it('marks which days had real weather', async () => {
    const { scenario, app } = setup();
    const response = await call<{ days: { actualWeather: boolean }[] }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/forecast/days?horizonDays=3`,
    );
    expect(response.body.days.every((day) => typeof day.actualWeather === 'boolean')).toBe(true);
  });
});

describe('GET /tanks/:id/burn-model', () => {
  it('shows the intervals the fit used', async () => {
    const { scenario, app } = setup();
    const response = await call<{ intervals: unknown[]; skipped: unknown[] }>(
      app,
      'GET',
      `/tanks/${scenario.tank.id}/burn-model`,
    );
    expect(response.body.intervals).toHaveLength(5);
    expect(response.body.skipped).toEqual([]);
  });
});

describe('GET /forecasts/summary', () => {
  it('counts what can and cannot be forecast', async () => {
    const { scenario, app } = setup();
    scenario.addTank();
    const response = await call<{ forecast: number; unforecastable: number }>(
      app,
      'GET',
      '/forecasts/summary',
    );
    expect(response.body.forecast).toBe(1);
    expect(response.body.unforecastable).toBe(1);
  });

  it('counts what is due soon and what is already past', async () => {
    const { app } = setup();
    const soon = await call<{ dueInside14: number; overdue: number }>(
      app,
      'GET',
      '/forecasts/summary?asOf=2025-02-10',
    );
    expect(soon.body.dueInside14).toBe(1);
    expect(soon.body.overdue).toBe(0);
    const late = await call<{ overdue: number }>(app, 'GET', '/forecasts/summary?asOf=2025-03-01');
    expect(late.body.overdue).toBe(1);
  });
});
