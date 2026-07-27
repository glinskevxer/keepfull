import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-07-28' });
  return { scenario, ...cliDeps(scenario) };
}

describe('find', () => {
  it('lists what it matched and how', async () => {
    const { deps, writer } = setup();
    const result = await run(['find', 'Merrick'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/account\s+name\s+address\s+mode\s+matched/);
    expect(writer.text).toMatch(/name/);
  });

  it('finds an account by its road', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'find', 'Bell Hollow'], deps);
    expect(JSON.parse(writer.text)).toHaveLength(1);
  });

  it('says nothing for a term nobody matches', async () => {
    const { deps, writer } = setup();
    await run(['find', 'zzzz'], deps);
    expect(writer.text).toBe('(nothing)');
  });

  it('caps what it shows', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'find', '04', '--limit', '1'], deps);
    expect(JSON.parse(writer.text)).toHaveLength(1);
  });
});
