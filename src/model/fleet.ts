import { DayKey, addDays, dayKey, isDayKey } from '../util/dates';
import { InvalidInputError } from '../core/errors';
import { assertInRange, assertNonEmpty, assertPositive } from '../util/assert';

/**
 * Trucks and the people who drive them.
 *
 * A bobtail's water capacity is not its working capacity. The tank on the truck
 * is subject to the same eighty percent filling rule as the one in the yard, so
 * a three thousand gallon bobtail leaves the plant with about two thousand four
 * hundred, and dispatch has to plan against the smaller figure or the last two
 * stops of every route come up short.
 */

export type TruckKind = 'bobtail' | 'transport' | 'service';

export const TRUCK_KINDS: readonly TruckKind[] = ['bobtail', 'transport', 'service'];

export interface Truck {
  readonly id: string;
  readonly unitNumber: string;
  readonly kind: TruckKind;
  /** Water capacity of the tank on the truck, in gallons. */
  readonly waterCapacity: number;
  readonly fillLimit: number;
  /** Gallons the driver keeps back rather than running the pump dry. */
  readonly heelGallons: number;
  /** Date the weights and measures seal on the meter was last renewed. */
  readonly meterSealedOn?: DayKey;
  readonly active: boolean;
}

export interface TruckDraft {
  readonly id: string;
  readonly unitNumber: string;
  readonly kind?: TruckKind;
  readonly waterCapacity: number;
  readonly fillLimit?: number;
  readonly heelGallons?: number;
  readonly meterSealedOn?: string;
  readonly active?: boolean;
}

export function makeTruck(draft: TruckDraft): Truck {
  assertNonEmpty(draft.id, 'truck id');
  assertNonEmpty(draft.unitNumber, 'unit number');
  assertPositive(draft.waterCapacity, 'water capacity');
  const kind = draft.kind ?? 'bobtail';
  if (!TRUCK_KINDS.includes(kind)) {
    throw new InvalidInputError(`"${kind}" is not a kind of truck`);
  }
  const fillLimit = draft.fillLimit ?? 80;
  assertInRange(fillLimit, 10, 90, 'fill limit');
  const heelGallons = draft.heelGallons ?? 50;
  assertInRange(heelGallons, 0, draft.waterCapacity, 'heel gallons');
  if (draft.meterSealedOn !== undefined && !isDayKey(draft.meterSealedOn)) {
    throw new InvalidInputError(`"${draft.meterSealedOn}" is not a sealing day`);
  }
  return {
    id: draft.id,
    unitNumber: draft.unitNumber,
    kind,
    waterCapacity: draft.waterCapacity,
    fillLimit,
    heelGallons,
    ...(draft.meterSealedOn ? { meterSealedOn: dayKey(draft.meterSealedOn) } : {}),
    active: draft.active ?? true,
  };
}

/** Gallons the truck can actually put into customers' tanks on one load. */
export function workingCapacity(truck: Truck): number {
  return Math.max(0, (truck.waterCapacity * truck.fillLimit) / 100 - truck.heelGallons);
}

/** Meter seals last a year. An expired one means the tickets are not legal for trade. */
export function meterSealExpiresOn(truck: Truck): DayKey | undefined {
  return truck.meterSealedOn ? addDays(truck.meterSealedOn, 365) : undefined;
}

export function meterSealValidOn(truck: Truck, day: DayKey): boolean {
  const expires = meterSealExpiresOn(truck);
  return expires !== undefined && day <= expires;
}

export type LicenceEndorsement = 'hazmat' | 'tanker' | 'air_brakes';

export const ENDORSEMENTS: readonly LicenceEndorsement[] = ['hazmat', 'tanker', 'air_brakes'];

export interface Driver {
  readonly id: string;
  readonly name: string;
  readonly licenceNumber: string;
  readonly endorsements: readonly LicenceEndorsement[];
  readonly medicalCardExpiresOn?: DayKey;
  readonly active: boolean;
}

export interface DriverDraft {
  readonly id: string;
  readonly name: string;
  readonly licenceNumber: string;
  readonly endorsements?: readonly LicenceEndorsement[];
  readonly medicalCardExpiresOn?: string;
  readonly active?: boolean;
}

export function makeDriver(draft: DriverDraft): Driver {
  assertNonEmpty(draft.id, 'driver id');
  assertNonEmpty(draft.name, 'driver name');
  assertNonEmpty(draft.licenceNumber, 'licence number');
  const endorsements = draft.endorsements ?? [];
  for (const endorsement of endorsements) {
    if (!ENDORSEMENTS.includes(endorsement)) {
      throw new InvalidInputError(`"${endorsement}" is not an endorsement we track`);
    }
  }
  if (draft.medicalCardExpiresOn !== undefined && !isDayKey(draft.medicalCardExpiresOn)) {
    throw new InvalidInputError(`"${draft.medicalCardExpiresOn}" is not an expiry day`);
  }
  return {
    id: draft.id,
    name: draft.name,
    licenceNumber: draft.licenceNumber,
    endorsements: [...endorsements],
    ...(draft.medicalCardExpiresOn
      ? { medicalCardExpiresOn: dayKey(draft.medicalCardExpiresOn) }
      : {}),
    active: draft.active ?? true,
  };
}

/** Nobody hauls propane without both of these, whatever the schedule says. */
export function canHaulPropane(driver: Driver, on: DayKey): boolean {
  if (!driver.active) {
    return false;
  }
  if (!driver.endorsements.includes('hazmat') || !driver.endorsements.includes('tanker')) {
    return false;
  }
  return driver.medicalCardExpiresOn === undefined || on <= driver.medicalCardExpiresOn;
}
