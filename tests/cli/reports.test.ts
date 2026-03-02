import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({
    today: '2026-03-31',
    weatherFrom: '2024-07-01',
    weatherTo: '2026-04-01',
  });
  scenario.fill('2026-01-05', 200, { meterTemperature: 60 });
  scenario.fill('2026-02-05', 300, { meterTemperature: 60 });
  return { scenario, ...cliDeps(scenario) };
}

describe('reports gallons', () => {
  it('prints a month table', async () => {
    const { deps, writer } = setup();
    const result = await run(['reports', 'gallons', '--from', '2026-01-01'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/period\s+tickets\s+gross\s+net\s+correction\s+avg drop/);
    expect(writer.text).toMatch(/2026-01/);
    expect(writer.text).toMatch(/2026-02/);
  });

  it('groups by season when asked', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'reports', 'gallons', '--from', '2025-07-01', '--by', 'season'], deps);
    const rows = JSON.parse(writer.text) as { period: string; netGallons: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2025/26', netGallons: 500 });
  });

  it('says nothing for a quiet range', async () => {
    const { deps, writer } = setup();
    await run(['reports', 'gallons', '--from', '2020-01-01', '--to', '2020-12-31'], deps);
    expect(writer.text).toBe('(nothing)');
  });
});

describe('reports seasons', () => {
  it('shows gallons against degree days', async () => {
    const { deps, writer } = setup();
    await run(['reports', 'seasons', 'KITH', '--back', '2'], deps);
    expect(writer.text).toMatch(/season\s+degree days\s+net gallons\s+tickets\s+gal\/dd/);
    expect(writer.text).toMatch(/2025\/26/);
  });

  it('refuses a station it does not know', async () => {
    const { deps, writer } = setup();
    const result = await run(['reports', 'seasons', 'KBUF'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no station with id KBUF/);
  });
});

describe('reports meter-accuracy', () => {
  it('reports the spread between gauge and meter', async () => {
    const { deps, writer } = setup();
    await run(['reports', 'meter-accuracy', '--from', '2026-01-01'], deps);
    expect(writer.text).toMatch(/2 tickets, 2 with both gauges read/);
    expect(writer.text).toMatch(/mean absolute /);
  });

  it('says nothing is out of line when the numbers agree', async () => {
    const scenario = buildScenario({ today: '2026-03-31' });
    const { deps, writer } = cliDeps(scenario);
    await run(['reports', 'meter-accuracy'], deps);
    expect(writer.text).toMatch(/nothing out of line/);
  });
});

describe('reports routes', () => {
  it('says so when no miles were planned', async () => {
    const { deps, writer } = setup();
    await run(['reports', 'routes'], deps);
    expect(writer.text).toMatch(/0 routes, 0 stops, 0 missed/);
    expect(writer.text).toMatch(/no miles planned/);
  });
});
