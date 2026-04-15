import { Cents, Mills, cents, mills } from '../../util/money';
import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey, dayKey } from '../../util/dates';
import { Db, inTransaction } from '../connection';
import { Instalment, Plan } from '../../core/budget';
import { WhereClause } from '../query';

export type PlanStatus = 'open' | 'settled' | 'cancelled';

export interface StoredInstalment extends Instalment {
  readonly paidOn?: DayKey;
  readonly paidAmount?: Cents;
}

export interface StoredPlan {
  readonly id: string;
  readonly customerId: string;
  readonly season: number;
  readonly forecastGallons: number;
  readonly plannedGallons: number;
  readonly pricePerGallon: Mills;
  readonly openingBalance: Cents;
  readonly total: Cents;
  readonly monthlyAmount: Cents;
  readonly startOn: DayKey;
  readonly status: PlanStatus;
  readonly settledOn?: DayKey;
  readonly settlement?: Cents;
  readonly instalments: StoredInstalment[];
}

interface PlanRow {
  id: string;
  customer_id: string;
  season: number;
  forecast_gallons: number;
  planned_gallons: number;
  price_per_gallon: number;
  opening_balance: number;
  total_cents: number;
  monthly_cents: number;
  start_on: string;
  status: string;
  settled_on: string | null;
  settlement_cents: number | null;
}

interface InstalmentRow {
  number: number;
  due_on: string;
  amount_cents: number;
  is_true_up: number;
  paid_on: string | null;
  paid_cents: number | null;
}

/**
 * Plans and their instalments. The schedule is written once with the plan and
 * only ever updated to mark a payment, because it is what the customer signed.
 */
export class BudgetRepository {
  constructor(private readonly db: Db) {}

