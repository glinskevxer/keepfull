import { AppContext, currentDay } from './context';
import { Cents, cents } from '../util/money';
import { ConflictError, NotFoundError } from '../core/errors';
import { DayKey } from '../util/dates';
import { Delivery } from '../model/delivery';
import { PriceLock, Quote, quote } from '../core/pricing';
import { StoredLock } from '../db/repo/pricing-repo';

/**
 * Turns gallons into money.
 *
 * Nothing here writes an invoice. The billing system is a separate package the
 * office already runs and it is not being replaced. What this does is produce
 * the number that goes on the ticket the driver leaves behind, and it has to
 * match what billing works out later or the phone rings.
 */

/** Charged on every delivery, whatever the size. */
export const HAZMAT_FEE: Cents = cents(495);

export interface PriceRequest {
  readonly customerId: string;
  readonly gallons: number;
  readonly on?: DayKey;
  /** Skip the lock even if the customer holds one, for a quote comparison. */
  readonly ignoreLock?: boolean;
  readonly taxPercent?: number;
}

export interface PricedFill {
  readonly quote: Quote;
  readonly scheduleId: string;
  readonly lockId?: string;
  readonly lockGallonsUsed: number;
}

function toCoreLock(stored: StoredLock): PriceLock {
  return {
    pricePerGallon: stored.pricePerGallon,
    gallonsRemaining: stored.gallonsCommitted - stored.gallonsUsed,
    expiresOn: stored.expiresOn,
  };
}

export class PricingService {
  constructor(private readonly context: AppContext) {}

  priceFor(request: PriceRequest): PricedFill {
    const on = request.on ?? currentDay(this.context);
    const customer = this.context.customers.get(request.customerId);
    const schedule = this.context.pricing.scheduleInForce(customer.rateClass, on);
    if (!schedule) {
      throw new NotFoundError(`price schedule for ${customer.rateClass} on ${on}`, customer.id);
    }
    const stored = request.ignoreLock
      ? undefined
      : this.context.pricing.activeLock(customer.id, on);
    const lock = stored ? toCoreLock(stored) : undefined;
    const result = quote(schedule, request.gallons, {
      ...(lock ? { lock } : {}),
      on,
      taxPercent: request.taxPercent ?? 0,
      flatFees: [{ label: 'hazmat', amount: HAZMAT_FEE }],
    });
    const lockedCharge = result.charges.find((charge) => charge.label === 'locked price');
    return {
      quote: result,
      scheduleId: schedule.id,
      ...(stored ? { lockId: stored.id } : {}),
      lockGallonsUsed: lockedCharge?.gallons ?? 0,
    };
  }

  /** Prices a posted ticket and draws down the lock it used. */
  priceDelivery(delivery: Delivery, options: { taxPercent?: number } = {}): PricedFill {
    if (delivery.status !== 'posted') {
      throw new ConflictError(`ticket ${delivery.ticketNumber} is void and has no price`, {
        ticketNumber: delivery.ticketNumber,
      });
    }
    const priced = this.priceFor({
      customerId: delivery.customerId,
      gallons: delivery.net,
      on: delivery.deliveredOn,
      ...(options.taxPercent === undefined ? {} : { taxPercent: options.taxPercent }),
    });
    if (priced.lockId && priced.lockGallonsUsed > 0) {
      this.context.pricing.drawLock(priced.lockId, priced.lockGallonsUsed);
    }
    this.context.logger.info('priced a ticket', {
      ticketNumber: delivery.ticketNumber,
      gallons: delivery.net,
      total: priced.quote.total,
      lockId: priced.lockId ?? null,
    });
    return priced;
  }

  /** What the same gallons would cost with and without the lock. */
  lockBenefit(customerId: string, gallons: number, on?: DayKey): Cents {
    const withLock = this.priceFor({ customerId, gallons, ...(on ? { on } : {}) });
    const without = this.priceFor({
      customerId,
      gallons,
      ignoreLock: true,
      ...(on ? { on } : {}),
    });
    return cents(without.quote.total - withLock.quote.total);
  }

  /** Gallons still owed under every live lock, which the buyer needs before hedging. */
  committedGallons(on?: DayKey): number {
    const asOf = on ?? currentDay(this.context);
    let total = 0;
    for (const customer of this.context.customers.list({ openOnly: true })) {
      const lock = this.context.pricing.activeLock(customer.id, asOf);
      if (lock) {
        total += lock.gallonsCommitted - lock.gallonsUsed;
      }
    }
    return total;
  }
}
