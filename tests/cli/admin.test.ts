import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-03-02' });
  return { scenario, ...cliDeps(scenario) };
}

describe('admin status', () => {
  it('reports what it is pointed at and what it holds', async () => {
    const { deps, writer } = setup();
    const result = await run(['admin', 'status'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/schema     version \d+, 0 pending/);
    expect(writer.text).toMatch(/integrity  ok/);
    expect(writer.text).toMatch(/holds      1 accounts, 1 tanks, 0 tickets, 1 stations/);
  });

  it('never prints an api key', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'admin', 'status'], deps);
    const parsed = JSON.parse(writer.text) as { settings: Record<string, unknown> };
    expect(Object.keys(parsed.settings)).not.toContain('keyRing');
    expect(parsed.settings.apiKeys).toBe(0);
  });
});

describe('admin migrations', () => {
  it('lists them all as applied', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'admin', 'migrations'], deps);
    const rows = JSON.parse(writer.text) as { state: string; version: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === 'applied')).toBe(true);
    expect(rows.map((row) => row.version)).toEqual(
      [...rows.map((row) => row.version)].sort((a, b) => a - b),
    );
  });

  it('prints a table with the applied dates', async () => {
    const { deps, writer } = setup();
    await run(['admin', 'migrations'], deps);
    expect(writer.text).toMatch(/version\s+name\s+state\s+applied at/);
  });
});

describe('admin compact', () => {
  it('runs and reports the shape afterwards', async () => {
    const { deps, writer } = setup();
    const result = await run(['admin', 'compact'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/compacted, \d+ tables, integrity ok/);
  });
});

describe('admin purge-readings', () => {
  it('counts without deleting on a dry run', async () => {
    const { scenario, deps, writer } = setup();
    scenario.read('2024-01-01', 40);
    scenario.read('2026-03-01', 30);
    await run(['admin', 'purge-readings', '2025-01-01', '--dry-run'], deps);
    expect(writer.text).toMatch(/1 readings are older than 2025-01-01 \(dry run\)/);
    expect(scenario.context.readings.count()).toBe(2);
  });

  it('deletes what it said it would', async () => {
    const { scenario, deps, writer } = setup();
    scenario.read('2024-01-01', 40);
    scenario.read('2026-03-01', 30);
    await run(['admin', 'purge-readings', '2025-01-01'], deps);
    expect(writer.text).toMatch(/deleted 1 readings older than 2025-01-01/);
    expect(scenario.context.readings.count()).toBe(1);
  });

  it('deletes nothing when there is nothing old enough', async () => {
    const { scenario, deps, writer } = setup();
    scenario.read('2026-03-01', 30);
    await run(['admin', 'purge-readings', '2025-01-01'], deps);
    expect(writer.text).toMatch(/deleted 0 readings/);
  });
});
