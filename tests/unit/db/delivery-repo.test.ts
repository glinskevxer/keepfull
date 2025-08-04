import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { DeliveryRepository } from '../../../src/db/repo/delivery-repo';
import { TankRepository } from '../../../src/db/repo/tank-repo';
import { aCustomer, aDelivery, aTank } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const customer = aCustomer();
  new CustomerRepository(db).insert(customer);
  const tank = aTank(customer.id);
  new TankRepository(db).insert(tank);
  return { db, deliveries: new DeliveryRepository(db), customer, tank };
}

describe('insert and read back', () => {
  it('round trips a ticket', () => {
    const { deliveries, customer, tank } = setup();
    const delivery = aDelivery(customer.id, tank.id, { notes: 'left on the porch' });
    deliveries.insert(delivery);
    expect(deliveries.get(delivery.id)).toEqual(delivery);
  });

  it('keeps the net gallons the ticket was billed on', () => {
    const { deliveries, customer, tank } = setup();
    const delivery = aDelivery(customer.id, tank.id);
    deliveries.insert(delivery);
    expect(deliveries.get(delivery.id).net).toBe(delivery.net);
  });

  it('handles a ticket with no gauge readings', () => {
    const { deliveries, customer, tank } = setup();
    const full = aDelivery(customer.id, tank.id);
    const { gaugeBefore: _b, gaugeAfter: _a, ...bare } = full;
    deliveries.insert(bare);
    const back = deliveries.get(bare.id);
    expect(back.gaugeBefore).toBeUndefined();
    expect(back.gaugeAfter).toBeUndefined();
  });

  it('refuses the same ticket number twice', () => {
    const { deliveries, customer, tank } = setup();
    const delivery = aDelivery(customer.id, tank.id);
    deliveries.insert(delivery);
    expect(() => deliveries.insert({ ...delivery, id: 'd-other' })).toThrowError(
      /already been posted/,
    );
  });

  it('refuses a ticket against a tank that is not there', () => {
    const { deliveries, customer } = setup();
    expect(() => deliveries.insert(aDelivery(customer.id, 't-nope'))).toThrowError();
  });

  it('finds one by its ticket number', () => {
    const { deliveries, customer, tank } = setup();
    const delivery = aDelivery(customer.id, tank.id);
    deliveries.insert(delivery);
    expect(deliveries.findByTicketNumber(delivery.ticketNumber)?.id).toBe(delivery.id);
    expect(deliveries.findByTicketNumber('00000019')).toBeUndefined();
  });

  it('throws for one it does not hold', () => {
    expect(() => setup().deliveries.get('d-nope')).toThrowError(/no delivery with id/);
  });
});

describe('insertMany', () => {
  it('writes a batch', () => {
    const { deliveries, customer, tank } = setup();
    const batch = [
      aDelivery(customer.id, tank.id, { deliveredOn: '2025-01-05' }),
      aDelivery(customer.id, tank.id, { deliveredOn: '2025-02-05' }),
    ];
    expect(deliveries.insertMany(batch)).toBe(2);
    expect(deliveries.list()).toHaveLength(2);
  });

  it('writes none of them when one is bad', () => {
    const { deliveries, customer, tank } = setup();
    const good = aDelivery(customer.id, tank.id);
    expect(() => deliveries.insertMany([good, { ...good, id: 'd-clash' }])).toThrowError();
    expect(deliveries.list()).toHaveLength(0);
  });
});

describe('list', () => {
  function seeded() {
    const context = setup();
    const { deliveries, customer, tank } = context;
    deliveries.insert(aDelivery(customer.id, tank.id, { deliveredOn: '2024-11-01' }));
    deliveries.insert(
      aDelivery(customer.id, tank.id, { deliveredOn: '2024-12-01', truckId: 'B-7' }),
    );
    deliveries.insert(
      aDelivery(customer.id, tank.id, { deliveredOn: '2025-01-05', status: 'void' }),
    );
    deliveries.insert(
      aDelivery(customer.id, tank.id, { deliveredOn: '2025-02-01', driverId: 'drv-9' }),
    );
    return context;
  }

  it('returns everything oldest first', () => {
    const rows = seeded().deliveries.list();
    expect(rows.map((row) => row.deliveredOn)).toEqual([
      '2024-11-01',
      '2024-12-01',
      '2025-01-05',
      '2025-02-01',
    ]);
  });

  it('filters by day range', () => {
    const rows = seeded().deliveries.list({ from: dayKey('2024-12-01'), to: dayKey('2025-01-05') });
    expect(rows).toHaveLength(2);
  });

  it('filters by truck and by driver', () => {
    const { deliveries } = seeded();
    expect(deliveries.list({ truckId: 'B-7' })).toHaveLength(1);
    expect(deliveries.list({ driverId: 'drv-9' })).toHaveLength(1);
  });

  it('leaves out the voided ones when asked', () => {
    expect(seeded().deliveries.list({ postedOnly: true })).toHaveLength(3);
  });

  it('caps the row count', () => {
    expect(seeded().deliveries.list({ limit: 2 })).toHaveLength(2);
  });

  it('gives the posted history for a tank', () => {
    const { deliveries, tank } = seeded();
    expect(deliveries.historyForTank(tank.id)).toHaveLength(3);
  });

  it('finds the most recent posted fill', () => {
    const { deliveries, tank } = seeded();
    expect(deliveries.lastDeliveryFor(tank.id)?.deliveredOn).toBe('2025-02-01');
  });

  it('has no last fill for a tank that has never been filled', () => {
    expect(setup().deliveries.lastDeliveryFor('t-nope')).toBeUndefined();
  });
});

describe('void', () => {
  it('flips the status and keeps the note', () => {
    const { deliveries, customer, tank } = setup();
    const delivery = aDelivery(customer.id, tank.id);
    deliveries.insert(delivery);
    deliveries.void(delivery.id, 'wrong tank');
    const back = deliveries.get(delivery.id);
    expect(back.status).toBe('void');
    expect(back.notes).toBe('wrong tank');
  });

  it('refuses to void twice', () => {
    const { deliveries, customer, tank } = setup();
    const delivery = aDelivery(customer.id, tank.id);
    deliveries.insert(delivery);
    deliveries.void(delivery.id, 'wrong tank');
    expect(() => deliveries.void(delivery.id, 'again')).toThrowError(/missing or already void/);
  });

  it('refuses to void something that is not there', () => {
    expect(() => setup().deliveries.void('d-nope', 'x')).toThrowError(/missing or already void/);
  });
});

describe('totals', () => {
  it('adds up the posted tickets only', () => {
    const { deliveries, customer, tank } = setup();
    deliveries.insert(aDelivery(customer.id, tank.id, { gross: 100, meterTemperature: 60 }));
    deliveries.insert(aDelivery(customer.id, tank.id, { gross: 250, meterTemperature: 60 }));
    deliveries.insert(
      aDelivery(customer.id, tank.id, { gross: 999, meterTemperature: 60, status: 'void' }),
    );
    expect(deliveries.totals()).toEqual({ tickets: 2, gross: 350, net: 350 });
  });

  it('is all zeroes when there is nothing', () => {
    expect(setup().deliveries.totals()).toEqual({ tickets: 0, gross: 0, net: 0 });
  });
});
