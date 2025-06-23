import { Customer, CustomerDraft, makeCustomer } from '../../src/model/customer';
import { Tank, TankDraft, makeTank } from '../../src/model/tank';

/** Small builders so a test only has to say what it cares about. */

let accountSerial = 118_000;

export function aCustomer(overrides: Partial<CustomerDraft> = {}): Customer {
  accountSerial += 1;
  return makeCustomer({
    id: `c-${accountSerial}`,
    accountNumber: `04-${String(accountSerial).padStart(6, '0')}`,
    billingName: 'Merrick Farms LLC',
    address: {
      line1: '4412 Bell Hollow Rd',
      town: 'Danby',
      county: 'Tompkins',
      postalCode: '14883',
      latitude: 42.3406,
      longitude: -76.4901,
    },
    deliveryMode: 'keep_full',
    rateClass: 'agricultural',
    stationId: 'KITH',
    openedOn: '2019-09-14',
    ...overrides,
  });
}

let tankSerial = 884_000;

export function aTank(customerId: string, overrides: Partial<TankDraft> = {}): Tank {
  tankSerial += 1;
  return makeTank({
    id: `t-${tankSerial}`,
    customerId,
    serialNumber: `TR-${tankSerial}`,
    waterCapacity: 500,
    owner: 'company',
    appliances: ['furnace', 'water_heater'],
    installedOn: '2019-09-20',
    ...overrides,
  });
}
