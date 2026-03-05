import { afterEach, describe, expect, it } from 'vitest';
import { SizingService } from '../../../src/service/sizing';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { fahrenheit, percent } from '../../../src/core/units';

afterEach(closeTestDatabases);

function setup(appliances: string[] = ['furnace', 'water_heater'], waterCapacity = 500) {
  const scenario = buildScenario({ today: '2026-01-10', waterCapacity });
  scenario.context.tanks.update({
    ...scenario.context.tanks.get(scenario.tank.id),
    appliances: appliances as never,
  });
  return { scenario, service: new SizingService(scenario.context) };
}

describe('forTank', () => {
  it('passes a house on a five hundred', () => {
    const { scenario, service } = setup();
    const verdict = service.forTank(scenario.tank.id);
    expect(verdict.undersized).toBe(false);
    expect(verdict.load.largest).toBe('furnace');
    expect(verdict.recommendedCapacity).toBeLessThanOrEqual(500);
  });

  it('fails a grain dryer on a five hundred', () => {
    const { scenario, service } = setup(['grain_dryer']);
    const verdict = service.forTank(scenario.tank.id);
    expect(verdict.undersized).toBe(true);
    expect(verdict.check.headroom).toBeLessThan(0);
  });

  it('says how many gallons an hour the load pulls', () => {
    const { scenario, service } = setup(['furnace']);
    expect(service.forTank(scenario.tank.id).gallonsPerHour).toBeCloseTo(1.09, 2);
  });

  it('is content about a tank with nothing on it', () => {
    const { scenario, service } = setup([]);
    const verdict = service.forTank(scenario.tank.id);
    expect(verdict.undersized).toBe(false);
    expect(verdict.recommendedCapacity).toBeUndefined();
    expect(verdict.check.demandBtuPerHour).toBe(0);
  });

  it('is harsher on a colder design day', () => {
    const { scenario, service } = setup(['boiler', 'shop_heater']);
    const mild = service.forTank(scenario.tank.id, { ambient: fahrenheit(40) });
    const cold = service.forTank(scenario.tank.id, { ambient: fahrenheit(-20) });
    expect(cold.check.headroom).toBeLessThan(mild.check.headroom);
  });

  it('is harsher when it has to hold up to a lower gauge', () => {
    const { scenario, service } = setup(['boiler', 'shop_heater']);
    const easy = service.forTank(scenario.tank.id, { downToGauge: percent(70) });
    const hard = service.forTank(scenario.tank.id, { downToGauge: percent(10) });
    expect(hard.check.headroom).toBeLessThan(easy.check.headroom);
  });

  it('refuses a tank it does not know', () => {
    const { service } = setup();
    expect(() => service.forTank('t-nope')).toThrowError(/no tank with id/);
  });
});

describe('forAppliances', () => {
  it('recommends a tank before anything is in the ground', () => {
    const { service } = setup();
    const result = service.forAppliances(['furnace', 'water_heater', 'range']);
    expect(result.recommendedCapacity).toBeGreaterThan(0);
    expect(result.load.appliances).toBe(3);
  });

  it('recommends nothing for nothing', () => {
    const { service } = setup();
    expect(service.forAppliances([]).recommendedCapacity).toBeUndefined();
  });

  it('recommends a bigger tank for a bigger load', () => {
    const { service } = setup();
    const small = service.forAppliances(['range']).recommendedCapacity as number;
    const large = service.forAppliances(['poultry_brooder']).recommendedCapacity as number;
    expect(large).toBeGreaterThan(small);
  });
});

describe('undersizedTanks', () => {
  it('finds the one that cannot keep up', () => {
    const { scenario, service } = setup(['grain_dryer']);
    const verdicts = service.undersizedTanks();
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.tankId).toBe(scenario.tank.id);
  });

  it('finds nothing when the book is sized right', () => {
    const { service } = setup(['furnace']);
    expect(service.undersizedTanks()).toEqual([]);
  });

  it('puts the worst first', () => {
    const { scenario, service } = setup(['grain_dryer']);
    const second = scenario.addTank({ appliances: ['poultry_brooder'], waterCapacity: 120 });
    const verdicts = service.undersizedTanks();
    expect(verdicts.map((entry) => entry.tankId)).toContain(second.id);
    expect(verdicts[0]!.check.headroom).toBeLessThanOrEqual(verdicts[1]!.check.headroom);
  });
});
