import { describe, expect, it } from 'vitest';
import {
  commitPlanSchema,
  createCustomerSchema,
  createTankSchema,
  customerQuerySchema,
  dayString,
  dispatchQuerySchema,
  observationBatchSchema,
  postDeliverySchema,
  priceQuerySchema,
  recordReadingSchema,
  settleStopSchema,
  toFieldProblems,
} from '../../../src/api/schema';

const address = {
  line1: '4412 Bell Hollow Rd',
  town: 'Danby',
  county: 'Tompkins',
  postalCode: '14883',
  latitude: 42.3406,
  longitude: -76.4901,
};

const customer = {
  accountNumber: '04-118372',
  billingName: 'Merrick Farms LLC',
  address,
  deliveryMode: 'keep_full',
  rateClass: 'agricultural',
  stationId: 'KITH',
  openedOn: '2019-09-14',
};

describe('dayString', () => {
  it('accepts a real day', () => {
    expect(dayString.parse('2025-02-17')).toBe('2025-02-17');
  });

  it('refuses anything else', () => {
    expect(dayString.safeParse('17/02/2025').success).toBe(false);
    expect(dayString.safeParse('2025-02-30').success).toBe(false);
  });
});

describe('createCustomerSchema', () => {
  it('accepts a good body', () => {
    expect(createCustomerSchema.parse(customer).billingName).toBe('Merrick Farms LLC');
  });

  it('refuses a malformed account number', () => {
    const result = createCustomerSchema.safeParse({ ...customer, accountNumber: '4-118372' });
    expect(result.success).toBe(false);
    expect(toFieldProblems(result.error!)[0]).toEqual({
      field: 'accountNumber',
      message: 'expected a branch and a six digit serial',
    });
  });

  it('refuses a delivery mode it does not know', () => {
    expect(createCustomerSchema.safeParse({ ...customer, deliveryMode: 'whenever' }).success).toBe(
      false,
    );
  });

  it('names a nested field in the problem', () => {
    const result = createCustomerSchema.safeParse({
      ...customer,
      address: { ...address, postalCode: '148' },
    });
    expect(toFieldProblems(result.error!)[0]?.field).toBe('address.postalCode');
  });

  it('reports every problem, not just the first', () => {
    const result = createCustomerSchema.safeParse({
      ...customer,
      accountNumber: 'x',
      billingName: '',
    });
    expect(toFieldProblems(result.error!).length).toBeGreaterThan(1);
  });

  it('calls a body that is not an object a problem on the body itself', () => {
    const result = createCustomerSchema.safeParse('nope');
    expect(toFieldProblems(result.error!)[0]?.field).toBe('(body)');
  });
});

describe('customerQuerySchema', () => {
  it('coerces the numbers and flags a query string carries as text', () => {
    expect(customerQuerySchema.parse({ limit: '25', offset: '50', openOnly: 'true' })).toEqual({
      limit: 25,
      offset: 50,
      openOnly: true,
    });
  });

  it('refuses a page size past the cap', () => {
    expect(customerQuerySchema.safeParse({ limit: '5000' }).success).toBe(false);
  });

  it('takes an empty query', () => {
    expect(customerQuerySchema.parse({})).toEqual({});
  });
});

describe('createTankSchema', () => {
  const tank = {
    customerId: 'c-1',
    serialNumber: 'TR-1',
    waterCapacity: 500,
    owner: 'company',
    installedOn: '2019-09-20',
  };

  it('accepts a good body', () => {
    expect(createTankSchema.parse(tank).waterCapacity).toBe(500);
  });

  it('refuses a size that is not on the yard', () => {
    const result = createTankSchema.safeParse({ ...tank, waterCapacity: 400 });
    expect(toFieldProblems(result.error!)[0]?.message).toBe('not a tank size on the yard');
  });

  it('refuses an appliance it does not know', () => {
    expect(createTankSchema.safeParse({ ...tank, appliances: ['kiln'] }).success).toBe(false);
  });
});

describe('postDeliverySchema', () => {
  const ticket = {
    ticketNumber: '00088412',
    customerId: 'c-1',
    tankId: 't-1',
    deliveredOn: '2025-01-14',
    gross: 312.4,
    meterTemperature: 28,
    driverId: 'drv-3',
    truckId: 'b-4',
  };

  it('accepts a ticket with no gauges', () => {
    expect(postDeliverySchema.parse(ticket).gaugeBefore).toBeUndefined();
  });

  it('refuses a ticket number that is not eight digits', () => {
    const result = postDeliverySchema.safeParse({ ...ticket, ticketNumber: '881' });
    expect(toFieldProblems(result.error!)[0]?.message).toBe('expected eight digits');
  });

  it('refuses a gauge off the dial', () => {
    expect(postDeliverySchema.safeParse({ ...ticket, gaugeAfter: 140 }).success).toBe(false);
  });

  it('refuses a meter temperature no meter would report', () => {
    expect(postDeliverySchema.safeParse({ ...ticket, meterTemperature: 400 }).success).toBe(false);
  });
});

describe('the smaller schemas', () => {
  it('checks a reading', () => {
    expect(
      recordReadingSchema.safeParse({
        tankId: 't-1',
        takenOn: '2025-01-10',
        gauge: 42,
        source: 'driver',
      }).success,
    ).toBe(true);
  });

  it('caps an observation batch', () => {
    const observations = Array.from({ length: 401 }, () => ({
      day: '2025-01-01',
      high: 30,
      low: 10,
    }));
    expect(observationBatchSchema.safeParse({ stationId: 'KITH', observations }).success).toBe(
      false,
    );
  });

  it('refuses an empty observation batch', () => {
    expect(observationBatchSchema.safeParse({ stationId: 'KITH', observations: [] }).success).toBe(
      false,
    );
  });

  it('coerces the dispatch window', () => {
    expect(dispatchQuerySchema.parse({ windowDays: '5', returnToYard: 'true' })).toEqual({
      windowDays: 5,
      returnToYard: true,
    });
  });

  it('takes a driver map on a commit', () => {
    expect(commitPlanSchema.parse({ drivers: { 'b-4': 'drv-3' } }).drivers).toEqual({
      'b-4': 'drv-3',
    });
  });

  it('refuses a stop outcome that is still pending', () => {
    expect(settleStopSchema.safeParse({ tankId: 't-1', outcome: 'pending' }).success).toBe(false);
  });

  it('coerces a price query', () => {
    expect(priceQuerySchema.parse({ customerId: 'c-1', gallons: '400' }).gallons).toBe(400);
  });

  it('refuses a tax rate nobody charges', () => {
    expect(
      priceQuerySchema.safeParse({ customerId: 'c-1', gallons: '400', taxPercent: '90' }).success,
    ).toBe(false);
  });
});
