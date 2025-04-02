import { assertInRange, assertNonEmpty } from '../util/assert';
import { DayKey, dayKey, isDayKey } from '../util/dates';
import { InvalidInputError } from '../core/errors';
import { parseAccountNumber } from '../util/ids';

/**
 * A customer is an account, not a person. The billing name and the name on the
 * gate sign are often different and the delivery address is the one that
 * matters, so both are carried.
 */

/**
 * How the account gets filled.
 *
 * `keep_full` is the whole point of the system: the dealer decides when to come
 * and the customer never calls. `will_call` means the customer calls and we do
 * not forecast for them, though we still track their burn so we can offer to
 * move them over. `budget` is keep full with a levelled payment plan attached.
 */
export type DeliveryMode = 'keep_full' | 'will_call' | 'budget';

export const DELIVERY_MODES: readonly DeliveryMode[] = ['keep_full', 'will_call', 'budget'];

export type RateClass = 'residential' | 'commercial' | 'agricultural' | 'resale';

export const RATE_CLASSES: readonly RateClass[] = [
  'residential',
  'commercial',
  'agricultural',
  'resale',
];

export interface ServiceAddress {
  readonly line1: string;
  readonly line2?: string;
  readonly town: string;
  readonly county: string;
  readonly postalCode: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface Customer {
  readonly id: string;
  readonly accountNumber: string;
  readonly billingName: string;
  readonly serviceName: string;
  readonly address: ServiceAddress;
  readonly deliveryMode: DeliveryMode;
  readonly rateClass: RateClass;
  /** Weather station whose degree days drive this account's forecast. */
  readonly stationId: string;
  readonly openedOn: DayKey;
  readonly closedOn?: DayKey;
  /** Set when the yard has told the driver not to fill, for a balance or a gate. */
  readonly holdReason?: string;
}

export interface CustomerDraft {
  readonly id: string;
  readonly accountNumber: string;
  readonly billingName: string;
  readonly serviceName?: string;
  readonly address: ServiceAddress;
  readonly deliveryMode: DeliveryMode;
  readonly rateClass: RateClass;
  readonly stationId: string;
  readonly openedOn: string;
  readonly closedOn?: string;
  readonly holdReason?: string;
}

function checkAddress(address: ServiceAddress): ServiceAddress {
  assertNonEmpty(address.line1, 'address line 1');
  assertNonEmpty(address.town, 'town');
  assertNonEmpty(address.county, 'county');
  if (!/^\d{5}(-\d{4})?$/.test(address.postalCode)) {
    throw new InvalidInputError(`"${address.postalCode}" is not a postal code`, {
      postalCode: address.postalCode,
    });
  }
  assertInRange(address.latitude, -90, 90, 'latitude');
  assertInRange(address.longitude, -180, 180, 'longitude');
  return address;
}

export function makeCustomer(draft: CustomerDraft): Customer {
  assertNonEmpty(draft.id, 'customer id');
  parseAccountNumber(draft.accountNumber);
  assertNonEmpty(draft.billingName, 'billing name');
  assertNonEmpty(draft.stationId, 'station id');
  if (!DELIVERY_MODES.includes(draft.deliveryMode)) {
    throw new InvalidInputError(`"${draft.deliveryMode}" is not a delivery mode`);
  }
  if (!RATE_CLASSES.includes(draft.rateClass)) {
    throw new InvalidInputError(`"${draft.rateClass}" is not a rate class`);
  }
  if (!isDayKey(draft.openedOn)) {
    throw new InvalidInputError(`"${draft.openedOn}" is not a day the account could open`);
  }
  const openedOn = dayKey(draft.openedOn);
  let closedOn: DayKey | undefined;
  if (draft.closedOn !== undefined) {
    if (!isDayKey(draft.closedOn)) {
      throw new InvalidInputError(`"${draft.closedOn}" is not a day the account could close`);
    }
    closedOn = dayKey(draft.closedOn);
    if (closedOn < openedOn) {
      throw new InvalidInputError('the account cannot close before it opened', {
        openedOn,
        closedOn,
      });
    }
  }
  return {
    id: draft.id,
    accountNumber: draft.accountNumber,
    billingName: draft.billingName,
    serviceName: draft.serviceName ?? draft.billingName,
    address: checkAddress(draft.address),
    deliveryMode: draft.deliveryMode,
    rateClass: draft.rateClass,
    stationId: draft.stationId,
    openedOn,
    ...(closedOn ? { closedOn } : {}),
    ...(draft.holdReason ? { holdReason: draft.holdReason } : {}),
  };
}

export function isActive(customer: Customer, on: DayKey): boolean {
  if (on < customer.openedOn) {
    return false;
  }
  return customer.closedOn === undefined || on <= customer.closedOn;
}

/** Whether the dealer, rather than the customer, decides when to come. */
export function isForecast(customer: Customer): boolean {
  return customer.deliveryMode === 'keep_full' || customer.deliveryMode === 'budget';
}

export function isOnHold(customer: Customer): boolean {
  return customer.holdReason !== undefined && customer.holdReason.trim().length > 0;
}

export function displayName(customer: Customer): string {
  return customer.serviceName === customer.billingName
    ? customer.billingName
    : `${customer.serviceName} (bills to ${customer.billingName})`;
}
