import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { Db } from '../../../src/db/connection';
import { TankRepository } from '../../../src/db/repo/tank-repo';
import { aCustomer, aTank } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function setup(): { db: Db; tanks: TankRepository; customerId: string } {
  const db = testDatabase();
  const customers = new CustomerRepository(db);
  const customer = aCustomer();
  customers.insert(customer);
  return { db, tanks: new TankRepository(db), customerId: customer.id };
}

describe('insert and read back', () => {
  it('round trips every field including the appliance list', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId, {
      appliances: ['furnace', 'generator', 'shop_heater'],
      monitorId: 'WT-4471',
      lastLeakCheckOn: '2023-04-11',
      notes: 'gate code 4412',
      setting: 'underground',
    });
    tanks.insert(tank);
    expect(tanks.get(tank.id)).toEqual(tank);
  });

  it('handles a tank with no appliances listed', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId, { appliances: [] });
    tanks.insert(tank);
    expect(tanks.get(tank.id).appliances).toEqual([]);
  });

  it('refuses a tank against an account that is not there', () => {
    const { tanks } = setup();
    expect(() => tanks.insert(aTank('c-nope'))).toThrowError();
  });

  it('refuses a repeated serial number', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId);
    tanks.insert(tank);
    expect(() => tanks.insert({ ...tank, id: 't-other' })).toThrowError(/serial .* already exists/);
  });

  it('refuses a monitor that is already on another tank', () => {
    const { tanks, customerId } = setup();
    tanks.insert(aTank(customerId, { monitorId: 'WT-1' }));
    expect(() => tanks.insert(aTank(customerId, { monitorId: 'WT-1' }))).toThrowError(
      /already on another tank/,
    );
  });

  it('allows any number of tanks with no monitor at all', () => {
    const { tanks, customerId } = setup();
    tanks.insert(aTank(customerId));
    tanks.insert(aTank(customerId));
    expect(tanks.list({ customerId })).toHaveLength(2);
  });

  it('throws for a tank it does not hold', () => {
    expect(() => setup().tanks.get('t-nope')).toThrowError(/no tank with id t-nope/);
  });
});

describe('lookups', () => {
  it('finds by serial and by monitor', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId, { monitorId: 'WT-9' });
    tanks.insert(tank);
    expect(tanks.findBySerial(tank.serialNumber)?.id).toBe(tank.id);
    expect(tanks.findByMonitor('WT-9')?.id).toBe(tank.id);
    expect(tanks.findByMonitor('WT-8')).toBeUndefined();
  });
});

describe('list', () => {
  function seeded() {
    const { tanks, customerId } = setup();
    tanks.insert(aTank(customerId, { waterCapacity: 250 }));
    tanks.insert(aTank(customerId, { waterCapacity: 1000, monitorId: 'WT-2' }));
    tanks.insert(aTank(customerId, { owner: 'customer', removedOn: '2024-03-01' }));
    return { tanks, customerId };
  }

  it('filters by customer', () => {
    const { tanks, customerId } = seeded();
    expect(tanks.list({ customerId })).toHaveLength(3);
    expect(tanks.list({ customerId: 'c-other' })).toHaveLength(0);
  });

  it('leaves out tanks that have come out', () => {
    expect(seeded().tanks.list({ inServiceOnly: true })).toHaveLength(2);
  });

  it('finds only the monitored ones', () => {
    expect(seeded().tanks.list({ monitoredOnly: true })).toHaveLength(1);
  });

  it('filters by owner', () => {
    expect(seeded().tanks.list({ owner: 'customer' })).toHaveLength(1);
  });

  it('filters by size', () => {
    expect(seeded().tanks.list({ minimumCapacity: 500 })).toHaveLength(2);
  });
});

describe('changes over a tank life', () => {
  it('reassigns to another account', () => {
    const { db, tanks, customerId } = setup();
    const other = aCustomer();
    new CustomerRepository(db).insert(other);
    const tank = aTank(customerId);
    tanks.insert(tank);
    tanks.reassign(tank.id, other.id);
    expect(tanks.get(tank.id).customerId).toBe(other.id);
  });

  it('records a leak check', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId);
    tanks.insert(tank);
    tanks.recordLeakCheck(tank.id, dayKey('2025-06-02'));
    expect(tanks.get(tank.id).lastLeakCheckOn).toBe('2025-06-02');
  });

  it('frees the monitor when the tank comes out', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId, { monitorId: 'WT-3' });
    tanks.insert(tank);
    tanks.remove(tank.id, dayKey('2025-05-01'));
    const back = tanks.get(tank.id);
    expect(back.removedOn).toBe('2025-05-01');
    expect(back.monitorId).toBeUndefined();
    expect(() => tanks.insert(aTank(customerId, { monitorId: 'WT-3' }))).not.toThrow();
  });

  it('refuses to pull a tank before it went in', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId);
    tanks.insert(tank);
    expect(() => tanks.remove(tank.id, dayKey('2018-01-01'))).toThrowError(/before it went in/);
  });

  it('refuses to touch a tank that is not there', () => {
    const { tanks } = setup();
    expect(() => tanks.reassign('t-nope', 'c-1')).toThrowError(/no tank with id/);
    expect(() => tanks.recordLeakCheck('t-nope', dayKey('2025-01-01'))).toThrowError(/no tank/);
    expect(() => tanks.update(aTank('c-1'))).toThrowError(/no tank/);
  });

  it('deletes and says whether there was anything to delete', () => {
    const { tanks, customerId } = setup();
    const tank = aTank(customerId);
    tanks.insert(tank);
    expect(tanks.delete(tank.id)).toBe(true);
    expect(tanks.delete(tank.id)).toBe(false);
  });

  it('will not let an account go while a tank still points at it', () => {
    const { db, tanks, customerId } = setup();
    tanks.insert(aTank(customerId));
    expect(() => new CustomerRepository(db).delete(customerId)).toThrowError();
  });
});
