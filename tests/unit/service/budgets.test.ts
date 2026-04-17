import { afterEach, describe, expect, it } from 'vitest';
import { BudgetService } from '../../../src/service/budgets';
import { buildScenario, seedCleanHistory } from '../../support/scenario';
import { cents, parseMills } from '../../../src/util/money';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeSchedule } from '../../../src/core/pricing';

afterEach(closeTestDatabases);

function setup(today = '2026-07-15') {
  const scenario = buildScenario({
    today,
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
  return { scenario, service: new BudgetService(scenario.context) };
}

/** Two seasons of fills so a plan has something to be built on. */
function twoSeasons(scenario: ReturnType<typeof setup>['scenario']) {
  for (const day of ['2024-11-01', '2025-01-15', '2025-03-01']) {
    scenario.fill(day, 300, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
  }
  for (const day of ['2025-11-01', '2026-01-15', '2026-03-01']) {
    scenario.fill(day, 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
  }
}

describe('annualGallons', () => {
  it('averages the last two seasons when both are there', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    const result = service.annualGallons(scenario.customer.id, 2026);
    expect(result.gallons).toBe(1050);
    expect(result.basis).toBe('mean of the last two seasons');
  });

  it('uses last season alone when that is all there is', () => {
    const { scenario, service } = setup();
    for (const day of ['2025-11-01', '2026-01-15']) {
      scenario.fill(day, 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    }
    const result = service.annualGallons(scenario.customer.id, 2026);
    expect(result.gallons).toBe(800);
    expect(result.basis).toBe('last season');
  });

  it('falls back to the burn model when neither prior season has fills', () => {
    const { scenario, service } = setup();
    // These land in the 2024 season, so asking about 2027 finds nothing in
    // either of the two seasons before it and has to model instead.
    seedCleanHistory(scenario);
    const result = service.annualGallons(scenario.customer.id, 2027);
    expect(result.basis).toBe('burn model over a normal year');
    expect(result.gallons).toBeGreaterThan(0);
  });

  it('refuses an account with nothing behind it', () => {
    const { scenario, service } = setup();
    expect(() => service.annualGallons(scenario.customer.id, 2026)).toThrowError(
      /usable burn history/,
    );
  });
});

describe('create', () => {
  it('opens a plan off the account history', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    const plan = service.create({ customerId: scenario.customer.id });
    expect(plan.season).toBe(2026);
    expect(plan.forecastGallons).toBe(1050);
    expect(plan.instalments).toHaveLength(12);
    expect(plan.startOn).toBe('2026-07-01');
  });

  it('prices it off the posted schedule', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    const plan = service.create({ customerId: scenario.customer.id });
    expect(plan.pricePerGallon).toBe(parseMills('2.9990'));
  });

  it('takes an override price', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    const plan = service.create({
      customerId: scenario.customer.id,
      pricePerGallon: parseMills('2.5000'),
    });
    expect(plan.pricePerGallon).toBe(parseMills('2.5000'));
  });

  it('rolls an opening balance in', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    const plain = service.create({ customerId: scenario.customer.id });
    const scenario2 = setup();
    twoSeasons(scenario2.scenario);
    const owing = scenario2.service.create({
      customerId: scenario2.scenario.customer.id,
      openingBalance: cents(30_000),
    });
    expect(owing.total).toBe(plain.total + 30_000);
  });

  it('says so in the log', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    service.create({ customerId: scenario.customer.id });
    expect(scenario.sink.messages()).toContain('opened a budget plan');
  });

  it('refuses a second plan for the season', () => {
    const { scenario, service } = setup();
    twoSeasons(scenario);
    service.create({ customerId: scenario.customer.id });
    expect(() => service.create({ customerId: scenario.customer.id })).toThrowError(
      /already has a 2026 plan/,
    );
  });
});

describe('health', () => {
  function withPlan() {
    const context = setup();
    twoSeasons(context.scenario);
    const plan = context.service.create({ customerId: context.scenario.customer.id });
    return { ...context, plan };
  }

  it('is content on a plan that has burned nothing yet', () => {
    const { service, plan } = withPlan();
    const health = service.health(plan.id);
    expect(health.gallonsBurned).toBe(0);
    expect(health.runningShort).toBe(false);
  });

  it('counts the payments made and due', () => {
    const { scenario, service, plan } = withPlan();
    scenario.context.budgets.recordPayment(plan.id, 1, dayKey('2026-07-02'), cents(30_000));
    const health = service.health(plan.id, dayKey('2026-08-15'));
    expect(health.paymentsMade).toBe(1);
    expect(health.paymentsDue).toBe(2);
  });

  it('flags a plan burning faster than it is paying', () => {
    const { scenario, service, plan } = withPlan();
    scenario.fill('2026-12-01', 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    scenario.fill('2027-01-01', 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    const health = service.health(plan.id, dayKey('2027-01-15'));
    expect(health.gallonsBurned).toBe(800);
    expect(health.runningShort).toBe(true);
  });

  it('projects what the settlement will come to', () => {
    const { service, plan } = withPlan();
    expect(service.health(plan.id).projectedSettlement).toBeLessThanOrEqual(0);
  });
});

describe('settle and atRisk', () => {
  function withPlan() {
    const context = setup();
    twoSeasons(context.scenario);
    const plan = context.service.create({ customerId: context.scenario.customer.id });
    return { ...context, plan };
  }

  it('closes the plan out', () => {
    const { service, plan } = withPlan();
    const result = service.settle(plan.id, dayKey('2027-06-30'));
    expect(result.plan.status).toBe('settled');
    expect(result.plan.settledOn).toBe('2027-06-30');
  });

  it('refuses to settle twice', () => {
    const { service, plan } = withPlan();
    service.settle(plan.id, dayKey('2027-06-30'));
    expect(() => service.settle(plan.id, dayKey('2027-07-01'))).toThrowError(/already settled/);
  });

  it('says so in the log', () => {
    const { scenario, service, plan } = withPlan();
    service.settle(plan.id, dayKey('2027-06-30'));
    expect(scenario.sink.messages()).toContain('settled a budget plan');
  });

  it('finds nothing at risk on a quiet book', () => {
    const { service } = withPlan();
    expect(service.atRisk()).toEqual([]);
  });

  it('finds a plan running short', () => {
    const { scenario, service, plan } = withPlan();
    scenario.fill('2026-12-01', 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    scenario.fill('2027-01-01', 400, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    const risky = service.atRisk(dayKey('2027-01-15'));
    expect(risky.map((entry) => entry.planId)).toEqual([plan.id]);
  });
});
