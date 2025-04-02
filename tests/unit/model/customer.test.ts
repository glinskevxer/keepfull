import { describe, expect, it } from 'vitest';
import {
  Customer,
  CustomerDraft,
  ServiceAddress,
  displayName,
  isActive,
  isForecast,
  isOnHold,
  makeCustomer,
} from '../../../src/model/customer';
import { dayKey } from '../../../src/util/dates';

const address: ServiceAddress = {
  line1: '4412 Bell Hollow Rd',
  town: 'Danby',
  county: 'Tompkins',
  postalCode: '14883',
  latitude: 42.3406,
  longitude: -76.4901,
};

const draft: CustomerDraft = {
  id: 'c-1',
  accountNumber: '04-118372',
  billingName: 'Merrick Farms LLC',
  address,
  deliveryMode: 'keep_full',
  rateClass: 'agricultural',
  stationId: 'KITH',
  openedOn: '2019-09-14',
};

function make(overrides: Partial<CustomerDraft> = {}): Customer {
  return makeCustomer({ ...draft, ...overrides });
}

describe('makeCustomer', () => {
  it('defaults the service name to the billing name', () => {
    expect(make().serviceName).toBe('Merrick Farms LLC');
  });

  it('keeps a separate service name when there is one', () => {
    expect(make({ serviceName: 'Bell Hollow Barn' }).serviceName).toBe('Bell Hollow Barn');
  });

  it('leaves the optional fields off rather than undefined', () => {
    expect(Object.keys(make())).not.toContain('closedOn');
    expect(Object.keys(make())).not.toContain('holdReason');
  });

  it('refuses a bad account number', () => {
    expect(() => make({ accountNumber: '4-118372' })).toThrowError(/not an account number/);
  });

  it('refuses an unknown delivery mode', () => {
    expect(() => make({ deliveryMode: 'whenever' as never })).toThrowError(/not a delivery mode/);
  });

  it('refuses an unknown rate class', () => {
    expect(() => make({ rateClass: 'wholesale' as never })).toThrowError(/not a rate class/);
  });

  it('refuses a blank billing name', () => {
    expect(() => make({ billingName: '  ' })).toThrowError(/billing name/);
  });

  it('refuses an opening day that is not a day', () => {
    expect(() => make({ openedOn: '14/09/2019' })).toThrowError(/could open/);
  });

  it('refuses a close before the open', () => {
    expect(() => make({ closedOn: '2018-01-01' })).toThrowError(/cannot close before it opened/);
  });

  it('accepts a close on the same day it opened', () => {
    expect(make({ closedOn: '2019-09-14' }).closedOn).toBe('2019-09-14');
  });
});

describe('address checks', () => {
  it('refuses a postal code that is not one', () => {
    expect(() => make({ address: { ...address, postalCode: '148' } })).toThrowError(
      /not a postal code/,
    );
  });

  it('takes a nine digit postal code', () => {
    expect(make({ address: { ...address, postalCode: '14883-0142' } }).address.postalCode).toBe(
      '14883-0142',
    );
  });

  it('refuses coordinates off the globe', () => {
    expect(() => make({ address: { ...address, latitude: 95 } })).toThrowError(/latitude/);
    expect(() => make({ address: { ...address, longitude: -200 } })).toThrowError(/longitude/);
  });

  it('refuses a blank county, because the county drives the excise rate', () => {
    expect(() => make({ address: { ...address, county: '' } })).toThrowError(/county/);
  });
});

describe('isActive', () => {
  it('is false before the account opened', () => {
    expect(isActive(make(), dayKey('2019-09-13'))).toBe(false);
    expect(isActive(make(), dayKey('2019-09-14'))).toBe(true);
  });

  it('is open ended while the account is still open', () => {
    expect(isActive(make(), dayKey('2030-01-01'))).toBe(true);
  });

  it('includes the closing day itself', () => {
    const closed = make({ closedOn: '2024-06-30' });
    expect(isActive(closed, dayKey('2024-06-30'))).toBe(true);
    expect(isActive(closed, dayKey('2024-07-01'))).toBe(false);
  });
});

describe('isForecast', () => {
  it('covers keep full and budget but not will call', () => {
    expect(isForecast(make({ deliveryMode: 'keep_full' }))).toBe(true);
    expect(isForecast(make({ deliveryMode: 'budget' }))).toBe(true);
    expect(isForecast(make({ deliveryMode: 'will_call' }))).toBe(false);
  });
});

describe('isOnHold', () => {
  it('needs a real reason, not an empty one', () => {
    expect(isOnHold(make())).toBe(false);
    expect(isOnHold(make({ holdReason: 'past due 90' }))).toBe(true);
  });
});

describe('displayName', () => {
  it('is just the name when they match', () => {
    expect(displayName(make())).toBe('Merrick Farms LLC');
  });

  it('shows both when they differ', () => {
    expect(displayName(make({ serviceName: 'Bell Hollow Barn' }))).toBe(
      'Bell Hollow Barn (bills to Merrick Farms LLC)',
    );
  });
});
