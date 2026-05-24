import { AppContext, currentDay } from './context';
import { AuditContext, AuditService, SYSTEM_ACTOR } from './audit';
import { Cents, Mills, cents, extend, mills } from '../util/money';
import { ConflictError, InvalidInputError } from '../core/errors';
import { DayKey, addDays, heatingSeasonBounds } from '../util/dates';
import { PriceSchedule, makeSchedule } from '../core/pricing';
import { RATE_CLASSES, RateClass } from '../model/customer';
import { inTransaction } from '../db/connection';

/**
 * Moving the posted price.
 *
 * The price moves for everybody at once, usually because the wholesale cost
 * moved, and it moves by the same amount on every tier. Doing that by hand
 * meant four schedules keyed separately and, twice, one of them keyed wrong,
 * which nobody noticed until a commercial customer worked out that their tier
 * break had gone the wrong way.
 *
 * A change is never applied retroactively. A schedule that is already in force
 * is superseded by a new one with a later date, never edited, so a ticket
 * reprinted next year still shows what was charged.
 */

export interface PriceChange {
  /** Moves every tier by this much. Negative brings the price down. */
  readonly deltaPerGallon: Mills;
  readonly effectiveFrom: DayKey;
  readonly rateClasses?: readonly RateClass[];
  readonly note?: string;
}

export interface ChangedSchedule {
  readonly rateClass: RateClass;
  readonly fromScheduleId: string;
  readonly toScheduleId: string;
  readonly oldTiers: number[];
  readonly newTiers: number[];
}

export interface PriceChangeResult {
  readonly effectiveFrom: DayKey;
  readonly deltaPerGallon: Mills;
  readonly changed: ChangedSchedule[];
  readonly skipped: { rateClass: RateClass; reason: string }[];
}

export interface ImpactEstimate {
  readonly rateClass: RateClass;
  readonly gallonsLastSeason: number;
  /** What the same gallons would have brought in at the new price. */
  readonly annualImpact: Cents;
}

export class PriceChangeService {
  private readonly audit: AuditService;

  constructor(private readonly context: AppContext) {
    this.audit = new AuditService(context);
  }

  apply(change: PriceChange, who: AuditContext = { actor: SYSTEM_ACTOR }): PriceChangeResult {
    const today = currentDay(this.context);
    if (change.effectiveFrom < today) {
      throw new ConflictError('a price change cannot be backdated', {
        effectiveFrom: change.effectiveFrom,
        today,
      });
    }
    const classes = change.rateClasses ?? RATE_CLASSES;
    if (classes.length === 0) {
      throw new InvalidInputError('a price change has to name at least one rate class');
    }

    const changed: ChangedSchedule[] = [];
    const skipped: { rateClass: RateClass; reason: string }[] = [];

    inTransaction(this.context.db, () => {
      for (const rateClass of classes) {
        const current = this.context.pricing.scheduleInForce(rateClass, today);
        if (!current) {
          skipped.push({ rateClass, reason: 'no schedule in force to move' });
          continue;
        }
        // The collision to look for is a schedule that already starts on the
        // effective day, which is not the same thing as the one in force
        // today. Without this a second change keyed for the same day fails at
        // the unique index and takes the whole transaction with it.
        const clash = this.context.pricing
          .listSchedules({ rateClass })
          .some((schedule) => schedule.effectiveFrom === change.effectiveFrom);
        if (clash) {
          skipped.push({
            rateClass,
            reason: `a schedule already starts on ${change.effectiveFrom}`,
          });
          continue;
        }
        const tiers = current.tiers.map((tier) => ({
          fromGallons: tier.fromGallons,
          pricePerGallon: mills(Math.max(1, tier.pricePerGallon + change.deltaPerGallon)),
        }));
        const next: PriceSchedule = makeSchedule({
          id: this.context.ids.next('prc'),
          rateClass,
          effectiveFrom: change.effectiveFrom,
          ...(current.adderPerGallon ? { adderPerGallon: current.adderPerGallon } : {}),
          tiers,
        });
        this.context.pricing.saveSchedule(next, change.note);
        changed.push({
          rateClass,
          fromScheduleId: current.id,
          toScheduleId: next.id,
          oldTiers: current.tiers.map((tier) => tier.pricePerGallon),
          newTiers: tiers.map((tier) => tier.pricePerGallon),
        });
        this.audit.record(who, {
          action: 'price_change',
          subjectKind: 'price',
          subjectId: next.id,
          before: { scheduleId: current.id, tiers: current.tiers.map((t) => t.pricePerGallon) },
          after: { effectiveFrom: change.effectiveFrom, tiers: tiers.map((t) => t.pricePerGallon) },
          ...(change.note ? { note: change.note } : {}),
        });
      }
    });

    this.context.logger.info('moved the posted price', {
      effectiveFrom: change.effectiveFrom,
      delta: change.deltaPerGallon,
      changed: changed.length,
      skipped: skipped.length,
    });
    return {
      effectiveFrom: change.effectiveFrom,
      deltaPerGallon: change.deltaPerGallon,
      changed,
      skipped,
    };
  }

  /**
   * What a change would be worth over a year, using last season's gallons. It
   * is a rough number by construction and the office knows it: it assumes the
   * book neither grows nor shrinks and that nobody switches supplier.
   */
  impact(deltaPerGallon: Mills, season: number): ImpactEstimate[] {
    const bounds = heatingSeasonBounds(season);
    const byClass = new Map<RateClass, number>();
    for (const customer of this.context.customers.list()) {
      const gallons = this.context.deliveries
        .list({ customerId: customer.id, from: bounds.start, to: bounds.end, postedOnly: true })
        .reduce((total, delivery) => total + delivery.net, 0);
      byClass.set(customer.rateClass, (byClass.get(customer.rateClass) ?? 0) + gallons);
    }
    return RATE_CLASSES.map((rateClass) => {
      const gallons = Math.round((byClass.get(rateClass) ?? 0) * 10) / 10;
      return {
        rateClass,
        gallonsLastSeason: gallons,
        annualImpact: cents(
          extend(gallons, mills(Math.abs(deltaPerGallon))) * Math.sign(deltaPerGallon),
        ),
      };
    });
  }

  /** The change the office usually wants: same price, one week out. */
  nextWeek(deltaPerGallon: Mills, who?: AuditContext): PriceChangeResult {
    return this.apply({ deltaPerGallon, effectiveFrom: addDays(currentDay(this.context), 7) }, who);
  }
}
