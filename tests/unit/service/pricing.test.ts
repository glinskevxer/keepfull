import { afterEach, describe, expect, it } from 'vitest';
import { HAZMAT_FEE, PricingService } from '../../../src/service/pricing';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeSchedule } from '../../../src/core/pricing';
import { parseMills } from '../../../src/util/money';

afterEach(closeTestDatabases);

function setup(options: { withLock?: boolean } = {}) {
  const scenario = buildScenario({ today: '2025-11-10' });
  scenario.context.pricing.saveSchedule(
    makeSchedule({
      id: 'ps-1',
      rateClass: 'agricultural',
      effectiveFrom: dayKey('2025-09-01'),
      tiers: [
        { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
        { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
      ],
    }),
  );
  if (options.withLock) {
    scenario.context.pricing.saveLock({
      id: 'lk-1',
      customerId: scenario.customer.id,
      pricePerGallon: parseMills('2.4990'),
      gallonsCommitted: 200,
      gallonsUsed: 0,
      signedOn: dayKey('2025-07-01'),
      expiresOn: dayKey('2026-06-30'),
    });
  }
  return { scenario, service: new PricingService(scenario.context) };
}

describe('priceFor', () => {
  it('prices off the schedule in force', () => {
    const { scenario, service } = setup();
    const priced = service.priceFor({ customerId: scenario.customer.id, gallons: 400 });
    expect(priced.scheduleId).toBe('ps-1');
    expect(priced.quote.subtotal).toBe(119960);
  });

  it('always adds the hazmat fee', () => {
    const { scenario, service } = setup();
    const priced = service.priceFor({ customerId: scenario.customer.id, gallons: 400 });
    expect(priced.quote.fees).toBe(HAZMAT_FEE);
    expect(priced.quote.total).toBe(priced.quote.subtotal + HAZMAT_FEE);
  });

  it('adds tax when the caller asks for it', () => {
    const { scenario, service } = setup();
    const priced = service.priceFor({
      customerId: scenario.customer.id,
      gallons: 400,
      taxPercent: 8,
    });
    expect(priced.quote.tax).toBeGreaterThan(0);
  });

  it('uses a live lock', () => {
    const { scenario, service } = setup({ withLock: true });
    const priced = service.priceFor({ customerId: scenario.customer.id, gallons: 400 });
    expect(priced.lockId).toBe('lk-1');
    expect(priced.lockGallonsUsed).toBe(200);
  });

  it('can be told to ignore the lock', () => {
    const { scenario, service } = setup({ withLock: true });
    const priced = service.priceFor({
      customerId: scenario.customer.id,
      gallons: 400,
      ignoreLock: true,
    });
    expect(priced.lockId).toBeUndefined();
    expect(priced.lockGallonsUsed).toBe(0);
  });

  it('refuses when there is no schedule for the class', () => {
    const { scenario, service } = setup();
    scenario.context.customers.update({ ...scenario.customer, rateClass: 'resale' });
    expect(() => service.priceFor({ customerId: scenario.customer.id, gallons: 400 })).toThrowError(
      /no price schedule for resale/,
    );
  });

  it('refuses a customer it does not know', () => {
    const { service } = setup();
    expect(() => service.priceFor({ customerId: 'c-nope', gallons: 100 })).toThrowError(
      /no customer with id/,
    );
  });
});

describe('priceDelivery', () => {
  function withTicket(options: { withLock?: boolean } = {}) {
    const context = setup(options);
    context.scenario.fill('2025-11-10', 400, { meterTemperature: 60 });
    const delivery = context.scenario.context.deliveries.list()[0];
    return { ...context, delivery: delivery! };
  }

  it('prices at the day of the ticket', () => {
    const { service, delivery } = withTicket();
    expect(service.priceDelivery(delivery).quote.subtotal).toBe(119960);
  });

  it('draws the gallons off the lock', () => {
    const { scenario, service, delivery } = withTicket({ withLock: true });
    service.priceDelivery(delivery);
    expect(scenario.context.pricing.listLocks(scenario.customer.id)[0]?.gallonsUsed).toBe(200);
  });

  it('does not draw when there is no lock', () => {
    const { scenario, service, delivery } = withTicket();
    service.priceDelivery(delivery);
    expect(scenario.context.pricing.listLocks(scenario.customer.id)).toEqual([]);
  });

  it('refuses a voided ticket', () => {
    const { scenario, service, delivery } = withTicket();
    scenario.context.deliveries.void(delivery.id, 'wrong tank');
    const voided = scenario.context.deliveries.get(delivery.id);
    expect(() => service.priceDelivery(voided)).toThrowError(/is void and has no price/);
  });

  it('says so in the log', () => {
    const { scenario, service, delivery } = withTicket();
    service.priceDelivery(delivery);
    expect(scenario.sink.messages()).toContain('priced a ticket');
  });
});

describe('lockBenefit and committedGallons', () => {
  it('measures what the lock saved', () => {
    const { scenario, service } = setup({ withLock: true });
    expect(service.lockBenefit(scenario.customer.id, 400)).toBeGreaterThan(0);
  });

  it('is nothing when there is no lock', () => {
    const { scenario, service } = setup();
    expect(service.lockBenefit(scenario.customer.id, 400)).toBe(0);
  });

  it('adds up what is still committed', () => {
    const { service } = setup({ withLock: true });
    expect(service.committedGallons()).toBe(200);
  });

  it('is zero once the locks are used up', () => {
    const { scenario, service } = setup({ withLock: true });
    scenario.context.pricing.drawLock('lk-1', 200);
    expect(service.committedGallons()).toBe(0);
  });
});
