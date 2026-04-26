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
  const scenario = buildScenario({
    today: '2026-07-15',
    weatherFrom: '2023-07-01',
    weatherTo: '2026-08-01',
  });
  scenario.context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-1',
      rateClass: 'agricultural',
      effectiveFrom: dayKey('2023-01-01'),
      tiers: [{ fromGallons: 0, pricePerGallon: parseMills('2.9990') }],
    }),
  );
  for (const day of ['2024-11-01', '2025-01-15']) {
    scenario.fill(day, 300, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
  }
  for (const day of ['2025-11-01', '2026-01-15']) {
    scenario.fill(day, 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
  }
  return { scenario, ...cliDeps(scenario) };
}

describe('budgets open', () => {
  it('opens a plan and prints the terms', async () => {
    const { scenario, deps, writer } = setup();
    const result = await run(['budgets', 'open', scenario.customer.id], deps);
    expect(result.code).toBe(0);
    expect(writer.text).toMatch(/season 2026  starting 2026-07-01/);
    expect(writer.text).toMatch(/11 payments of \$[\d,]+\.\d\d then a true up/);
  });

  it('takes an opening balance', async () => {
    const { scenario, deps, writer } = setup();
    await run(['--json', 'budgets', 'open', scenario.customer.id, '--balance', '300.00'], deps);
    const plan = JSON.parse(writer.text) as { openingBalance: number };
    expect(plan.openingBalance).toBe(30_000);
  });

  it('takes a price override', async () => {
    const { scenario, deps, writer } = setup();
    await run(['--json', 'budgets', 'open', scenario.customer.id, '--price', '2.5000'], deps);
    const plan = JSON.parse(writer.text) as { pricePerGallon: number };
    expect(plan.pricePerGallon).toBe(25_000);
  });

  it('refuses a second plan for the season', async () => {
    const { scenario, deps, writer } = setup();
    await run(['budgets', 'open', scenario.customer.id], deps);
    const result = await run(['budgets', 'open', scenario.customer.id], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/already has a 2026 plan/);
  });

  it('refuses an account with nothing behind it', async () => {
    const scenario = buildScenario({ today: '2026-07-15' });
    const { deps, writer } = cliDeps(scenario);
    const result = await run(['budgets', 'open', scenario.customer.id], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/usable burn history/);
  });
});

describe('budgets show and pay', () => {
  async function withPlan() {
    const context = setup();
    await run(['--json', 'budgets', 'open', context.scenario.customer.id], context.deps);
    const planId = (JSON.parse(context.writer.text) as { id: string }).id;
    context.writer.stdout.length = 0;
    return { ...context, planId };
  }

  it('prints the schedule', async () => {
    const { deps, writer, planId } = await withPlan();
    await run(['budgets', 'show', planId], deps);
    expect(writer.text).toMatch(/#\s+due\s+amount\s+paid\s+true up/);
    expect(writer.text).toMatch(/2026-07-01/);
  });

  it('records a payment', async () => {
    const { deps, writer, planId } = await withPlan();
    await run(['budgets', 'pay', planId, '1', '250.00', '--on', '2026-07-02'], deps);
    expect(writer.text).toMatch(/payment 1 recorded on 2026-07-02, 1 of 11 paid/);
  });

  it('refuses to pay the same instalment twice', async () => {
    const { deps, writer, planId } = await withPlan();
    await run(['budgets', 'pay', planId, '1', '250.00'], deps);
    const result = await run(['budgets', 'pay', planId, '1', '250.00'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/already paid/);
  });

  it('settles the plan out', async () => {
    const { deps, writer, planId } = await withPlan();
    await run(['budgets', 'settle', planId, '--on', '2027-06-30'], deps);
    expect(writer.text).toMatch(/settled, (refund|the customer owes) \$/);
  });

  it('reports a plan we do not have', async () => {
    const { deps, writer } = setup();
    const result = await run(['budgets', 'show', 'bp-nope'], deps);
    expect(result.code).toBe(2);
    expect(writer.stderr.join('\n')).toMatch(/no budget plan with id/);
  });
});

describe('budgets at-risk', () => {
  it('says nothing on a quiet book', async () => {
    const { scenario, deps, writer } = setup();
    await run(['budgets', 'open', scenario.customer.id], deps);
    writer.stdout.length = 0;
    await run(['budgets', 'at-risk'], deps);
    expect(writer.text).toBe('(nothing)');
  });

  it('finds one burning faster than it is paying', async () => {
    const { scenario, deps, writer } = setup();
    await run(['budgets', 'open', scenario.customer.id], deps);
    scenario.fill('2026-12-01', 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    scenario.fill('2027-01-05', 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    writer.stdout.length = 0;
    await run(['budgets', 'at-risk', '--on', '2027-01-15'], deps);
    expect(writer.text).toMatch(/plan\s+account\s+burned\s+planned\s+paid\s+settlement/);
  });
});
