import { afterEach, describe, expect, it } from 'vitest';
import { FleetRepository } from '../../../src/db/repo/fleet-repo';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';

afterEach(closeTestDatabases);

function repo(): FleetRepository {
  return new FleetRepository(testDatabase());
}

const bobtail = makeTruck({
  id: 'b-4',
  unitNumber: 'B-4',
  waterCapacity: 3000,
  meterSealedOn: '2025-03-04',
});

const transport = makeTruck({
  id: 't-1',
  unitNumber: 'T-1',
  kind: 'transport',
  waterCapacity: 11500,
  heelGallons: 0,
  active: false,
});

const vandemark = makeDriver({
  id: 'drv-3',
  name: 'R Vandemark',
  licenceNumber: 'NY-882-441',
  endorsements: ['hazmat', 'tanker'],
  medicalCardExpiresOn: '2026-02-01',
});

const olney = makeDriver({ id: 'drv-4', name: 'A Olney', licenceNumber: 'NY-114-902' });

describe('trucks', () => {
  it('round trips', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    expect(fleet.getTruck('b-4')).toEqual(bobtail);
  });

  it('updates on a second save', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    fleet.saveTruck({ ...bobtail, heelGallons: 75 });
    expect(fleet.getTruck('b-4').heelGallons).toBe(75);
    expect(fleet.listTrucks()).toHaveLength(1);
  });

  it('refuses two trucks with one unit number', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    expect(() => fleet.saveTruck({ ...bobtail, id: 'b-9' })).toThrowError(/already on another/);
  });

  it('finds by unit number', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    expect(fleet.findTruckByUnit('B-4')?.id).toBe('b-4');
    expect(fleet.findTruckByUnit('B-9')).toBeUndefined();
  });

  it('throws for one it does not hold', () => {
    expect(() => repo().getTruck('b-9')).toThrowError(/no truck with id b-9/);
  });

  it('lists, filters and orders by unit', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    fleet.saveTruck(transport);
    expect(fleet.listTrucks().map((t) => t.unitNumber)).toEqual(['B-4', 'T-1']);
    expect(fleet.listTrucks({ activeOnly: true })).toHaveLength(1);
    expect(fleet.listTrucks({ kind: 'transport' })).toHaveLength(1);
  });

  it('records a new meter seal', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    fleet.recordMeterSeal('b-4', dayKey('2026-03-02'));
    expect(fleet.getTruck('b-4').meterSealedOn).toBe('2026-03-02');
  });

  it('retires one', () => {
    const fleet = repo();
    fleet.saveTruck(bobtail);
    fleet.retireTruck('b-4');
    expect(fleet.getTruck('b-4').active).toBe(false);
  });

  it('refuses to touch a truck that is not there', () => {
    const fleet = repo();
    expect(() => fleet.recordMeterSeal('b-9', dayKey('2026-01-01'))).toThrowError(/no truck/);
    expect(() => fleet.retireTruck('b-9')).toThrowError(/no truck/);
  });
});

describe('drivers', () => {
  it('round trips including the endorsements', () => {
    const fleet = repo();
    fleet.saveDriver(vandemark);
    expect(fleet.getDriver('drv-3')).toEqual(vandemark);
  });

  it('handles a driver with no endorsements and no card', () => {
    const fleet = repo();
    fleet.saveDriver(olney);
    const back = fleet.getDriver('drv-4');
    expect(back.endorsements).toEqual([]);
    expect(back.medicalCardExpiresOn).toBeUndefined();
  });

  it('refuses a repeated licence number', () => {
    const fleet = repo();
    fleet.saveDriver(vandemark);
    expect(() => fleet.saveDriver({ ...vandemark, id: 'drv-9' })).toThrowError(/already on file/);
  });

  it('lists in name order and can skip the retired', () => {
    const fleet = repo();
    fleet.saveDriver(vandemark);
    fleet.saveDriver({ ...olney, active: false });
    expect(fleet.listDrivers().map((d) => d.name)).toEqual(['A Olney', 'R Vandemark']);
    expect(fleet.listDrivers({ activeOnly: true })).toHaveLength(1);
  });

  it('retires one', () => {
    const fleet = repo();
    fleet.saveDriver(vandemark);
    fleet.retireDriver('drv-3');
    expect(fleet.getDriver('drv-3').active).toBe(false);
  });

  it('throws for one it does not hold', () => {
    const fleet = repo();
    expect(() => fleet.getDriver('drv-9')).toThrowError(/no driver with id/);
    expect(() => fleet.retireDriver('drv-9')).toThrowError(/no driver/);
    expect(fleet.findDriver('drv-9')).toBeUndefined();
  });
});
