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
  const scenario = buildScenario({
    today: '2026-01-15',
    weatherFrom: '2026-01-01',
    weatherTo: '2026-01-10',
  });
  return { scenario, ...cliDeps(scenario) };
}

function fileWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-csv-'));
  dirs.push(dir);
  const path = join(dir, 'weather.csv');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('weather stations', () => {
  it('lists what each station holds', async () => {
    const { deps, writer } = setup();
    const result = await run(['weather', 'stations'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/KITH/);
    expect(writer.text).toMatch(/2026-01-10/);
  });
});

describe('weather import', () => {
  it('loads a clean file', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith('day,high,low\n2026-01-11,30,12\n2026-01-12,28,9\n');
    const result = await run(['weather', 'import', 'KITH', path], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/2 rows read, 2 usable, 2 written/);
    expect(scenario.context.weather.latestObservationDay('KITH')).toBe('2026-01-12');
  });

  it('reads without writing on a dry run', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith('day,high,low\n2026-01-11,30,12\n');
    await run(['weather', 'import', 'KITH', path, '--dry-run'], deps);
    expect(writer.text).toMatch(/0 written \(dry run\)/);
    expect(scenario.context.weather.latestObservationDay('KITH')).toBe('2026-01-10');
  });

  it('keeps the good rows and names the bad ones by line', async () => {
    const { deps, writer } = setup();
    const path = fileWith(
      'day,high,low\n2026-01-11,30,12\nnot-a-day,30,12\n2026-01-13,9,28\n2026-01-14,warm,12\n',
    );
    await run(['weather', 'import', 'KITH', path], deps);
    expect(writer.text).toMatch(/4 rows read, 1 usable, 1 written/);
    expect(writer.text).toMatch(/line 3: /);
    expect(writer.text).toMatch(/line 4: low 28 is above high 9/);
    expect(writer.text).toMatch(/line 5: high and low both have to be numbers/);
  });

  it('is idempotent over the same file', async () => {
    const { scenario, deps } = setup();
    const path = fileWith('day,high,low\n2026-01-11,30,12\n');
    await run(['weather', 'import', 'KITH', path], deps);
    await run(['weather', 'import', 'KITH', path], deps);
    expect(scenario.context.weather.countObservations('KITH')).toBe(11);
  });

  it('refuses a station we do not have', async () => {
    const { deps, writer } = setup();
    const path = fileWith('day,high,low\n2026-01-11,30,12\n');
    const result = await run(['weather', 'import', 'KBUF', path], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no station with id KBUF/);
  });

  it('reports a missing file rather than crashing', async () => {
    const { deps, writer } = setup();
    const result = await run(['weather', 'import', 'KITH', '/nope/nope.csv'], deps);
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/ENOENT/);
  });
});

describe('weather degree-days', () => {
  it('adds them up and names the gaps', async () => {
    const { deps, writer } = setup();
    await run(
      ['weather', 'degree-days', 'KITH', '--from', '2026-01-01', '--to', '2026-01-12'],
      deps,
    );
    expect(writer.text).toMatch(/200\.0 heating degree days over 10 days/);
    expect(writer.text).toMatch(/2 days missing: 2026-01-11, 2026-01-12/);
  });

  it('says so when there are no gaps', async () => {
    const { deps, writer } = setup();
    await run(
      ['weather', 'degree-days', 'KITH', '--from', '2026-01-01', '--to', '2026-01-10'],
      deps,
    );
    expect(writer.text).toMatch(/no gaps/);
  });

  it('prints json when asked', async () => {
    const { deps, writer } = setup();
    await run(
      ['--json', 'weather', 'degree-days', 'KITH', '--from', '2026-01-01', '--to', '2026-01-10'],
      deps,
    );
    const parsed = JSON.parse(writer.text) as { total: number };
    expect(parsed.total).toBe(200);
  });
});
