import { PriceSchedule, makeSchedule as buildSchedule } from '../../../src/core/pricing';
import { RateClass } from '../../../src/model/customer';
import { DayKey } from '../../../src/util/dates';
import { Truck, makeTruck } from '../../../src/model/fleet';
import { parseMills } from '../../../src/util/money';

export { makeDriver } from '../../../src/model/fleet';

export function makeTruckFixture(): Truck {
  return makeTruck({
    id: 'trk-b4',
    unitNumber: 'B-4',
    waterCapacity: 3000,
    meterSealedOn: '2026-06-01',
  });
}

export function makeSchedule(options: {
  rateClass: RateClass;
  effectiveFrom: DayKey;
}): PriceSchedule {
  return buildSchedule({
    id: `ps-${options.rateClass}`,
    rateClass: options.rateClass,
    effectiveFrom: options.effectiveFrom,
    tiers: [{ fromGallons: 0, pricePerGallon: parseMills('2.9990') }],
  });
}
