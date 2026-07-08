import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { makeDriver, makeTruck } from '../../src/model/fleet';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-01-14', waterCapacity: 1000 });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({ id: 'drv-3', name: 'R Vandemark', licenceNumber: 'NY-1' }),
  );
  return { scenario, ...cliDeps(scenario) };
}

describe('reports driver-day', () => {
  it('says nothing on a quiet day', async () => {
    const { deps, writer } = setup();
    const result = await run(['reports', 'driver-day'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/\(nothing\)/);
  });

  it('summarises what a driver did', async () => {
    const { scenario, deps, writer } = setup();
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    await run(['reports', 'driver-day'], deps);
    expect(writer.text).toMatch(/driver\s+stops\s+missed\s+net gal\s+per stop/);
    expect(writer.text).toMatch(/drv-3/);
    expect(writer.text).toMatch(/open/);
  });

  it('narrows to one driver', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'reports', 'driver-day', '--driver', 'drv-3'], deps);
    const payload = JSON.parse(writer.text) as { rows: { driverId: string }[] };
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]?.driverId).toBe('drv-3');
  });

  it('reports a driver we do not have as a domain failure', async () => {
    const { deps, writer } = setup();
    const result = await run(['reports', 'driver-day', '--driver', 'drv-nope'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no driver with id/);
  });

  it('takes a day', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'reports', 'driver-day', '--on', '2026-01-13'], deps);
    expect((JSON.parse(writer.text) as { on: string }).on).toBe('2026-01-13');
  });
});
