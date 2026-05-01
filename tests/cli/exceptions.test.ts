import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario, seedCleanHistory } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { dayKey } from '../../src/util/dates';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2024-01-01'));
  return { scenario, ...cliDeps(scenario) };
}

describe('exceptions', () => {
  it('says nothing is wrong on a clean book', async () => {
    const { scenario, deps, writer } = setup();
    seedCleanHistory(scenario);
    const result = await run(['exceptions'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/2025-02-10: 0 exceptions, 0 for today/);
    expect(writer.text).toMatch(/\(nothing\)/);
  });

  it('lists a tank that cannot be forecast', async () => {
    const { deps, writer } = setup();
    await run(['exceptions'], deps);
    expect(writer.text).toMatch(/when\s+what\s+subject\s+detail/);
    expect(writer.text).toMatch(/tank_cannot_be_forecast/);
  });

  it('narrows to what has to happen today', async () => {
    const { scenario, deps, writer } = setup();
    seedCleanHistory(scenario);
    scenario.context.customers.setHold(scenario.customer.id, 'past due 90');
    await run(['exceptions', '--window', '30', '--today'], deps);
    expect(writer.text).toMatch(/account_on_hold_with_tank_due/);
  });

  it('leaves the sizing sweep out by default', async () => {
    const { scenario, deps, writer } = setup();
    seedCleanHistory(scenario);
    scenario.context.tanks.update({
      ...scenario.context.tanks.get(scenario.tank.id),
      appliances: ['grain_dryer'],
    });
    await run(['--json', 'exceptions'], deps);
    expect(JSON.parse(writer.text).byKind.tank_undersized).toBeUndefined();
    writer.stdout.length = 0;
    await run(['--json', 'exceptions', '--sizing'], deps);
    expect(JSON.parse(writer.text).byKind.tank_undersized).toBe(1);
  });

  it('takes an as of day', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'exceptions', '--as-of', '2025-03-01'], deps);
    expect(JSON.parse(writer.text).asOf).toBe('2025-03-01');
  });
});
