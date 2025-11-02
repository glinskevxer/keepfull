import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { PriceSchedule, makeSchedule } from '../../../src/core/pricing';
import { PricingRepository, StoredLock } from '../../../src/db/repo/pricing-repo';
import { aCustomer } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { parseMills } from '../../../src/util/money';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const customer = aCustomer();
  new CustomerRepository(db).insert(customer);
  return { pricing: new PricingRepository(db), customer };
}

const schedule: PriceSchedule = makeSchedule({
  id: 'ps-1',
  rateClass: 'residential',
  effectiveFrom: dayKey('2025-09-01'),
  tiers: [
    { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
    { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
  ],
});

function aLock(customerId: string, overrides: Partial<StoredLock> = {}): StoredLock {
  return {
    id: 'lk-1',
    customerId,
    pricePerGallon: parseMills('2.4990'),
    gallonsCommitted: 500,
    gallonsUsed: 0,
    signedOn: dayKey('2025-07-01'),
    expiresOn: dayKey('2026-06-30'),
    ...overrides,
  };
}

describe('schedules', () => {
  it('round trips with its tiers', () => {
    const { pricing } = setup();
    pricing.saveSchedule(schedule);
    expect(pricing.getSchedule('ps-1')).toEqual(schedule);
  });

  it('keeps an adder', () => {
    const { pricing } = setup();
    pricing.saveSchedule({ ...schedule, adderPerGallon: parseMills('0.0500') });
    expect(pricing.getSchedule('ps-1').adderPerGallon).toBe(parseMills('0.0500'));
  });

  it('replaces the tiers on a second save', () => {
    const { pricing } = setup();
    pricing.saveSchedule(schedule);
    pricing.saveSchedule({
      ...schedule,
      tiers: [{ fromGallons: 0, pricePerGallon: parseMills('3.1000') }],
    });
    expect(pricing.getSchedule('ps-1').tiers).toHaveLength(1);
  });

  it('refuses two schedules for one class on one day', () => {
    const { pricing } = setup();
    pricing.saveSchedule(schedule);
    expect(() => pricing.saveSchedule({ ...schedule, id: 'ps-2' })).toThrowError(
      /already a residential schedule/,
    );
  });

  it('throws for one it does not hold', () => {
    expect(() => setup().pricing.getSchedule('ps-9')).toThrowError(/no price schedule/);
  });

  it('finds the one in force and ignores a later one', () => {
    const { pricing } = setup();
    pricing.saveSchedule(schedule);
    pricing.saveSchedule({ ...schedule, id: 'ps-2', effectiveFrom: dayKey('2025-12-01') });
    expect(pricing.scheduleInForce('residential', dayKey('2025-11-01'))?.id).toBe('ps-1');
    expect(pricing.scheduleInForce('residential', dayKey('2026-01-01'))?.id).toBe('ps-2');
  });

  it('has nothing in force before the first schedule', () => {
    const { pricing } = setup();
    pricing.saveSchedule(schedule);
    expect(pricing.scheduleInForce('residential', dayKey('2025-01-01'))).toBeUndefined();
    expect(pricing.scheduleInForce('commercial', dayKey('2026-01-01'))).toBeUndefined();
  });

  it('lists newest first and filters by class and day', () => {
    const { pricing } = setup();
    pricing.saveSchedule(schedule);
    pricing.saveSchedule({ ...schedule, id: 'ps-2', effectiveFrom: dayKey('2025-12-01') });
    pricing.saveSchedule({ ...schedule, id: 'ps-3', rateClass: 'commercial' });
    expect(pricing.listSchedules({ rateClass: 'residential' }).map((s) => s.id)).toEqual([
      'ps-2',
      'ps-1',
    ]);
    expect(pricing.listSchedules({ onOrBefore: dayKey('2025-10-01') })).toHaveLength(2);
  });
});

describe('locks', () => {
  it('round trips', () => {
    const { pricing, customer } = setup();
    const lock = aLock(customer.id);
    pricing.saveLock(lock);
    expect(pricing.listLocks(customer.id)).toEqual([lock]);
  });

  it('finds the live one', () => {
    const { pricing, customer } = setup();
    pricing.saveLock(aLock(customer.id));
    expect(pricing.activeLock(customer.id, dayKey('2025-10-01'))?.id).toBe('lk-1');
  });

  it('ignores an expired lock', () => {
    const { pricing, customer } = setup();
    pricing.saveLock(aLock(customer.id));
    expect(pricing.activeLock(customer.id, dayKey('2026-07-01'))).toBeUndefined();
  });

  it('ignores one with no gallons left', () => {
    const { pricing, customer } = setup();
    pricing.saveLock(aLock(customer.id, { gallonsUsed: 500 }));
    expect(pricing.activeLock(customer.id, dayKey('2025-10-01'))).toBeUndefined();
  });

  it('draws gallons off', () => {
    const { pricing, customer } = setup();
    pricing.saveLock(aLock(customer.id));
    expect(pricing.drawLock('lk-1', 120).gallonsUsed).toBe(120);
    expect(pricing.drawLock('lk-1', 80).gallonsUsed).toBe(200);
  });

  it('refuses to draw more than is left', () => {
    const { pricing, customer } = setup();
    pricing.saveLock(aLock(customer.id, { gallonsUsed: 450 }));
    expect(() => pricing.drawLock('lk-1', 100)).toThrowError(/has 50 gallons left, not 100/);
  });

  it('refuses to draw off a lock that is not there', () => {
    expect(() => setup().pricing.drawLock('lk-9', 10)).toThrowError(/no price lock/);
  });

  it('takes the locks with the account', () => {
    const { pricing, customer } = setup();
    pricing.saveLock(aLock(customer.id));
    expect(pricing.listLocks(customer.id)).toHaveLength(1);
  });
});
