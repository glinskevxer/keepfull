import { afterEach, describe, expect, it } from 'vitest';
import { ConversionService } from '../../../src/service/conversions';
import { buildScenario, seedCleanHistory } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function setup(mode: 'will_call' | 'keep_full' = 'will_call') {
  const scenario = buildScenario({ today: '2025-02-10' });
  scenario.context.customers.update({ ...scenario.customer, deliveryMode: mode });
  return { scenario, service: new ConversionService(scenario.context) };
}

describe('candidates', () => {
  it('ignores an account that is already keep full', () => {
    const { scenario, service } = setup('keep_full');
    seedCleanHistory(scenario);
    expect(service.candidates()).toEqual([]);
  });

  it('ignores an account with too little history to judge', () => {
    const { scenario, service } = setup();
    scenario.fill('2025-01-01', 200);
    expect(service.candidates()).toEqual([]);
  });

  it('picks up a will call account with enough fills', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    const candidates = service.candidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.fills).toBe(6);
    expect(candidates[0]?.accountNumber).toBe(scenario.customer.accountNumber);
  });

  it('counts run outs and scores them heavily', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.fill('2025-01-20', 380, { gaugeBefore: 3 });
    const candidate = service.candidates()[0];
    expect(candidate?.runOuts).toBe(1);
    expect(candidate?.score).toBeGreaterThan(10);
    expect(candidate?.reasons).toContain('1 run outs');
  });

  it('counts emergency fills', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.fill('2025-01-20', 200, { reason: 'emergency', gaugeBefore: 12 });
    const candidate = service.candidates()[0];
    expect(candidate?.emergencyFills).toBe(1);
    expect(candidate?.reasons).toContain('1 emergency fills');
  });

  it('reports the gauge the customer calls at', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    expect(service.candidates()[0]?.meanCallGauge).toBe(20);
  });

  it('scores an account nobody can forecast at zero', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    scenario.context.customers.update({ ...scenario.customer, deliveryMode: 'will_call' });
    for (const day of ['2025-01-02', '2025-01-04', '2025-01-06']) {
      scenario.fill(day, 100, { gaugeBefore: 2 });
    }
    const service = new ConversionService(scenario.context);
    const candidate = service.candidates()[0];
    expect(candidate?.forecastable).toBe(false);
    expect(candidate?.score).toBe(0);
    expect(candidate?.reasons).toContain('not enough clean history to forecast yet');
  });

  it('stays inside the window it was given', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    expect(service.candidates({ from: dayKey('2025-01-15'), to: dayKey('2025-02-10') })).toEqual(
      [],
    );
  });

  it('puts the worst served first', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    const second = scenario.addTank();
    seedCleanHistory(scenario, second.id);
    scenario.fillTank(second.id, '2025-01-20', 380, { gaugeBefore: 2 });
    const candidates = service.candidates();
    expect(candidates[0]?.tankId).toBe(second.id);
  });
});

describe('worthCalling', () => {
  it('leaves out the ones scoring nothing', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    expect(service.worthCalling()).toEqual([]);
  });

  it('includes one with a run out behind it', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.fill('2025-01-20', 380, { gaugeBefore: 3 });
    expect(service.worthCalling()).toHaveLength(1);
  });

  it('caps the list', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.fill('2025-01-20', 380, { gaugeBefore: 3 });
    const second = scenario.addTank();
    seedCleanHistory(scenario, second.id);
    scenario.fillTank(second.id, '2025-01-21', 380, { gaugeBefore: 2 });
    expect(service.worthCalling({ limit: 1 })).toHaveLength(1);
  });
});