  create(
    id: string,
    customerId: string,
    season: number,
    pricePerGallon: Mills,
    plan: Plan,
  ): StoredPlan {
    inTransaction(this.db, () => {
      try {
        this.db
          .prepare(
            `INSERT INTO budget_plans (id, customer_id, season, forecast_gallons, planned_gallons,
               price_per_gallon, opening_balance, total_cents, monthly_cents, start_on, status)
             VALUES (@id, @customerId, @season, @forecastGallons, @plannedGallons,
               @pricePerGallon, @openingBalance, @total, @monthly, @startOn, 'open')`,
          )
          .run({
            id,
            customerId,
            season,
            forecastGallons: plan.forecastGallons,
            plannedGallons: plan.plannedGallons,
            pricePerGallon,
            openingBalance: plan.openingBalance,
            total: plan.total,
            monthly: plan.monthlyAmount,
            startOn: plan.instalments[0]?.dueOn ?? '',
          });
      } catch (error) {
        if (String(error).includes('UNIQUE')) {
          throw new ConflictError(`that account already has a ${season} plan`, {
            customerId,
            season,
          });
        }
        throw error;
      }
      const insert = this.db.prepare(
        `INSERT INTO budget_instalments (plan_id, number, due_on, amount_cents, is_true_up)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const instalment of plan.instalments) {
        insert.run(
          id,
          instalment.number,
          instalment.dueOn,
          instalment.amount,
          instalment.isTrueUp ? 1 : 0,
        );
      }
    });
    return this.get(id);
  }

  private instalmentsFor(planId: string): StoredInstalment[] {
    return this.db
      .prepare<[string], InstalmentRow>(
        'SELECT * FROM budget_instalments WHERE plan_id = ? ORDER BY number',
      )
      .all(planId)
      .map((row) => ({
        number: row.number,
        dueOn: dayKey(row.due_on),
        amount: cents(row.amount_cents),
        isTrueUp: row.is_true_up === 1,
        ...(row.paid_on ? { paidOn: dayKey(row.paid_on) } : {}),
        ...(row.paid_cents === null ? {} : { paidAmount: cents(row.paid_cents) }),
      }));
  }

  private toPlan(row: PlanRow): StoredPlan {
    return {
      id: row.id,
      customerId: row.customer_id,
      season: row.season,
      forecastGallons: row.forecast_gallons,
      plannedGallons: row.planned_gallons,
      pricePerGallon: mills(row.price_per_gallon),
      openingBalance: cents(row.opening_balance),
      total: cents(row.total_cents),
      monthlyAmount: cents(row.monthly_cents),
      startOn: dayKey(row.start_on),
      status: row.status as PlanStatus,
      ...(row.settled_on ? { settledOn: dayKey(row.settled_on) } : {}),
      ...(row.settlement_cents === null ? {} : { settlement: cents(row.settlement_cents) }),
      instalments: this.instalmentsFor(row.id),
    };
  }

  find(id: string): StoredPlan | undefined {
    const row = this.db
      .prepare<[string], PlanRow>('SELECT * FROM budget_plans WHERE id = ?')
      .get(id);
    return row ? this.toPlan(row) : undefined;
  }

  get(id: string): StoredPlan {
    const plan = this.find(id);
    if (!plan) {
      throw new NotFoundError('budget plan', id);
    }
    return plan;
  }

  list(query: { customerId?: string; season?: number; status?: PlanStatus } = {}): StoredPlan[] {
    const where = new WhereClause()
      .eq('customer_id', 'customerId', query.customerId)
      .eq('season', 'season', query.season)
      .eq('status', 'status', query.status);
    return this.db
      .prepare<Record<string, unknown>, PlanRow>(
        `SELECT * FROM budget_plans ${where.sql} ORDER BY season DESC, customer_id`,
      )
      .all(where.bind())
      .map((row) => this.toPlan(row));
  }

  recordPayment(planId: string, number: number, on: DayKey, amount: Cents): StoredPlan {
    const result = this.db
      .prepare(
        `UPDATE budget_instalments SET paid_on = ?, paid_cents = ?
          WHERE plan_id = ? AND number = ? AND paid_on IS NULL`,
      )
      .run(on, amount, planId, number);
    if (result.changes === 0) {
      throw new ConflictError(`instalment ${number} on ${planId} is missing or already paid`, {
        planId,
        number,
      });
    }
    return this.get(planId);
  }

  settle(planId: string, on: DayKey, settlement: Cents): StoredPlan {
    const plan = this.get(planId);
    if (plan.status !== 'open') {
      throw new ConflictError(`plan ${planId} is already ${plan.status}`, { planId });
    }
    this.db
      .prepare(
        "UPDATE budget_plans SET status = 'settled', settled_on = ?, settlement_cents = ? WHERE id = ?",
      )
      .run(on, settlement, planId);
    return this.get(planId);
  }

  cancel(planId: string): StoredPlan {
    const plan = this.get(planId);
    if (plan.status !== 'open') {
      throw new ConflictError(`plan ${planId} is already ${plan.status}`, { planId });
    }
    this.db.prepare("UPDATE budget_plans SET status = 'cancelled' WHERE id = ?").run(planId);
    return this.get(planId);
  }

  /** Instalments due on or before a day that nobody has paid. */
  overdue(on: DayKey): { planId: string; customerId: string; instalment: StoredInstalment }[] {
    const rows = this.db
      .prepare<[string], InstalmentRow & { plan_id: string; customer_id: string }>(
        `SELECT i.*, p.customer_id FROM budget_instalments i
           JOIN budget_plans p ON p.id = i.plan_id
          WHERE i.paid_on IS NULL AND i.due_on <= ? AND p.status = 'open' AND i.is_true_up = 0
          ORDER BY i.due_on, p.customer_id`,
      )
      .all(on);
    return rows.map((row) => ({
      planId: row.plan_id,
      customerId: row.customer_id,
      instalment: {
        number: row.number,
        dueOn: dayKey(row.due_on),
        amount: cents(row.amount_cents),
        isTrueUp: row.is_true_up === 1,
      },
    }));
  }
}
