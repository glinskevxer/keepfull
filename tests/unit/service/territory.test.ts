import { afterEach, describe, expect, it } from 'vitest';
import { TerritoryService } from '../../../src/service/territory';
import { aCustomer } from '../../support/fixtures';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { makeStation } from '../../../src/model/station';

afterEach(closeTestDatabases);

/** A second station south of the first, low down in the valley. */
const elmira = makeStation({
  id: 'KELM',
  name: 'Elmira Corning Regional',
  latitude: 42.1599,
  longitude: -76.8916,
  elevationFeet: 954,
});

function setup(withSecondStation = true) {
  const scenario = buildScenario({ today: '2026-02-01' });
  if (withSecondStation) {
    scenario.context.weather.saveStation(elmira);
  }
  return { scenario, service: new TerritoryService(scenario.context) };
}

describe('rank', () => {
  it('puts the nearest station first', () => {
    const { scenario, service } = setup();
    const ranked = service.rank(scenario.customer.id);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.stationId).toBe('KITH');
    expect(ranked[0]!.effectiveMiles).toBeLessThan(ranked[1]!.effectiveMiles);
  });

  it('reports real miles alongside the effective ones', () => {
    const { scenario, service } = setup();
    const nearest = service.nearest(scenario.customer.id);
    expect(nearest.miles).toBeGreaterThan(0);
    expect(nearest.effectiveMiles).toBeGreaterThanOrEqual(nearest.miles);
  });

  it('penalises a station at a different elevation', () => {
    const { scenario, service } = setup();
    const ranked = service.rank(scenario.customer.id);
    const elm = ranked.find((choice) => choice.stationId === 'KELM');
    expect(elm?.elevationDifference).toBe(145);
    expect(elm!.effectiveMiles).toBeGreaterThan(elm!.miles);
  });

  it('refuses an account we do not have', () => {
    const { service } = setup();
    expect(() => service.rank('c-nope')).toThrowError(/no customer with id/);
  });

  it('refuses when no station is active', () => {
    const { scenario, service } = setup(false);
    scenario.context.weather.saveStation({
      ...scenario.context.weather.getStation('KITH'),
      active: false,
    });
    expect(() => service.rank(scenario.customer.id)).toThrowError(/no active station/);
  });
});

describe('misassigned', () => {
  it('finds nothing when there is only one station', () => {
    const { service } = setup(false);
    expect(service.misassigned()).toEqual([]);
  });

  it('finds nothing when everybody is on their nearest', () => {
    const { service } = setup();
    expect(service.misassigned()).toEqual([]);
  });

  it('finds an account pointed the wrong way', () => {
    const { scenario, service } = setup();
    const stray = aCustomer({ stationId: 'KELM' });
    scenario.context.customers.insert(stray);
    const found = service.misassigned();
    expect(found).toHaveLength(1);
    expect(found[0]?.current.stationId).toBe('KELM');
    expect(found[0]?.nearest.stationId).toBe('KITH');
    expect(found[0]?.milesSaved).toBeGreaterThan(3);
  });

  it('leaves a marginal one alone', () => {
    const { scenario, service } = setup();
    scenario.context.customers.insert(aCustomer({ stationId: 'KELM' }));
    expect(service.misassigned(500)).toEqual([]);
  });

  it('puts the worst first', () => {
    const { scenario, service } = setup();
    scenario.context.customers.insert(aCustomer({ stationId: 'KELM' }));
    scenario.context.customers.insert(
      aCustomer({
        stationId: 'KELM',
        address: {
          line1: '1 Far Rd',
          town: 'Dryden',
          county: 'Tompkins',
          postalCode: '13053',
          latitude: 42.4948,
          longitude: -76.2971,
        },
      }),
    );
    const found = service.misassigned();
    expect(found).toHaveLength(2);
    expect(found[0]!.milesSaved).toBeGreaterThanOrEqual(found[1]!.milesSaved);
  });

  it('ignores a closed account', () => {
    const { scenario, service } = setup();
    const stray = aCustomer({ stationId: 'KELM', closedOn: '2025-01-01' });
    scenario.context.customers.insert(stray);
    expect(service.misassigned()).toEqual([]);
  });
});

describe('reassignAll', () => {
  it('moves them and says how many', () => {
    const { scenario, service } = setup();
    const stray = aCustomer({ stationId: 'KELM' });
    scenario.context.customers.insert(stray);
    const result = service.reassignAll();
    expect(result.moved).toBe(1);
    expect(result.accounts).toEqual([stray.accountNumber]);
    expect(scenario.context.customers.get(stray.id).stationId).toBe('KITH');
  });

  it('is a no op the second time', () => {
    const { scenario, service } = setup();
    scenario.context.customers.insert(aCustomer({ stationId: 'KELM' }));
    service.reassignAll();
    expect(service.reassignAll().moved).toBe(0);
  });

  it('says so in the log when it moved something', () => {
    const { scenario, service } = setup();
    scenario.context.customers.insert(aCustomer({ stationId: 'KELM' }));
    service.reassignAll();
    expect(scenario.sink.messages()).toContain('reassigned accounts to nearer stations');
  });
});

describe('coverage', () => {
  it('counts the book per station', () => {
    const { scenario, service } = setup();
    scenario.context.customers.insert(aCustomer({ stationId: 'KELM' }));
    const coverage = service.coverage();
    expect(coverage.find((row) => row.stationId === 'KITH')?.accounts).toBe(1);
    expect(coverage.find((row) => row.stationId === 'KELM')?.accounts).toBe(1);
  });

  it('includes a station with nothing on it', () => {
    const { service } = setup();
    expect(service.coverage().find((row) => row.stationId === 'KELM')?.accounts).toBe(0);
  });
});
