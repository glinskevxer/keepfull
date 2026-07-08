import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/program';
import { tmpdir } from 'node:os';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
  process.exitCode = undefined;
  closeTestDatabases();
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-admin-'));
  dirs.push(dir);
  return dir;
}

function setup() {
  const scenario = buildScenario({ today: '2026-07-10' });
  return { scenario, ...cliDeps(scenario) };
}

describe('admin seed', () => {
  it('refuses to seed over a database that already has accounts', async () => {
    const { deps, writer } = setup();
    const result = await run(['admin', 'seed', '--customers', '2'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/already 1 accounts on file/);
  });

  it('seeds anyway when forced', async () => {
    const { scenario, deps, writer } = setup();
    await run(['admin', 'seed', '--customers', '2', '--force'], deps);
    expect(writer.text).toMatch(/2 accounts, 2 tanks/);
    expect(scenario.context.customers.count()).toBe(3);
  });

  it('is repeatable for a given seed', async () => {
    const first = setup();
    await run(
      ['--json', 'admin', 'seed', '--customers', '3', '--force', '--seed', '99'],
      first.deps,
    );
    const second = setup();
    await run(
      ['--json', 'admin', 'seed', '--customers', '3', '--force', '--seed', '99'],
      second.deps,
    );
    expect(JSON.parse(second.writer.text)).toEqual(JSON.parse(first.writer.text));
  });
});

describe('admin backup', () => {
  it('writes a copy and says it reads clean', async () => {
    const { deps, writer } = setup();
    const path = join(workspace(), 'copy.db');
    const result = await run(['admin', 'backup', path], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/wrote .*copy\.db/);
    expect(writer.text).toMatch(/the copy opens and reads clean/);
  });

  it('verifies a copy on its own', async () => {
    const { deps, writer } = setup();
    const path = join(workspace(), 'copy.db');
    await run(['admin', 'backup', path], deps);
    writer.stdout.length = 0;
    await run(['admin', 'verify-backup', path], deps);
    expect(writer.text).toMatch(/usable/);
    expect(writer.text).toMatch(/integrity ok/);
  });

  it('says a missing copy is not usable and exits non zero', async () => {
    const { deps, writer } = setup();
    await run(['admin', 'verify-backup', join(workspace(), 'missing.db')], deps);
    expect(writer.text).toMatch(/NOT usable/);
    expect(process.exitCode).toBe(1);
  });
});

describe('admin bench', () => {
  it('times each stage', async () => {
    const { deps, writer } = setup();
    const result = await run(['--json', 'admin', 'bench', '--runs', '1'], deps);
    expect(result.code).toBe(0);
    const timings = JSON.parse(writer.text) as { name: string; meanMs: number }[];
    expect(timings).toHaveLength(5);
    expect(timings.every((timing) => timing.meanMs >= 0)).toBe(true);
  });

  it('prints a lined up table in text form', async () => {
    const { deps, writer } = setup();
    await run(['admin', 'bench', '--runs', '1'], deps);
    expect(writer.text).toMatch(/ms mean/);
    expect(writer.text).toMatch(/ms worst/);
  });
});
