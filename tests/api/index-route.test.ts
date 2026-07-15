import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { summariseRoutes } from '../../src/api/routes/index-route';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2026-07-09' });
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /', () => {
  it('names itself and lists what it has', async () => {
    const { app } = setup();
    const response = await call<{ service: string; routes: number; paths: string[] }>(
      app,
      'GET',
      '/',
    );
    expect(response.status).toBe(200);
    expect(response.body.service).toBe('keepfull');
    expect(response.body.routes).toBeGreaterThan(30);
    expect(response.body.paths).toContain('GET /health');
  });

  it('says which paths need no key', async () => {
    const { app } = setup();
    const response = await call<{ open: string[] }>(app, 'GET', '/');
    expect(response.body.open).toEqual(['/', '/health', '/metrics', '/ready']);
  });

  it('lists the roles a key can have', async () => {
    const { app } = setup();
    const response = await call<{ roles: string[] }>(app, 'GET', '/');
    expect(response.body.roles).toContain('office');
    expect(response.body.roles).toContain('driver');
  });

  it('covers the real endpoints', async () => {
    const { app } = setup();
    const response = await call<{ paths: string[] }>(app, 'GET', '/');
    for (const path of [
      'GET /customers',
      'POST /deliveries',
      'GET /dispatch/plan',
      'GET /exceptions',
      'GET /reports/gallons',
    ]) {
      expect(response.body.paths).toContain(path);
    }
  });
});

describe('summariseRoutes', () => {
  it('leaves the automatic head and options entries out', () => {
    const { app } = setup();
    const routes = summariseRoutes(app);
    expect(routes.some((route) => route.method === 'HEAD')).toBe(false);
    expect(routes.some((route) => route.method === 'OPTIONS')).toBe(false);
  });

  it('marks the open paths', () => {
    const { app } = setup();
    const routes = summariseRoutes(app);
    expect(routes.find((route) => route.path === '/health')?.open).toBe(true);
    expect(routes.find((route) => route.path === '/customers')?.open).toBe(false);
  });

  it('sorts by path then method, so the list does not churn', () => {
    const { app } = setup();
    const keys = summariseRoutes(app).map((route) => `${route.path} ${route.method}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('has one entry per method and path', () => {
    const { app } = setup();
    const routes = summariseRoutes(app);
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
