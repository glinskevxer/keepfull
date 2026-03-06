import { afterEach, describe, expect, it } from 'vitest';
import { FleetRepository } from '../../../src/db/repo/fleet-repo';
import { LoadRepository } from '../../../src/db/repo/load-repo';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';
import { makeTruckLoad } from '../../../src/model/truck-load';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const fleet = new FleetRepository(db);
  fleet.saveTruck(makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }));
  fleet.saveDriver(makeDriver({ id: 'drv-3', name: 'R Vandemark', licenceNumber: 'NY-1' }));
  return { loads: new LoadRepository(db) };
}

function aLoad(overrides: Record<string, unknown> = {}) {
  return makeTruckLoad({
    id: 'ld-1',
    truckId: 'b-4',
    driverId: 'drv-3',
    loadedOn: '2026-01-14',
    plantGross: 2400,
    plantTemperature: 40,
    meterStart: 184_220,
    ...overrides,
  } as never);
}

describe('insert and read back', () => {
  it('round trips', () => {
    const { loads } = setup();
    const load = aLoad();
    loads.insert(load);
    expect(loads.get('ld-1')).toEqual(load);
  });

  it('refuses two loads with the same sequence on one day', () => {
    const { loads } = setup();
    loads.insert(aLoad());
    expect(() => loads.insert(aLoad({ id: 'ld-2' }))).toThrowError(/already has load 1 on/);
  });

  it('allows a second load of the day', () => {
    const { loads } = setup();
    loads.insert(aLoad());
    loads.insert(aLoad({ id: 'ld-2', sequence: 2 }));
    expect(loads.list()).toHaveLength(2);
  });

  it('refuses a load against a truck we do not have', () => {
    const { loads } = setup();
    expect(() => loads.insert(aLoad({ truckId: 'b-nope' }))).toThrowError();
  });

  it('throws for one it does not hold', () => {
    expect(() => setup().loads.get('ld-9')).toThrowError(/no truck load with id/);
  });
});

describe('list', () => {
  function seeded() {
    const { loads } = setup();
    loads.insert(aLoad());
    loads.insert(aLoad({ id: 'ld-2', loadedOn: '2026-01-15', meterEnd: 186_500 }));
    return loads;
  }

  it('orders by day then truck then sequence', () => {
    expect(
      seeded()
        .list()
        .map((load) => load.id),
    ).toEqual(['ld-1', 'ld-2']);
  });

  it('filters by day range and truck', () => {
    const loads = seeded();
    expect(loads.list({ from: dayKey('2026-01-15') })).toHaveLength(1);
    expect(loads.list({ truckId: 'b-4' })).toHaveLength(2);
    expect(loads.list({ driverId: 'drv-3' })).toHaveLength(2);
  });

  it('finds the shifts still open', () => {
    expect(
      seeded()
        .list({ openOnly: true })
        .map((load) => load.id),
    ).toEqual(['ld-1']);
  });
});

describe('closeShift and nextSequence', () => {
  it('records the closing meter', () => {
    const { loads } = setup();
    loads.insert(aLoad());
    expect(loads.closeShift('ld-1', 186_500).meterEnd).toBe(186_500);
  });

  it('refuses a closing meter below the opening one', () => {
    const { loads } = setup();
    loads.insert(aLoad());
    expect(() => loads.closeShift('ld-1', 100)).toThrowError(/cannot run backwards/);
  });

  it('counts the loads of a day', () => {
    const { loads } = setup();
    expect(loads.nextSequence('b-4', dayKey('2026-01-14'))).toBe(1);
    loads.insert(aLoad());
    expect(loads.nextSequence('b-4', dayKey('2026-01-14'))).toBe(2);
    expect(loads.nextSequence('b-4', dayKey('2026-01-15'))).toBe(1);
  });

  it('deletes and says whether there was anything to delete', () => {
    const { loads } = setup();
    loads.insert(aLoad());
    expect(loads.delete('ld-1')).toBe(true);
    expect(loads.delete('ld-1')).toBe(false);
  });
});
