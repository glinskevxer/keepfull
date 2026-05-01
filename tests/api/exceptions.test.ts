import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario, seedCleanHistory } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';
import { dayKey } from '../../src/util/dates';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2024-01-01'));
  return { scenario, app: testServer(scenario.context) };
}

describe('GET /exceptions', () => {
  it('is empty on a clean book', async () => {
    const { scenario, app } = setup();
    seedCleanHistory(scenario);
    const response = await call<{ exceptions: unknown[]; today: number }>(
      app,
      'GET',
      '/exceptions',
    );
    expect(response.status).toBe(200);
    expect(response.body.exceptions).toEqual([]);
    expect(response.body.today).toBe(0);
  });

  it('reports what is wrong, worst first', async () => {
    const { app } = setup();
    const response = await call<{ exceptions: { kind: string; rank: number }[] }>(
      app,
      'GET',
      '/exceptions',
    );
    expect(response.body.exceptions.length).toBeGreaterThan(0);
    const ranks = response.body.exceptions.map((entry) => entry.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('filters to one kind', async () => {
    const { app } = setup();
    const response = await call<{ exceptions: { kind: string }[] }>(
      app,
      'GET',
      '/exceptions?kind=tank_cannot_be_forecast',
    );
    expect(
      response.body.exceptions.every((entry) => entry.kind === 'tank_cannot_be_forecast'),
    ).toBe(true);
  });

  it('gives nothing back for a kind that is not raised', async () => {
    const { app } = setup();
    const response = await call<{ exceptions: unknown[]; today: number }>(
      app,
      'GET',
      '/exceptions?kind=budget_plan_short',
    );
    expect(response.body.exceptions).toEqual([]);
    expect(response.body.today).toBe(0);
  });

  it('runs the sizing sweep only when asked', async () => {
    const { scenario, app } = setup();
    seedCleanHistory(scenario);
    scenario.context.tanks.update({
      ...scenario.context.tanks.get(scenario.tank.id),
      appliances: ['grain_dryer'],
    });
    const without = await call<{ byKind: Record<string, number> }>(app, 'GET', '/exceptions');
    expect(without.body.byKind.tank_undersized).toBeUndefined();
    const withSizing = await call<{ byKind: Record<string, number> }>(
      app,
      'GET',
      '/exceptions?includeSizing=true',
    );
    expect(withSizing.body.byKind.tank_undersized).toBe(1);
  });
});
