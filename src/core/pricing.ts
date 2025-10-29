import { Cents, Mills, cents, extend, mills, percentOf } from '../util/money';
import { DayKey } from '../util/dates';
import { InvalidInputError } from './errors';
import { RateClass } from '../model/customer';
import { assertNonNegative } from '../util/assert';

/**
 * What a fill costs.
 *
 * Propane is not priced per customer, it is priced per rate class and then
 * discounted by how much went in the tank. A hundred gallon fill on a
 * residential account and a nine hundred gallon fill on the same account are
 * different prices per gallon, which surprises people but is how every dealer
 * in this trade quotes.
 *
 * On top of that a customer may hold a locked price, from a summer fill
 * programme or a budget plan, and a locked price beats the posted schedule
 * whatever the tier says. The lock has a gallon cap; past the cap the rest of
 * the fill goes at the posted price.
 */

export interface PriceTier {
  /** Fills of at least this many gallons get this price. */
  readonly fromGallons: number;
  readonly pricePerGallon: Mills;
}

export interface PriceSchedule {
  readonly id: string;
  readonly rateClass: RateClass;
  readonly effectiveFrom: DayKey;
  readonly tiers: readonly PriceTier[];
  /** Added to every gallon, for a delivery surcharge or a fuel adder. */
  readonly adderPerGallon?: Mills;
}

export interface PriceLock {
  readonly pricePerGallon: Mills;
  readonly gallonsRemaining: number;
  readonly expiresOn: DayKey;
}

export interface Charge {
  readonly label: string;
  readonly gallons: number;
  readonly pricePerGallon: Mills;
  readonly amount: Cents;
}

export interface Quote {
  readonly charges: Charge[];
  readonly subtotal: Cents;
  readonly tax: Cents;
  readonly fees: Cents;
  readonly total: Cents;
  /** Blended price over the whole fill, for the ticket. */
  readonly effectivePricePerGallon: Mills;
}

export interface QuoteOptions {
  readonly lock?: PriceLock;
  /** State and local excise, as a percentage of the product subtotal. */
  readonly taxPercent?: number;
  /** Flat charges such as the hazmat fee. */
  readonly flatFees?: readonly { label: string; amount: Cents }[];
  readonly on?: DayKey;
}

export function makeSchedule(schedule: PriceSchedule): PriceSchedule {
  if (schedule.tiers.length === 0) {
    throw new InvalidInputError('a price schedule needs at least one tier');
  }
  const sorted = [...schedule.tiers].sort((left, right) => left.fromGallons - right.fromGallons);
  if ((sorted[0] as PriceTier).fromGallons !== 0) {
    throw new InvalidInputError('the first tier has to start at zero gallons');
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if ((sorted[index] as PriceTier).fromGallons === (sorted[index - 1] as PriceTier).fromGallons) {
      throw new InvalidInputError(
        `two tiers both start at ${(sorted[index] as PriceTier).fromGallons} gallons`,
      );
    }
  }
  return { ...schedule, tiers: sorted };
}

/** The tier a fill of this size falls into. The whole fill goes at that price. */
export function tierFor(schedule: PriceSchedule, gallons: number): PriceTier {
  assertNonNegative(gallons, 'gallons');
  let chosen = schedule.tiers[0] as PriceTier;
  for (const tier of schedule.tiers) {
    if (gallons >= tier.fromGallons) {
      chosen = tier;
    }
  }
  return chosen;
}

export function postedPrice(schedule: PriceSchedule, gallons: number): Mills {
  const tier = tierFor(schedule, gallons);
  return mills(tier.pricePerGallon + (schedule.adderPerGallon ?? 0));
}

export function quote(schedule: PriceSchedule, gallons: number, options: QuoteOptions = {}): Quote {
  assertNonNegative(gallons, 'gallons');
  const charges: Charge[] = [];
  let remaining = gallons;

  const lock = options.lock;
  const lockUsable =
    lock !== undefined &&
    lock.gallonsRemaining > 0 &&
    (options.on === undefined || options.on <= lock.expiresOn);
  if (lockUsable && lock) {
    const lockedGallons = Math.min(remaining, lock.gallonsRemaining);
    if (lockedGallons > 0) {
      charges.push({
        label: 'locked price',
        gallons: lockedGallons,
        pricePerGallon: lock.pricePerGallon,
        amount: extend(lockedGallons, lock.pricePerGallon),
      });
      remaining -= lockedGallons;
    }
  }

  if (remaining > 0 || charges.length === 0) {
    // The tier is chosen off the whole fill, not off the unlocked remainder. A
    // customer with a two hundred gallon lock filling six hundred still bought
    // six hundred gallons and gets the six hundred gallon tier on the rest.
    const price = postedPrice(schedule, gallons);
    charges.push({
      label: 'posted price',
      gallons: remaining,
      pricePerGallon: price,
      amount: extend(remaining, price),
    });
  }

  const subtotal = cents(charges.reduce((total, charge) => total + charge.amount, 0));
  const tax = options.taxPercent ? percentOf(subtotal, options.taxPercent) : cents(0);
  const fees = cents((options.flatFees ?? []).reduce((total, fee) => total + fee.amount, 0));
  const total = cents(subtotal + tax + fees);
  const effective = gallons > 0 ? Math.round((subtotal * 100) / gallons) : 0;
  return {
    charges,
    subtotal,
    tax,
    fees,
    total,
    effectivePricePerGallon: mills(effective),
  };
}

/** Picks the schedule in force on a day for a rate class. */
export function scheduleFor(
  schedules: readonly PriceSchedule[],
  rateClass: RateClass,
  on: DayKey,
): PriceSchedule | undefined {
  return schedules
    .filter((schedule) => schedule.rateClass === rateClass && schedule.effectiveFrom <= on)
    .sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? 1 : -1))[0];
}

/** What is left on a lock after a fill draws on it. */
export function drawLock(lock: PriceLock, gallons: number): PriceLock {
  assertNonNegative(gallons, 'gallons');
  return { ...lock, gallonsRemaining: Math.max(0, lock.gallonsRemaining - gallons) };
}
