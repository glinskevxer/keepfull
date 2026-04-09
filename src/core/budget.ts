import { Cents, Mills, allocate, cents, extend, percentOf } from '../util/money';
import { DayKey, month } from '../util/dates';
import { InvalidInputError } from './errors';
import { assertInRange, assertInteger, assertPositive } from '../util/assert';

/**
 * Levelised payment plans.
 *
 * A customer on a budget plan pays the same amount every month rather than four
 * hundred dollars in January and nothing in July. The dealer works out what
 * they are likely to burn over the year, prices it, divides by eleven, and
 * settles up in the twelfth month.
 *
 * Eleven and not twelve, deliberately. The twelfth month is the true up, and
 * making it the twelfth payment rather than a thirteenth is what stops the
 * plan ending with a bill the customer did not expect. Everyone in this trade
 * who levels over twelve months spends every August explaining a settlement.
 */

export interface PlanInput {
  /** Gallons the customer is expected to burn over the plan year. */
  readonly forecastGallons: number;
  readonly pricePerGallon: Mills;
  /** Where the account stands the day the plan starts. Negative is a credit. */
  readonly openingBalance: Cents;
  readonly startOn: DayKey;
  /** Payments before the true up. Eleven unless somebody has a reason. */
  readonly instalments?: number;
  /** Added to the forecast to stop a cold winter blowing the plan up. */
  readonly cushionPercent?: number;
}

export interface Instalment {
  readonly number: number;
  readonly dueOn: DayKey;
  readonly amount: Cents;
  readonly isTrueUp: boolean;
}

export interface Plan {
  readonly forecastGallons: number;
  readonly plannedGallons: number;
  readonly productCost: Cents;
  readonly openingBalance: Cents;
  readonly total: Cents;
  readonly monthlyAmount: Cents;
  readonly instalments: Instalment[];
}

export const DEFAULT_INSTALMENTS = 11;
export const DEFAULT_CUSHION_PERCENT = 5;

export function buildPlan(input: PlanInput): Plan {
  assertPositive(input.forecastGallons, 'forecast gallons');
  const instalments = input.instalments ?? DEFAULT_INSTALMENTS;
  assertInteger(instalments, 'instalments');
  assertInRange(instalments, 1, 24, 'instalments');
  const cushion = input.cushionPercent ?? DEFAULT_CUSHION_PERCENT;
  assertInRange(cushion, 0, 50, 'cushion percent');

  const plannedGallons = Math.round(input.forecastGallons * (1 + cushion / 100) * 10) / 10;
  const productCost = extend(plannedGallons, input.pricePerGallon);
  const total = cents(productCost + input.openingBalance);
  if (total <= 0) {
    throw new InvalidInputError('a plan with nothing to pay is not a plan', {
      total,
      plannedGallons,
    });
  }

  const parts = allocate(total, instalments);
  const schedule: Instalment[] = parts.map((amount, index) => ({
    number: index + 1,
    dueOn: addMonths(input.startOn, index),
    amount,
    isTrueUp: false,
  }));
  schedule.push({
    number: instalments + 1,
    dueOn: addMonths(input.startOn, instalments),
    amount: cents(0),
    isTrueUp: true,
  });

  return {
    forecastGallons: input.forecastGallons,
    plannedGallons,
    productCost,
    openingBalance: input.openingBalance,
    total,
    monthlyAmount: parts[0] as Cents,
    instalments: schedule,
  };
}

/**
 * What the true up comes to once the year is done. Positive is owed to the
 * dealer, negative is a refund.
 */
export function trueUp(
  plan: Plan,
  actualGallons: number,
  actualPricePerGallon: Mills,
  paidToDate: Cents,
): Cents {
  assertInRange(actualGallons, 0, 1_000_000, 'actual gallons');
  const owed = extend(actualGallons, actualPricePerGallon) + plan.openingBalance;
  return cents(owed - paidToDate);
}

/** How far through the plan a payment count is, as a share. */
export function progress(plan: Plan, paymentsMade: number): number {
  const payable = plan.instalments.filter((instalment) => !instalment.isTrueUp).length;
  return payable === 0 ? 1 : Math.min(1, Math.max(0, paymentsMade / payable));
}

/**
 * Whether a plan is running short. A plan that is two thirds paid but has
 * already burned ninety percent of its gallons is going to end in a
 * settlement, and telling the customer in January is a different conversation
 * from telling them in August.
 */
export function isRunningShort(
  plan: Plan,
  gallonsBurned: number,
  paymentsMade: number,
  tolerance = 0.1,
): boolean {
  assertInRange(tolerance, 0, 1, 'tolerance');
  const burnShare = plan.plannedGallons === 0 ? 0 : gallonsBurned / plan.plannedGallons;
  return burnShare - progress(plan, paymentsMade) > tolerance;
}

/** A late fee on an overdue instalment, which the plan terms allow monthly. */
export function lateFee(amount: Cents, ratePercent = 1.5): Cents {
  assertInRange(ratePercent, 0, 10, 'late fee rate');
  return percentOf(amount, ratePercent);
}

/** Adds calendar months, clamping to the end of a short month. */
export function addMonths(day: DayKey, count: number): DayKey {
  assertInteger(count, 'month count');
  const [year, monthPart, dayPart] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, monthPart - 1 + count, 1));
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(dayPart, daysInTarget));
  const result = target.toISOString().slice(0, 10) as DayKey;
  // A plan that starts on the thirty first must not walk backwards through
  // February, so the clamp above is checked rather than trusted.
  if (month(result) !== ((monthPart - 1 + count) % 12) + 1 && count >= 0) {
    throw new Error(`adding ${count} months to ${day} landed on ${result}`);
  }
  return result;
}
