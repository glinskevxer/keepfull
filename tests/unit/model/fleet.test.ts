import { describe, expect, it } from 'vitest';
import {
  Driver,
  DriverDraft,
  ENDORSEMENTS,
  Truck,
  TruckDraft,
  canHaulPropane,
  makeDriver,
  makeTruck,
  meterSealExpiresOn,
  meterSealValidOn,
  workingCapacity,
} from '../../../src/model/fleet';
import { dayKey } from '../../../src/util/dates';

const truckDraft: TruckDraft = { id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 };

function truck(overrides: Partial<TruckDraft> = {}): Truck {
  return makeTruck({ ...truckDraft, ...overrides });
}

const driverDraft: DriverDraft = {
  id: 'drv-3',
  name: 'R Vandemark',
  licenceNumber: 'NY-882-441',
  endorsements: ['hazmat', 'tanker'],
};

function driver(overrides: Partial<DriverDraft> = {}): Driver {
  return makeDriver({ ...driverDraft, ...overrides });
}

describe('makeTruck', () => {
  it('defaults to a bobtail at the eighty percent limit with a fifty gallon heel', () => {
    const unit = truck();
    expect(unit.kind).toBe('bobtail');
    expect(unit.fillLimit).toBe(80);
    expect(unit.heelGallons).toBe(50);
    expect(unit.active).toBe(true);
  });

  it('refuses a kind it does not know', () => {
    expect(() => truck({ kind: 'flatbed' as never })).toThrowError(/not a kind of truck/);
  });

  it('refuses a heel bigger than the tank', () => {
    expect(() => truck({ heelGallons: 4000 })).toThrowError(/heel gallons/);
  });

  it('refuses a truck with no capacity', () => {
    expect(() => truck({ waterCapacity: 0 })).toThrowError(/water capacity/);
  });

  it('refuses a sealing day that is not a day', () => {
    expect(() => truck({ meterSealedOn: 'last spring' })).toThrowError(/not a sealing day/);
  });
});

describe('workingCapacity', () => {
  it('is the filling limit less the heel', () => {
    expect(workingCapacity(truck())).toBe(2350);
  });

  it('follows a different filling limit', () => {
    expect(workingCapacity(truck({ fillLimit: 85, heelGallons: 0 }))).toBe(2550);
  });

  it('never goes below zero', () => {
    expect(workingCapacity(truck({ waterCapacity: 100, heelGallons: 100 }))).toBe(0);
  });
});

describe('the meter seal', () => {
  it('lasts a year', () => {
    expect(meterSealExpiresOn(truck({ meterSealedOn: '2025-03-04' }))).toBe('2026-03-04');
  });

  it('is unknown when the truck has never been sealed', () => {
    expect(meterSealExpiresOn(truck())).toBeUndefined();
    expect(meterSealValidOn(truck(), dayKey('2025-06-01'))).toBe(false);
  });

  it('is valid up to and including the expiry', () => {
    const sealed = truck({ meterSealedOn: '2025-03-04' });
    expect(meterSealValidOn(sealed, dayKey('2026-03-04'))).toBe(true);
    expect(meterSealValidOn(sealed, dayKey('2026-03-05'))).toBe(false);
  });
});

describe('makeDriver', () => {
  it('copies the endorsement list', () => {
    const endorsements: DriverDraft['endorsements'] = ['hazmat'];
    const person = driver({ endorsements });
    expect(person.endorsements).toEqual(['hazmat']);
    expect(person.endorsements).not.toBe(endorsements);
  });

  it('refuses an endorsement it does not track', () => {
    expect(() => driver({ endorsements: ['forklift' as never] })).toThrowError(
      /not an endorsement/,
    );
  });

  it('accepts every endorsement it does track', () => {
    expect(driver({ endorsements: ENDORSEMENTS }).endorsements).toHaveLength(3);
  });

  it('refuses an expiry that is not a day', () => {
    expect(() => driver({ medicalCardExpiresOn: 'soon' })).toThrowError(/not an expiry day/);
  });

  it('refuses a blank licence number', () => {
    expect(() => driver({ licenceNumber: ' ' })).toThrowError(/licence number/);
  });
});

describe('canHaulPropane', () => {
  const day = dayKey('2025-06-01');

  it('needs both endorsements', () => {
    expect(canHaulPropane(driver(), day)).toBe(true);
    expect(canHaulPropane(driver({ endorsements: ['hazmat'] }), day)).toBe(false);
    expect(canHaulPropane(driver({ endorsements: ['tanker'] }), day)).toBe(false);
  });

  it('refuses an inactive driver', () => {
    expect(canHaulPropane(driver({ active: false }), day)).toBe(false);
  });

  it('refuses an expired medical card', () => {
    expect(canHaulPropane(driver({ medicalCardExpiresOn: '2025-05-31' }), day)).toBe(false);
    expect(canHaulPropane(driver({ medicalCardExpiresOn: '2025-06-01' }), day)).toBe(true);
  });

  it('allows a driver with no card recorded, which the office chases separately', () => {
    expect(canHaulPropane(driver(), day)).toBe(true);
  });
});
