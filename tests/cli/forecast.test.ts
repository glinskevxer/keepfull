import { afterEach, describe, expect, it } from 'vitest';
import { Scenario, buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { dayKey, daysBetween } from '../../src/util/dates';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function history(scenario: Scenario, tankId: string) {
  const days = ['2024-08-01', '2024-09-01', '2024-10-01', '2024-11-01', '2024-12-01', '2025-01-01'];
  scenario.fillTank(tankId, days[0] as string, 180);
  for (let index = 1; index < days.length; index += 1) {
    const span = daysBetween(dayKey(days[index - 1] as string), dayKey(days[index] as string));
    scenario.fillTank(tankId, days[index] as string, 6 * span);
  }
}

function setup(options: { withHistory?: boolean } = {}) {
  const scenario = buildScenario({ today: '2025-02-10' });
  if (options.withHistory !== false) {
    history(scenario, scenario.tank.id);
  }
  return { scenario, ...cliDeps(scenario) };
}

describe('forecast tank', () => {
  it('prints the model and the projected days', async () => {
    const { scenario, deps, writer } = setup();
    const result = await run(['forecast', 'tank', scenario.tank.id], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/base load /);
    expect(writer.text).toMatch(/k factor  3\.33/);
    expect(writer.text).toMatch(/reserve   2025-02-16/);
  });

  it('takes an as of day', async () => {
    const { scenario, deps, writer } = setup();
    await run(['forecast', 'tank', scenario.tank.id, '--as-of', '2025-01-15'], deps);
    expect(writer.text).toMatch(/reserve   2025-02-16/);
  });

  it('honours a short horizon', async () => {
    const { scenario, deps, writer } = setup();
    await run(['forecast', 'tank', scenario.tank.id, '--horizon', '3'], deps);
    expect(writer.text).toMatch(/reserve   not inside the horizon/);
  });

  it('reports a thin history as a domain failure', async () => {
    const { scenario, deps, writer } = setup({ withHistory: false });
    const result = await run(['forecast', 'tank', scenario.tank.id], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/insufficient_history/);
  });

  it('prints json when asked', async () => {
    const { scenario, deps, writer } = setup();
    await run(['--json', 'forecast', 'tank', scenario.tank.id], deps);
    const parsed = JSON.parse(writer.text) as { forecast: { reserveDay: string } };
    expect(parsed.forecast.reserveDay).toBe('2025-02-16');
  });
});

describe('forecast due', () => {
  it('lists a tank inside the window', async () => {
    const { deps, writer } = setup();
    await run(['forecast', 'due', '--window', '30'], deps);
    expect(writer.text).toMatch(/reserve on/);
    expect(writer.text).toMatch(/2025-02-16/);
  });

  it('says nothing when nothing is due', async () => {
    const { deps, writer } = setup();
    await run(['forecast', 'due', '--window', '1'], deps);
    expect(writer.text).toBe('(nothing)');
  });

  it('skips a tank it cannot forecast rather than failing', async () => {
    const { scenario, deps, writer } = setup();
    scenario.addTank();
    await run(['--json', 'forecast', 'due', '--window', '30'], deps);
    expect(JSON.parse(writer.text)).toHaveLength(1);
  });

  it('sorts soonest first', async () => {
    const { scenario, deps, writer } = setup();
    const second = scenario.addTank();
    history(scenario, second.id);
    await run(['--json', 'forecast', 'due', '--window', '60'], deps);
    const rows = JSON.parse(writer.text) as { reserveDay: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.reserveDay <= rows[1]!.reserveDay).toBe(true);
  });
});
