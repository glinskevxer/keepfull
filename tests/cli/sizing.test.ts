import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup(appliances: string[] = ['furnace', 'water_heater']) {
  const scenario = buildScenario({ today: '2026-01-10' });
  scenario.context.tanks.update({
    ...scenario.context.tanks.get(scenario.tank.id),
    appliances: appliances as never,
  });
  return { scenario, ...cliDeps(scenario) };
}

describe('sizing tank', () => {
  it('passes a house tank', async () => {
    const { scenario, deps, writer } = setup();
    const result = await run(['sizing', 'tank', scenario.tank.id], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/verdict     ok, headroom/);
    expect(writer.text).toMatch(/largest furnace/);
  });

  it('calls out an undersized one', async () => {
    const { scenario, deps, writer } = setup(['grain_dryer']);
    await run(['sizing', 'tank', scenario.tank.id], deps);
    expect(writer.text).toMatch(/verdict     UNDERSIZED/);
  });

  it('gets harsher on a colder design day', async () => {
    const { scenario, deps, writer } = setup(['boiler', 'shop_heater']);
    await run(['--json', 'sizing', 'tank', scenario.tank.id, '--ambient', '-20'], deps);
    const cold = JSON.parse(writer.text) as { check: { headroom: number } };
    expect(cold.check.headroom).toBeLessThan(2);
  });

  it('reports a tank we do not have as a domain failure', async () => {
    const { deps, writer } = setup();
    const result = await run(['sizing', 'tank', 't-nope'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no tank with id/);
  });
});

describe('sizing quote', () => {
  it('recommends a tank for an appliance list', async () => {
    const { deps, writer } = setup();
    await run(['sizing', 'quote', 'furnace,water_heater,range'], deps);
    expect(writer.text).toMatch(/recommend   \d+ gallons/);
  });

  it('says so when nothing on the yard covers it', async () => {
    const { deps, writer } = setup();
    await run(['sizing', 'quote', 'grain_dryer', '--down-to', '5'], deps);
    expect(writer.text).toMatch(/nothing on the yard covers this load/);
  });
});

describe('sizing undersized', () => {
  it('lists the ones that cannot keep up', async () => {
    const { deps, writer } = setup(['grain_dryer']);
    await run(['sizing', 'undersized'], deps);
    expect(writer.text).toMatch(/tank\s+size\s+largest\s+design btu\s+headroom\s+needs/);
  });

  it('says nothing when the book is sized right', async () => {
    const { deps, writer } = setup(['furnace']);
    await run(['sizing', 'undersized'], deps);
    expect(writer.text).toBe('(nothing)');
  });
});
