import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario, seedCleanHistory } from '../support/scenario';
import { closeTestDatabases } from '../support/db';
import { closeTestServers, testServer } from '../support/api';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /metrics', () => {
  it('needs no key, because the scraper has none', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
  });

  it('counts the requests it has handled', async () => {
    const { app } = setup();
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/health' });
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(
      /keepfull_requests_total\{method="GET",route="\/health",status="200"\} 2/,
    );
  });

  it('labels by route pattern rather than by url', async () => {
    const { scenario, app } = setup();
    await app.inject({
      method: 'GET',
      url: `/tanks/${scenario.tank.id}`,
      headers: { authorization: 'Bearer test-office-key-long-enough-here' },
    });
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(/route="\/tanks\/:id"/);
    expect(response.body).not.toContain(scenario.tank.id);
  });

  it('times the requests', async () => {
    const { app } = setup();
    await app.inject({ method: 'GET', url: '/health' });
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(/keepfull_request_duration_ms_count\{route="\/health"\} 1/);
  });

  it('counts the tanks and how many can be forecast', async () => {
    const { scenario, app } = setup();
    seedCleanHistory(scenario);
    scenario.addTank();
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(/keepfull_tanks_in_service 2/);
    expect(response.body).toMatch(/keepfull_tanks_forecastable 1/);
  });

  it('counts the morning board by urgency', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(/keepfull_exceptions_open\{urgency="today"\}/);
    expect(response.body).toMatch(/keepfull_exceptions_open\{urgency="this_week"\}/);
  });

  it('counts a failure by its status', async () => {
    const { app } = setup();
    await app.inject({
      method: 'GET',
      url: '/customers/c-nope',
      headers: { authorization: 'Bearer test-office-key-long-enough-here' },
    });
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(/status="404"/);
  });
});
