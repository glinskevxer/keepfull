import { Migration } from '../migrate';

/**
 * Budget plans and the payments against them.
 *
 * The instalment schedule is stored rather than recomputed, because it is what
 * the customer signed. Rebuilding it from the plan terms would quietly move
 * every due date the day somebody changed how months are counted.
 */
export const migration: Migration = {
  version: 8,
  name: 'budget plans',
  up(db) {
    db.exec(`
      CREATE TABLE budget_plans (
        id                 TEXT PRIMARY KEY,
        customer_id        TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
        season             INTEGER NOT NULL,
        forecast_gallons   REAL NOT NULL CHECK (forecast_gallons > 0),
        planned_gallons    REAL NOT NULL CHECK (planned_gallons > 0),
        price_per_gallon   INTEGER NOT NULL CHECK (price_per_gallon > 0),
        opening_balance    INTEGER NOT NULL DEFAULT 0,
        total_cents        INTEGER NOT NULL CHECK (total_cents > 0),
        monthly_cents      INTEGER NOT NULL CHECK (monthly_cents > 0),
        start_on           TEXT NOT NULL,
        status             TEXT NOT NULL CHECK (status IN ('open', 'settled', 'cancelled')),
        settled_on         TEXT,
        settlement_cents   INTEGER
      );

      CREATE UNIQUE INDEX budget_plans_season ON budget_plans (customer_id, season)
        WHERE status <> 'cancelled';

      CREATE TABLE budget_instalments (
        plan_id      TEXT NOT NULL REFERENCES budget_plans (id) ON DELETE CASCADE,
        number       INTEGER NOT NULL CHECK (number > 0),
        due_on       TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        is_true_up   INTEGER NOT NULL DEFAULT 0 CHECK (is_true_up IN (0, 1)),
        paid_on      TEXT,
        paid_cents   INTEGER,
        PRIMARY KEY (plan_id, number)
      );

      CREATE INDEX budget_instalments_due ON budget_instalments (due_on) WHERE paid_on IS NULL;
    `);
  },
};
