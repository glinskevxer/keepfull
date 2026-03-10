import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { makeTruck } from '../../src/model/fleet';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-01-14', waterCapacity: 1000 });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  return { scenario, ...cliDeps(scenario) };
}

describe('loads record', () => {
  it('records a load and numbers it', async () => {
    const { deps, writer } = setup();
    const result = await run(['loads', 'record', 'b-4', '600', '60', '100000'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/b-4  2026-01-14  load 1  600\.0 gross, 600\.0 net/);
  });

  it('numbers a second load of the day', async () => {
    const { deps, writer } = setup();
    await run(['loads', 'record', 'b-4', '600', '60', '100000'], deps);
    await run(['loads', 'record', 'b-4', '600', '60', '100600'], deps);
    expect(writer.text).toMatch(/load 2/);
  });

  it('refuses a truck we do not have', async () => {
    const { deps, writer } = setup();
    const result = await run(['loads', 'record', 'b-nope', '600', '60', '100000'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no truck with id/);
  });
});

describe('loads close', () => {
  it('closes a shift and says what came off', async () => {
    const { scenario, deps, writer } = setup();
    await run(['loads', 'record', 'b-4', '600', '60', '100000'], deps);
    const loadId = scenario.context.loads.list()[0]?.id as string;
    await run(['loads', 'close', loadId, '100598'], deps);
    expect(writer.text).toMatch(/closed, 598\.0 gallons metered out/);
  });

  it('refuses a meter that runs backwards', async () => {
    const { scenario, deps, writer } = setup();
    await run(['loads', 'record', 'b-4', '600', '60', '100000'], deps);
    const loadId = scenario.context.loads.list()[0]?.id as string;
    const result = await run(['loads', 'close', loadId, '99000'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/cannot run backwards/);
  });
});

describe('loads reconcile', () => {
  it('prints a clean day', async () => {
    const { scenario, deps, writer } = setup();
    await run(['loads', 'record', 'b-4', '600', '60', '100000'], deps);
    const loadId = scenario.context.loads.list()[0]?.id as string;
    await run(['loads', 'close', loadId, '100598'], deps);
    scenario.fill('2026-01-14', 596, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 10,
      gaugeAfter: 70,
    });
    await run(['loads', 'reconcile', '--day', '2026-01-14'], deps);
    expect(writer.text).toMatch(/truck\s+loads\s+plant\s+metered\s+ticketed/);
    expect(writer.text).toMatch(/clean/);
  });

  it('says nothing on a day nobody loaded', async () => {
    const { deps, writer } = setup();
    await run(['loads', 'reconcile', '--day', '2026-01-14'], deps);
    expect(writer.text).toMatch(/\(nothing\)/);
  });
});

describe('loads drift', () => {
  it('says a truck is fine when it is', async () => {
    const { scenario, deps, writer } = setup();
    await run(['loads', 'record', 'b-4', '600', '60', '100000'], deps);
    const loadId = scenario.context.loads.list()[0]?.id as string;
    await run(['loads', 'close', loadId, '100598'], deps);
    scenario.fill('2026-01-14', 596, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 10,
      gaugeAfter: 70,
    });
    await run(['loads', 'drift', 'b-4'], deps);
    expect(writer.text).toMatch(/nothing worth pulling the meter for/);
  });

  it('refuses a truck we do not have', async () => {
    const { deps, writer } = setup();
    const result = await run(['loads', 'drift', 'b-nope'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no truck with id/);
  });
});
