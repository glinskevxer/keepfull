import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario, seedCleanHistory } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { makeDriver, makeTruck } from '../../src/model/fleet';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({
      id: 'drv-3',
      name: 'R Vandemark',
      licenceNumber: 'NY-882-441',
      endorsements: ['hazmat', 'tanker'],
    }),
  );
  seedCleanHistory(scenario);
  return { scenario, ...cliDeps(scenario) };
}

describe('dispatch plan', () => {
  it('prints a truck block with its stops', async () => {
    const { deps, writer } = setup();
    const result = await run(['dispatch', 'plan', '--window', '30'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/truck b-4: 1 stops/);
    expect(writer.text).toMatch(/days left/);
  });

  it('says nothing due when nothing is', async () => {
    const { deps, writer } = setup();
    await run(['dispatch', 'plan', '--window', '1'], deps);
    expect(writer.text).toMatch(/0 stops/);
  });

  it('names what it had to defer', async () => {
    const { scenario, deps, writer } = setup();
    scenario.context.fleet.retireTruck('b-4');
    await run(['dispatch', 'plan', '--window', '30'], deps);
    expect(writer.text).toMatch(/deferred: .*no_trucks/);
  });
});

describe('dispatch commit', () => {
  it('creates a route and prints it', async () => {
    const { deps, writer } = setup();
    const result = await run(['dispatch', 'commit', '--window', '30'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/truck b-4  2025-02-11  1 stops/);
  });

  it('assigns a driver from the flag', async () => {
    const { scenario, deps } = setup();
    await run(['dispatch', 'commit', '--window', '30', '--driver', 'b-4=drv-3'], deps);
    expect(scenario.context.routes.list()[0]?.driverId).toBe('drv-3');
  });

  it('refuses a driver pair that is not a pair', async () => {
    const { deps, writer } = setup();
    const result = await run(['dispatch', 'commit', '--window', '30', '--driver', 'b-4'], deps);
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/truckId=driverId/);
  });

  it('says so when there is nothing to commit', async () => {
    const { deps, writer } = setup();
    await run(['dispatch', 'commit', '--window', '1'], deps);
    expect(writer.text).toBe('nothing to commit');
  });

  it('replaces an earlier planned route when told to', async () => {
    const { scenario, deps } = setup();
    await run(['dispatch', 'commit', '--window', '30'], deps);
    await run(['dispatch', 'commit', '--window', '30', '--replace'], deps);
    expect(scenario.context.routes.list()).toHaveLength(1);
  });
});

describe('dispatch sheet', () => {
  it('prints what the driver takes with them', async () => {
    const { scenario, deps, writer } = setup();
    await run(['dispatch', 'commit', '--window', '30'], deps);
    const routeId = scenario.context.routes.list()[0]?.id as string;
    await run(['dispatch', 'sheet', routeId], deps);
    expect(writer.text).toMatch(/route .*truck b-4  2025-02-11  planned/);
    expect(writer.text).toMatch(/Bell Hollow Rd, Danby/);
  });

  it('reports a route we do not have as a domain failure', async () => {
    const { deps, writer } = setup();
    const result = await run(['dispatch', 'sheet', 'rt-nope'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no route with id/);
  });
});
