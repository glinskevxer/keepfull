import { afterEach, describe, expect, it } from 'vitest';
import { BudgetRepository } from '../../../src/db/repo/budget-repo';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { aCustomer } from '../../support/fixtures';
import { buildPlan } from '../../../src/core/budget';
import { cents, parseMills } from '../../../src/util/money';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

const price = parseMills('2.9990');

function setup() {
  const db = testDatabase();
  const customer = aCustomer();
  new CustomerRepository(db).insert(customer);
  return { budgets: new BudgetRepository(db), customer, db };
}

function plan() {
  return buildPlan({
    forecastGallons: 900,
    pricePerGallon: price,
    openingBalance: cents(0),
    startOn: dayKey('2025-09-01'),
  });
}

describe('create', () => {
  it('stores the plan with its schedule', () => {
    const { budgets, customer } = setup();
    const stored = budgets.create('bp-1', customer.id, 2025, price, plan());
    expect(stored.instalments).toHaveLength(12);
    expect(stored.status).toBe('open');
    expect(stored.startOn).toBe('2025-09-01');
  });

  it('keeps the amounts adding back to the total', () => {
    const { budgets, customer } = setup();
    const stored = budgets.create('bp-1', customer.id, 2025, price, plan());
    const total = stored.instalments.reduce((sum, entry) => sum + entry.amount, 0);
    expect(total).toBe(stored.total);
  });

  it('refuses a second plan for the same season', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    expect(() => budgets.create('bp-2', customer.id, 2025, price, plan())).toThrowError(
      /already has a 2025 plan/,
    );
  });

  it('allows a plan for the next season', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    expect(() => budgets.create('bp-2', customer.id, 2026, price, plan())).not.toThrow();
  });

  it('allows a new plan once the old one is cancelled', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.cancel('bp-1');
    expect(() => budgets.create('bp-2', customer.id, 2025, price, plan())).not.toThrow();
  });

  it('throws for a plan it does not hold', () => {
    expect(() => setup().budgets.get('bp-9')).toThrowError(/no budget plan with id/);
  });
});

describe('payments', () => {
  it('records one against an instalment', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    const after = budgets.recordPayment('bp-1', 1, dayKey('2025-09-03'), cents(24_500));
    expect(after.instalments[0]?.paidOn).toBe('2025-09-03');
    expect(after.instalments[0]?.paidAmount).toBe(24_500);
  });

  it('refuses to pay the same instalment twice', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.recordPayment('bp-1', 1, dayKey('2025-09-03'), cents(24_500));
    expect(() => budgets.recordPayment('bp-1', 1, dayKey('2025-09-04'), cents(1))).toThrowError(
      /missing or already paid/,
    );
  });

  it('refuses an instalment that is not on the plan', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    expect(() => budgets.recordPayment('bp-1', 99, dayKey('2025-09-03'), cents(1))).toThrowError(
      /missing or already paid/,
    );
  });
});

describe('overdue', () => {
  it('finds what has come due and not been paid', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    const overdue = budgets.overdue(dayKey('2025-11-15'));
    expect(overdue.map((entry) => entry.instalment.number)).toEqual([1, 2, 3]);
  });

  it('leaves out what has been paid', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.recordPayment('bp-1', 1, dayKey('2025-09-03'), cents(24_500));
    expect(budgets.overdue(dayKey('2025-11-15')).map((e) => e.instalment.number)).toEqual([2, 3]);
  });

  it('never counts the true up as overdue', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    expect(budgets.overdue(dayKey('2027-01-01')).some((entry) => entry.instalment.isTrueUp)).toBe(
      false,
    );
  });

  it('leaves out a cancelled plan', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.cancel('bp-1');
    expect(budgets.overdue(dayKey('2025-11-15'))).toEqual([]);
  });
});

describe('settling and cancelling', () => {
  it('settles with an amount', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    const settled = budgets.settle('bp-1', dayKey('2026-08-01'), cents(-4200));
    expect(settled.status).toBe('settled');
    expect(settled.settlement).toBe(-4200);
  });

  it('refuses to settle twice', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.settle('bp-1', dayKey('2026-08-01'), cents(0));
    expect(() => budgets.settle('bp-1', dayKey('2026-08-02'), cents(0))).toThrowError(
      /already settled/,
    );
  });

  it('refuses to cancel a settled plan', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.settle('bp-1', dayKey('2026-08-01'), cents(0));
    expect(() => budgets.cancel('bp-1')).toThrowError(/already settled/);
  });

  it('lists by customer, season and status', () => {
    const { budgets, customer } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    budgets.create('bp-2', customer.id, 2026, price, plan());
    expect(budgets.list({ customerId: customer.id })).toHaveLength(2);
    expect(budgets.list({ season: 2026 })).toHaveLength(1);
    expect(budgets.list({ status: 'open' })).toHaveLength(2);
  });

  it('takes the instalments with the account when it goes', () => {
    const { budgets, customer, db } = setup();
    budgets.create('bp-1', customer.id, 2025, price, plan());
    new CustomerRepository(db).delete(customer.id);
    expect(budgets.find('bp-1')).toBeUndefined();
  });
});
