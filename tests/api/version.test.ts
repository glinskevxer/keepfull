import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2026-08-07' });
  return { scenario, app: testServer(scenario.context) };
}

describe('what is running', () => {
  it('the index says the version', async () => {
    const { app } = setup();
    const response = await call<{ service: string; version: string; node: string }>(
      app,
      'GET',
      '/',
    );
    expect(response.body.service).toBe('keepfull');
    expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(response.body.node).toBe(process.version);
  });

  it('ready says it too, because it is asked in the same breath', async () => {
    const { app } = setup();
    const response = await call<{ status: string; version: string }>(app, 'GET', '/ready');
    expect(response.body.status).toBe('ready');
    expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reports no commit when nothing set one', async () => {
    const { app } = setup();
    const response = await call<{ commit: string | null }>(app, 'GET', '/');
    expect(response.body.commit).toBeNull();
  });
});
