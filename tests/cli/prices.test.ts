import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { dayKey } from '../../src/util/dates';
import { makeSchedule } from '../../src/core/pricing';
import { parseMills } from '../../src/util/money';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-05-14', weatherFrom: '2024-07-01' });
  scenario.context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-agricultural',
      rateClass: 'agricultural',
      effectiveFrom: dayKey('2026-01-01'),
      tiers: [
        { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
        { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
      ],
    }),
  );
  return { scenario, ...cliDeps(scenario) };
}

describe('prices schedules', () => {
  it('lists what is on file', async () => {
    const { deps, writer } = setup();
    const result = await run(['prices', 'schedules'], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/schedule\s+class\s+from\s+tiers/);
    expect(writer.text).toMatch(/0\+ \$3\.4990/);
  });

  it('filters by class', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'prices', 'schedules', '--class', 'residential'], deps);
    expect(JSON.parse(writer.text)).toEqual([]);
  });
});

describe('prices raise and cut', () => {
  it('moves every tier and prints both sides', async () => {
    const { deps, writer } = setup();
    await run(['prices', 'raise', '0.1000', '--from', '2026-06-01'], deps);
    expect(writer.text).toMatch(/1 schedules moved, effective 2026-06-01/);
    expect(writer.text).toMatch(/\$3\.4990 \$2\.9990 -> \$3\.5990 \$3\.0990/);
  });

  it('takes a cut', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'prices', 'cut', '0.0500', '--from', '2026-06-01'], deps);
    const result = JSON.parse(writer.text) as { changed: { newTiers: number[] }[] };
    expect(result.changed[0]?.newTiers).toEqual([34_490, 29_490]);
  });

  it('defaults to a week out', async () => {
    const { deps, writer } = setup();
    await run(['--json', 'prices', 'raise', '0.1000'], deps);
    expect((JSON.parse(writer.text) as { effectiveFrom: string }).effectiveFrom).toBe('2026-05-21');
  });

  it('changes nothing on a dry run', async () => {
    const { scenario, deps, writer } = setup();
    await run(['prices', 'raise', '0.1000', '--from', '2026-06-01', '--dry-run'], deps);
    expect(writer.text).toMatch(/\$0\.1000 on every tier from 2026-06-01 \(dry run\)/);
    expect(scenario.context.pricing.listSchedules()).toHaveLength(1);
  });

  it('shows what a year of it would be worth', async () => {
    const { scenario, deps, writer } = setup();
    scenario.fill('2025-12-01', 400, { meterTemperature: 60 });
    await run(['prices', 'raise', '0.1000', '--dry-run'], deps);
    expect(writer.text).toMatch(/class\s+gallons last season\s+a year of it/);
    expect(writer.text).toMatch(/agricultural/);
  });

  it('refuses a backdated move', async () => {
    const { deps, writer } = setup();
    const result = await run(['prices', 'raise', '0.1000', '--from', '2026-01-01'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/cannot be backdated/);
  });

  it('can be narrowed to a class', async () => {
    const { deps, writer } = setup();
    await run(
      ['--json', 'prices', 'raise', '0.1000', '--from', '2026-06-01', '--class', 'residential'],
      deps,
    );
    const result = JSON.parse(writer.text) as { changed: unknown[]; skipped: unknown[] };
    expect(result.changed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});
