import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { ReadingRepository } from '../../../src/db/repo/reading-repo';
import { TankRepository } from '../../../src/db/repo/tank-repo';
import { aCustomer, aReading, aTank } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const customer = aCustomer();
  new CustomerRepository(db).insert(customer);
  const tanks = new TankRepository(db);
  const tank = aTank(customer.id);
  tanks.insert(tank);
  return { db, tanks, readings: new ReadingRepository(db), customer, tank };
}

describe('record', () => {
  it('round trips a reading', () => {
    const { readings, tank } = setup();
    const reading = aReading(tank.id, {
      source: 'monitor',
      monitorId: 'WT-1',
      note: 'battery low',
    });
    readings.record(reading);
    expect(readings.get(reading.id)).toEqual(reading);
  });

  it('collapses repeated pings from one monitor on one day', () => {
    const { readings, tank } = setup();
    readings.record(aReading(tank.id, { source: 'monitor', monitorId: 'WT-1', gauge: 44 }));
    readings.record(aReading(tank.id, { source: 'monitor', monitorId: 'WT-1', gauge: 41 }));
    const rows = readings.list({ tankId: tank.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gauge).toBe(41);
  });

  it('keeps readings from different sources on the same day apart', () => {
    const { readings, tank } = setup();
    readings.record(aReading(tank.id, { source: 'driver', gauge: 40 }));
    readings.record(aReading(tank.id, { source: 'customer', gauge: 50 }));
    expect(readings.list({ tankId: tank.id })).toHaveLength(2);
  });

  it('writes a batch in one go', () => {
    const { readings, tank } = setup();
    expect(
      readings.recordMany([
        aReading(tank.id, { takenOn: '2025-01-09' }),
        aReading(tank.id, { takenOn: '2025-01-10' }),
      ]),
    ).toBe(2);
    expect(readings.count()).toBe(2);
  });

  it('refuses a reading for a tank that is not there', () => {
    expect(() => setup().readings.record(aReading('t-nope'))).toThrowError();
  });

  it('throws for a reading it does not hold', () => {
    expect(() => setup().readings.get('r-nope')).toThrowError(/no reading with id/);
  });
});

describe('list', () => {
  function seeded() {
    const context = setup();
    const { readings, tank } = context;
    readings.record(aReading(tank.id, { takenOn: '2025-01-05', gauge: 60 }));
    readings.record(aReading(tank.id, { takenOn: '2025-01-08', source: 'customer', gauge: 50 }));
    readings.record(
      aReading(tank.id, { takenOn: '2025-01-10', source: 'monitor', monitorId: 'WT-1', gauge: 42 }),
    );
    readings.record(aReading(tank.id, { takenOn: '2025-01-10', source: 'estimated', gauge: 39 }));
    return context;
  }

  it('returns newest first', () => {
    expect(seeded().readings.list()[0]?.takenOn).toBe('2025-01-10');
  });

  it('filters by source', () => {
    expect(seeded().readings.list({ source: 'customer' })).toHaveLength(1);
  });

  it('filters by day range', () => {
    expect(
      seeded().readings.list({ from: dayKey('2025-01-08'), to: dayKey('2025-01-09') }),
    ).toHaveLength(1);
  });

  it('leaves out the estimates', () => {
    expect(seeded().readings.list({ measuredOnly: true })).toHaveLength(3);
  });

  it('caps the row count', () => {
    expect(seeded().readings.list({ limit: 2 })).toHaveLength(2);
  });

  it('counts without a cap', () => {
    expect(seeded().readings.count()).toBe(4);
  });
});

describe('latestFor', () => {
  it('prefers the better source on the latest day', () => {
    const { readings, tank } = setup();
    readings.record(aReading(tank.id, { takenOn: '2025-01-10', source: 'customer', gauge: 50 }));
    readings.record(
      aReading(tank.id, { takenOn: '2025-01-10', source: 'monitor', monitorId: 'WT-1', gauge: 42 }),
    );
    expect(readings.latestFor(tank.id)?.gauge).toBe(42);
  });

  it('can be told to ignore the estimates', () => {
    const { readings, tank } = setup();
    readings.record(aReading(tank.id, { takenOn: '2025-01-08', source: 'driver', gauge: 55 }));
    readings.record(aReading(tank.id, { takenOn: '2025-01-12', source: 'estimated', gauge: 30 }));
    expect(readings.latestFor(tank.id)?.gauge).toBe(30);
    expect(readings.latestFor(tank.id, { measuredOnly: true })?.gauge).toBe(55);
  });

  it('can be asked as of an earlier day', () => {
    const { readings, tank } = setup();
    readings.record(aReading(tank.id, { takenOn: '2025-01-08', gauge: 55 }));
    readings.record(aReading(tank.id, { takenOn: '2025-01-12', gauge: 30 }));
    expect(readings.latestFor(tank.id, { asOf: dayKey('2025-01-10') })?.gauge).toBe(55);
  });

  it('has nothing to say about a tank with no readings', () => {
    expect(setup().readings.latestFor('t-nope')).toBeUndefined();
  });
});

describe('housekeeping', () => {
  it('clears the estimates for one tank only', () => {
    const { db, readings, customer } = setup();
    const tanks = new TankRepository(db);
    const other = aTank(customer.id);
    tanks.insert(other);
    const first = tanks.list()[0];
    readings.record(aReading(first?.id as string, { source: 'estimated' }));
    readings.record(aReading(other.id, { source: 'estimated' }));
    expect(readings.clearEstimates(first?.id as string)).toBe(1);
    expect(readings.count()).toBe(1);
  });

  it('purges everything before a cutoff', () => {
    const { readings, tank } = setup();
    readings.record(aReading(tank.id, { takenOn: '2023-01-01' }));
    readings.record(aReading(tank.id, { takenOn: '2025-01-01' }));
    expect(readings.purgeBefore(dayKey('2024-01-01'))).toBe(1);
    expect(readings.count()).toBe(1);
  });

  it('refuses a purge with no cutoff', () => {
    expect(() => setup().readings.purgeBefore('' as never)).toThrowError(/needs a cutoff day/);
  });

  it('deletes one and says whether there was anything to delete', () => {
    const { readings, tank } = setup();
    const reading = aReading(tank.id);
    readings.record(reading);
    expect(readings.delete(reading.id)).toBe(true);
    expect(readings.delete(reading.id)).toBe(false);
  });

  it('takes the readings with the tank', () => {
    const { readings, tanks, tank } = setup();
    readings.record(aReading(tank.id));
    tanks.delete(tank.id);
    expect(readings.count()).toBe(0);
  });
});
