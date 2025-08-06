import { Customer, CustomerDraft, makeCustomer } from '../../src/model/customer';
import { Delivery, DeliveryDraft, makeDelivery } from '../../src/model/delivery';
import { Tank, TankDraft, makeTank } from '../../src/model/tank';
import { TankReading, TankReadingDraft, makeReading } from '../../src/model/reading';
import { ticketNumber } from '../../src/util/ids';

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

let ticketSerial = 884_100;

export function aDelivery(
  customerId: string,
  tankId: string,
  overrides: Partial<DeliveryDraft> = {},
): Delivery {
  ticketSerial += 1;
  return makeDelivery({
    id: `d-${ticketSerial}`,
    ticketNumber: ticketNumber(ticketSerial),
    customerId,
    tankId,
    deliveredOn: '2025-01-14',
    gross: 312.4,
    meterTemperature: 42,
    gaugeBefore: 22,
    gaugeAfter: 80,
    driverId: 'drv-3',
    truckId: 'B-4',
    ...overrides,
  });
}

let readingSerial = 0;

export function aReading(tankId: string, overrides: Partial<TankReadingDraft> = {}): TankReading {
  readingSerial += 1;
  return makeReading({
    id: `r-${readingSerial}`,
    tankId,
    takenOn: '2025-01-10',
    gauge: 42,
    source: 'driver',
    ...overrides,
  });
}
