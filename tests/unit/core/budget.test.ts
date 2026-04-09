import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTALMENTS,
  addMonths,
  buildPlan,
  isRunningShort,
  lateFee,
  progress,
  trueUp,
} from '../../../src/core/budget';
import { cents, parseMills } from '../../../src/util/money';
import { dayKey } from '../../../src/util/dates';

const input = {
  forecastGallons: 900,
  pricePerGallon: parseMills('2.9990'),
  openingBalance: cents(0),
  startOn: dayKey('2025-09-01'),
};

describe('addMonths', () => {
  it('walks forward a month at a time', () => {
    expect(addMonths(dayKey('2025-09-01'), 1)).toBe('2025-10-01');
    expect(addMonths(dayKey('2025-09-01'), 4)).toBe('2026-01-01');
  });

  it('clamps into a short month', () => {
    expect(addMonths(dayKey('2025-01-31'), 1)).toBe('2025-02-28');
    expect(addMonths(dayKey('2024-01-31'), 1)).toBe('2024-02-29');
  });

  it('crosses a year boundary', () => {
    expect(addMonths(dayKey('2025-12-15'), 2)).toBe('2026-02-15');
  });

  it('refuses a fractional month count', () => {
    expect(() => addMonths(dayKey('2025-01-01'), 1.5)).toThrowError(/month count/);
  });
});

describe('buildPlan', () => {
  it('adds a cushion to the forecast', () => {
    expect(buildPlan(input).plannedGallons).toBe(945);
  });

  it('takes a different cushion', () => {
    expect(buildPlan({ ...input, cushionPercent: 0 }).plannedGallons).toBe(900);
  });

  it('splits into eleven payments and a true up', () => {
    const plan = buildPlan(input);
    expect(plan.instalments).toHaveLength(DEFAULT_INSTALMENTS + 1);
    expect(plan.instalments.filter((entry) => entry.isTrueUp)).toHaveLength(1);
    expect(plan.instalments[plan.instalments.length - 1]?.isTrueUp).toBe(true);
  });

  it('makes the payments add back to the total', () => {
    const plan = buildPlan(input);
    const paid = plan.instalments.reduce((total, entry) => total + entry.amount, 0);
    expect(paid).toBe(plan.total);
  });

  it('dates the payments a month apart', () => {
    const plan = buildPlan(input);
    expect(plan.instalments[0]?.dueOn).toBe('2025-09-01');
    expect(plan.instalments[1]?.dueOn).toBe('2025-10-01');
    expect(plan.instalments[11]?.dueOn).toBe('2026-08-01');
  });

  it('rolls an opening balance into the plan', () => {
    const withBalance = buildPlan({ ...input, openingBalance: cents(20_000) });
    expect(withBalance.total).toBe(buildPlan(input).total + 20_000);
  });

  it('takes a credit as an opening balance', () => {
    const withCredit = buildPlan({ ...input, openingBalance: cents(-20_000) });
    expect(withCredit.total).toBeLessThan(buildPlan(input).total);
  });

  it('refuses a plan with nothing to pay', () => {
    expect(() =>
      buildPlan({ ...input, forecastGallons: 1, openingBalance: cents(-100_000) }),
    ).toThrowError(/nothing to pay/);
  });

  it('refuses a forecast of nothing', () => {
    expect(() => buildPlan({ ...input, forecastGallons: 0 })).toThrowError(/forecast gallons/);
  });

  it('refuses an absurd number of instalments', () => {
    expect(() => buildPlan({ ...input, instalments: 0 })).toThrowError(/instalments/);
    expect(() => buildPlan({ ...input, instalments: 40 })).toThrowError(/instalments/);
  });

  it('refuses an absurd cushion', () => {
    expect(() => buildPlan({ ...input, cushionPercent: 90 })).toThrowError(/cushion percent/);
  });
});

describe('trueUp', () => {
  it('is nothing when the year came out as planned', () => {
    const plan = buildPlan({ ...input, cushionPercent: 0 });
    const paid = plan.instalments.reduce((total, entry) => total + entry.amount, 0);
    expect(trueUp(plan, 900, input.pricePerGallon, cents(paid))).toBe(0);
  });

  it('owes the dealer after a cold winter', () => {
    const plan = buildPlan({ ...input, cushionPercent: 0 });
    const paid = plan.instalments.reduce((total, entry) => total + entry.amount, 0);
    expect(trueUp(plan, 1200, input.pricePerGallon, cents(paid))).toBeGreaterThan(0);
  });

  it('refunds after a mild one', () => {
    const plan = buildPlan({ ...input, cushionPercent: 0 });
    const paid = plan.instalments.reduce((total, entry) => total + entry.amount, 0);
    expect(trueUp(plan, 600, input.pricePerGallon, cents(paid))).toBeLessThan(0);
  });

  it('carries the opening balance into the settlement', () => {
    const plan = buildPlan({ ...input, cushionPercent: 0, openingBalance: cents(10_000) });
    expect(trueUp(plan, 900, input.pricePerGallon, cents(0))).toBe(
      trueUp(buildPlan({ ...input, cushionPercent: 0 }), 900, input.pricePerGallon, cents(0)) +
        10_000,
    );
  });
});

describe('progress and isRunningShort', () => {
  const plan = buildPlan(input);

  it('measures payments against the payable instalments only', () => {
    expect(progress(plan, 0)).toBe(0);
    expect(progress(plan, 11)).toBe(1);
    expect(progress(plan, 12)).toBe(1);
  });

  it('is quiet when burn and payments track each other', () => {
    expect(isRunningShort(plan, plan.plannedGallons / 2, 6)).toBe(false);
  });

  it('flags a plan burning faster than it is paying', () => {
    expect(isRunningShort(plan, plan.plannedGallons * 0.9, 6)).toBe(true);
  });

  it('takes a tighter tolerance', () => {
    expect(isRunningShort(plan, plan.plannedGallons * 0.6, 6, 0.01)).toBe(true);
  });

  it('refuses a tolerance that is not a share', () => {
    expect(() => isRunningShort(plan, 100, 1, 2)).toThrowError(/tolerance/);
  });
});

describe('lateFee', () => {
  it('is a percentage of the instalment', () => {
    expect(lateFee(cents(20_000))).toBe(300);
  });

  it('takes a different rate', () => {
    expect(lateFee(cents(20_000), 0)).toBe(0);
  });

  it('refuses a rate nobody would charge', () => {
    expect(() => lateFee(cents(100), 50)).toThrowError(/late fee rate/);
  });
});
