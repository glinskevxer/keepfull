import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/program';
import { ticketNumber } from '../../src/util/ids';
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
  return { scenario, ...cliDeps(scenario) };
}

function fileWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-tickets-'));
  dirs.push(dir);
  const path = join(dir, 'tickets.csv');
  writeFileSync(path, contents, 'utf8');
  return path;
}

const HEADER = 'ticket,customer,tank,day,gross,temperature,gauge_before,gauge_after,driver,truck';

function row(
  scenario: ReturnType<typeof setup>['scenario'],
  serial: number,
  overrides: string[] = [],
) {
  const base = [
    ticketNumber(serial),
    scenario.customer.id,
    scenario.tank.id,
    '2026-01-14',
    '280',
    '60',
    '22',
    '80',
    'drv-3',
    'b-4',
  ];
  for (const [index, value] of overrides.entries()) {
    if (value !== '') {
      base[index] = value;
    }
  }
  return base.join(',');
}

describe('tickets import', () => {
  it('posts a clean file', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(`${HEADER}\n${row(scenario, 700_001)}\n`);
    const result = await run(['tickets', 'import', path], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/1 rows read, 1 posted, 0 already on file/);
    expect(scenario.context.deliveries.list()).toHaveLength(1);
  });

  it('reads without posting on a dry run', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(`${HEADER}\n${row(scenario, 700_002)}\n`);
    await run(['tickets', 'import', path, '--dry-run'], deps);
    expect(writer.text).toMatch(/\(dry run\)/);
    expect(scenario.context.deliveries.list()).toEqual([]);
  });

  it('posts the good rows and names the bad ones by line', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(
      [
        HEADER,
        row(scenario, 700_003),
        row(scenario, 700_004, ['', '', 't-nope']),
        row(scenario, 700_005, ['', '', '', '', 'lots']),
        '',
      ].join('\n'),
    );
    await run(['tickets', 'import', path], deps);
    expect(writer.text).toMatch(/3 rows read, 1 posted/);
    expect(writer.text).toMatch(/line 3 ticket \d+: not_found/);
    expect(writer.text).toMatch(/line 4 ticket \d+: .*have to be numbers/);
    expect(scenario.context.deliveries.list()).toHaveLength(1);
  });

  it('is idempotent, because a driver plugs in twice', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(`${HEADER}\n${row(scenario, 700_006)}\n`);
    await run(['tickets', 'import', path], deps);
    await run(['tickets', 'import', path], deps);
    expect(writer.text).toMatch(/1 rows read, 0 posted, 1 already on file/);
    expect(scenario.context.deliveries.list()).toHaveLength(1);
  });

  it('reports the flags a ticket raised', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(
      `${HEADER}\n${row(scenario, 700_007, ['', '', '', '', '390', '', '2'])}\n`,
    );
    await run(['tickets', 'import', path], deps);
    expect(writer.text).toMatch(/flagged \d+: .*was_out_of_gas/);
  });

  it('refuses a file with a column missing', async () => {
    const { scenario, deps, writer } = setup();
    const path = fileWith(`ticket,customer\n${ticketNumber(700_008)},${scenario.customer.id}\n`);
    await run(['tickets', 'import', path], deps);
    expect(writer.text).toMatch(/no column called "tank"/);
  });

  it('says so in the log', async () => {
    const { scenario, deps } = setup();
    const path = fileWith(`${HEADER}\n${row(scenario, 700_009)}\n`);
    await run(['tickets', 'import', path], deps);
    expect(scenario.sink.messages()).toContain('imported tickets');
  });

  it('reports a missing file rather than crashing', async () => {
    const { deps, writer } = setup();
    const result = await run(['tickets', 'import', '/nope/nope.csv'], deps);
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/ENOENT/);
  });
});
