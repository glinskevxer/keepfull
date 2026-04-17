import { AppContext, currentDay } from './context';
import { Cents, Mills, cents } from '../util/money';
import { ConflictError, NotFoundError } from '../core/errors';
import { DayKey, heatingSeason, heatingSeasonBounds } from '../util/dates';
import { ForecastingService } from './forecasting';
import { Plan, buildPlan, isRunningShort, trueUp } from '../core/budget';
import { PricingService } from './pricing';
import { StoredPlan } from '../db/repo/budget-repo';

/**
 * Budget plans for real accounts.
 *
 * The hard part is the forecast the plan is built on. A burn model projects a
 * tank forward from where it stands now, which is the wrong question here: what
 * a plan needs is what the account burns over a whole year, weather included.
 * So the forecast comes from the account's own history over the last two
 * seasons rather than from the projection, and falls back to the burn model
 * only for an account too new to have that.
 */

export interface PlanRequest {
  readonly customerId: string;
  readonly season?: number;
  readonly startOn?: DayKey;
  readonly openingBalance?: Cents;
  readonly cushionPercent?: number;
  readonly instalments?: number;
  /** Overrides the price the plan is built at. Defaults to the posted price. */
  readonly pricePerGallon?: Mills;
}

export interface PlanHealth {
  readonly planId: string;
  readonly customerId: string;
  readonly gallonsBurned: number;
  readonly plannedGallons: number;
  readonly paymentsMade: number;
  readonly paymentsDue: number;
  readonly runningShort: boolean;
  readonly projectedSettlement: Cents;
}

export class BudgetService {
  private readonly forecasting: ForecastingService;
  private readonly pricing: PricingService;

  constructor(private readonly context: AppContext) {
    this.forecasting = new ForecastingService(context);
    this.pricing = new PricingService(context);
  }

  /**
   * Gallons to build a plan on: last season's actual, or the two season mean
   * where both are there, or an annualised burn model where neither is.
   */
  annualGallons(customerId: string, season: number): { gallons: number; basis: string } {
    const seasons = [season - 1, season - 2].map((year) => {
      const bounds = heatingSeasonBounds(year);
      const deliveries = this.context.deliveries.list({
        customerId,
        from: bounds.start,
        to: bounds.end,
        postedOnly: true,
      });
      return deliveries.reduce((total, delivery) => total + delivery.net, 0);
    });
    const [last = 0, previous = 0] = seasons;
    if (last > 0 && previous > 0) {
      return { gallons: round((last + previous) / 2), basis: 'mean of the last two seasons' };
    }
    if (last > 0) {
      return { gallons: round(last), basis: 'last season' };
    }
    const tanks = this.context.tanks.list({ customerId, inServiceOnly: true });
    let modelled = 0;
    for (const tank of tanks) {
      const result = this.forecasting.tryForTank(tank.id);
      if (!result) {
        continue;
      }
      // A season of normals, which is what the burn model would consume over a
      // year rather than over the horizon it happens to be projecting.
      modelled +=
        result.model.baseGallonsPerDay * 365 + result.model.weatherGallonsPerDegreeDay * 6500;
    }
    if (modelled <= 0) {
      throw new NotFoundError('usable burn history for account', customerId);
    }
    return { gallons: round(modelled), basis: 'burn model over a normal year' };
  }

  create(request: PlanRequest): StoredPlan {
    const customer = this.context.customers.get(request.customerId);
    const today = currentDay(this.context);
    const season = request.season ?? heatingSeason(today);
    const startOn = request.startOn ?? heatingSeasonBounds(season).start;
    const { gallons } = this.annualGallons(customer.id, season);

    const priced = this.pricing.priceFor({
      customerId: customer.id,
      gallons,
      on: startOn,
      ignoreLock: true,
    });
    const pricePerGallon = request.pricePerGallon ?? priced.quote.effectivePricePerGallon;

    const plan: Plan = buildPlan({
      forecastGallons: gallons,
      pricePerGallon,
      openingBalance: request.openingBalance ?? cents(0),
      startOn,
      ...(request.cushionPercent === undefined ? {} : { cushionPercent: request.cushionPercent }),
      ...(request.instalments === undefined ? {} : { instalments: request.instalments }),
    });

    const stored = this.context.budgets.create(
      this.context.ids.next('bp'),
      customer.id,
      season,
      pricePerGallon,
      plan,
    );
    this.context.logger.info('opened a budget plan', {
      planId: stored.id,
      customerId: customer.id,
      season,
      monthly: stored.monthlyAmount,
    });
    return stored;
  }

  /** How a live plan is tracking against what the account is actually burning. */
  health(planId: string, on?: DayKey): PlanHealth {
    const plan = this.context.budgets.get(planId);
    const asOf = on ?? currentDay(this.context);
    const bounds = heatingSeasonBounds(plan.season);
    const burned = this.context.deliveries
      .list({ customerId: plan.customerId, from: bounds.start, to: asOf, postedOnly: true })
      .reduce((total, delivery) => total + delivery.net, 0);
    const paymentsMade = plan.instalments.filter((entry) => entry.paidOn !== undefined).length;
    const paymentsDue = plan.instalments.filter(
      (entry) => !entry.isTrueUp && entry.dueOn <= asOf,
    ).length;
    const paid = plan.instalments.reduce((total, entry) => total + (entry.paidAmount ?? 0), 0);
    return {
      planId: plan.id,
      customerId: plan.customerId,
      gallonsBurned: round(burned),
      plannedGallons: plan.plannedGallons,
      paymentsMade,
      paymentsDue,
      runningShort: isRunningShort(toCorePlan(plan), burned, paymentsMade),
      projectedSettlement: trueUp(toCorePlan(plan), burned, plan.pricePerGallon, cents(paid)),
    };
  }

  /** Closes a plan out against what the account actually burned and paid. */
  settle(planId: string, on?: DayKey): { plan: StoredPlan; settlement: Cents } {
    const plan = this.context.budgets.get(planId);
    if (plan.status !== 'open') {
      throw new ConflictError(`plan ${planId} is already ${plan.status}`, { planId });
    }
    const asOf = on ?? currentDay(this.context);
    const health = this.health(planId, asOf);
    const settled = this.context.budgets.settle(planId, asOf, health.projectedSettlement);
    this.context.logger.info('settled a budget plan', {
      planId,
      settlement: health.projectedSettlement,
      gallonsBurned: health.gallonsBurned,
    });
    return { plan: settled, settlement: health.projectedSettlement };
  }

  /** Every open plan that is going to end in a bill nobody expects. */
  atRisk(on?: DayKey): PlanHealth[] {
    const asOf = on ?? currentDay(this.context);
    return this.context.budgets
      .list({ status: 'open' })
      .map((plan) => this.health(plan.id, asOf))
      .filter((health) => health.runningShort)
      .sort((left, right) => right.projectedSettlement - left.projectedSettlement);
  }
}

function toCorePlan(stored: StoredPlan): Plan {
  return {
    forecastGallons: stored.forecastGallons,
    plannedGallons: stored.plannedGallons,
    productCost: cents(stored.total - stored.openingBalance),
    openingBalance: stored.openingBalance,
    total: stored.total,
    monthlyAmount: stored.monthlyAmount,
    instalments: stored.instalments,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
