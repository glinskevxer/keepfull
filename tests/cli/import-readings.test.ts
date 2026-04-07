import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/program';
import { tmpdir } from 'node:os';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2026-01-14' });
  const monitored = scenario.addTank({ monitorId: 'WT-4471' });
  return { scenario, monitored, ...cliDeps(scenario) };
}

function fileWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-readings-'));
  dirs.push(dir);
  const path = join(dir, 'readings.csv');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('readings import', () => {
  it('writes what matched a tank', async () => {
    const { scenario, monitored, deps, writer } = setup();
    const path = fileWith('monitor,day,percent\nWT-4471,2026-01-13,41.5\n');
    const result = await run(['readings', 'import', path], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/1 rows read, 1 usable, 1 written/);
    expect(scenario.context.readings.latestFor(monitored.id)?.gauge).toBe(41.5);
  });

  it('names the monitors that matched nothing', async () => {
    const { deps, writer } = setup();
    const path = fileWith('monitor,day,percent\nWT-9999,2026-01-13,41.5\nWT-8888,2026-01-13,20\n');
    await run(['readings', 'import', path], deps);
    expect(writer.text).toMatch(/2 monitors matched nothing: WT-8888, WT-9999/);
  });

  it('says so when everything matched', async () => {
    const { deps, writer } = setup();
    const path = fileWith('monitor,day,percent\nWT-4471,2026-01-13,41.5\n');
    await run(['readings', 'import', path], deps);
    expect(writer.text).toMatch(/every monitor matched a tank/);
  });

  it('warns in the log about monitors we do not have', async () => {
    const { scenario, deps } = setup();
    const path = fileWith('monitor,day,percent\nWT-9999,2026-01-13,41.5\n');
    await run(['readings', 'import', path], deps);
    expect(scenario.sink.messages()).toContain('the monitor export named monitors we do not have');
  });

  it('reads without writing on a dry run', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith('monitor,day,percent\nWT-4471,2026-01-13,41.5\n');
    await run(['readings', 'import', path, '--dry-run'], deps);
    expect(writer.text).toMatch(/0 written \(dry run\)/);
    expect(scenario.context.readings.count()).toBe(0);
  });

  it('names a bad row by line and keeps the rest', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(
      'monitor,day,percent\nWT-4471,2026-01-13,41.5\nWT-4471,2026-01-14,warm\nWT-4471,2026-01-15,140\n',
    );
    await run(['readings', 'import', path], deps);
    expect(writer.text).toMatch(/line 3 monitor WT-4471: .*has to be a number/);
    expect(writer.text).toMatch(/line 4 monitor WT-4471: .*between 0 and 100/);
    expect(scenario.context.readings.count()).toBe(1);
  });

  it('collapses a monitor reporting twice on one day', async () => {
    const { scenario, deps } = setup();
    const path = fileWith('monitor,day,percent\nWT-4471,2026-01-13,41.5\nWT-4471,2026-01-13,38\n');
    await run(['readings', 'import', path], deps);
    expect(scenario.context.readings.count()).toBe(1);
  });

  it('reports a missing file rather than crashing', async () => {
    const { deps, writer } = setup();
    const result = await run(['readings', 'import', '/nope/nope.csv'], deps);
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/ENOENT/);
  });
});

describe('readings unmatched', () => {
  it('finds a monitor that has never reported', async () => {
    const { monitored, deps, writer } = setup();
    await run(['readings', 'unmatched'], deps);
    expect(writer.text).toMatch(new RegExp(`${monitored.id}  WT-4471  never reported`));
  });

  it('says so once it has', async () => {
    const { deps, writer } = setup();
    const path = fileWith('monitor,day,percent\nWT-4471,2026-01-13,41.5\n');
    await run(['readings', 'import', path], deps);
    await run(['readings', 'unmatched'], deps);
    expect(writer.text).toMatch(/every monitor on the book has reported at least once/);
  });
});
