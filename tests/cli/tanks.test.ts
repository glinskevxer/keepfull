import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  return { scenario, ...cliDeps(scenario) };
}

describe('tanks list', () => {
  it('prints a table with a dash where there is no reading', async () => {
    const { deps, writer } = setup();
    const result = await run(['tanks', 'list'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/tank\s+serial\s+size\s+gauge\s+read on/);
    expect(writer.text).toMatch(/-\s*$/m);
  });

  it('shows the newest measured gauge', async () => {
    const { scenario, deps, writer } = setup();
    scenario.read('2025-02-09', 37);
    await run(['tanks', 'list'], deps);
    expect(writer.text).toMatch(/37/);
    expect(writer.text).toMatch(/2025-02-09/);
  });

  it('prints json when asked', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'tanks', 'list'], deps);
    const parsed = JSON.parse(writer.text) as { tank: { id: string } }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.tank.id).toMatch(/^t-/);
  });

  it('filters to one account', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'tanks', 'list', '--customer', 'c-nope'], deps);
    expect(JSON.parse(writer.text)).toEqual([]);
  });

  it('leaves out a tank that has come out', async () => {
    const { scenario, deps, writer } = setup();
    const extra = scenario.addTank();
    scenario.context.tanks.remove(extra.id, '2025-01-01' as never);
    await run(['--json', 'tanks', 'list', '--in-service'], deps);
    expect(JSON.parse(writer.text)).toHaveLength(1);
  });
});

describe('tanks show', () => {
  it('prints the whole picture', async () => {
    const { scenario, deps, writer } = setup();
    scenario.read('2025-02-09', 40);
    scenario.fill('2025-01-05', 280);
    const result = await run(['tanks', 'show', scenario.tank.id], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/account   04-/);
    expect(writer.text).toMatch(/size      500 gal, fill limit 80%, reserve 25%/);
    expect(writer.text).toMatch(
      /gauge     40% on 2025-02-09 from driver, 200.0 gal in, room for 200.0/,
    );
    expect(writer.text).toMatch(/last fill 2025-01-05/);
  });

  it('says so when there is no reading and no fill', async () => {
    const { scenario, deps, writer } = setup();
    await run(['tanks', 'show', scenario.tank.id], deps);
    expect(writer.text).toMatch(/gauge     no measured reading on file/);
    expect(writer.text).toMatch(/last fill never/);
  });

  it('reports a tank we do not have as a domain failure', async () => {
    const { deps, writer } = setup();
    const result = await run(['tanks', 'show', 't-nope'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no tank with id t-nope/);
  });

  it('prints json when asked', async () => {
    const { scenario, deps, writer } = setup();
    await run(['--json', 'tanks', 'show', scenario.tank.id], deps);
    const parsed = JSON.parse(writer.text) as { tank: { id: string } };
    expect(parsed.tank.id).toBe(scenario.tank.id);
  });
});

describe('the program itself', () => {
  it('reports an unknown command rather than throwing', async () => {
    const { deps, writer } = setup();
    const result = await run(['nonsense'], deps);
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/unknown command/i);
  });

  it('prints help without opening a database', async () => {
    const writer = new (await import('../../src/cli/output')).MemoryWriter();
    const result = await run(['--help'], {
      writer,
      runtime: () => {
        throw new Error('should not have opened a database');
      },
      settings: () => {
        throw new Error('should not have read the environment');
      },
    });
    expect(result.code).toBe(0);
  });
});
