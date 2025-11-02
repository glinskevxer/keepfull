import { Migration } from '../migrate';

/**
 * Price schedules and the locks customers hold against them.
 *
 * Schedules are never edited, only superseded. The one in force on a day is the
 * newest whose effective date has passed, which means a ticket reprinted two
 * years later still shows the price that was actually charged.
 */
export const migration: Migration = {
  version: 6,
  name: 'price schedules and locks',
  up(db) {
    db.exec(`
      CREATE TABLE price_schedules (
        id                TEXT PRIMARY KEY,
        rate_class        TEXT NOT NULL CHECK (
                            rate_class IN ('residential', 'commercial', 'agricultural', 'resale')),
        effective_from    TEXT NOT NULL,
        adder_per_gallon  INTEGER NOT NULL DEFAULT 0 CHECK (adder_per_gallon >= 0),
        note              TEXT
      );

      CREATE UNIQUE INDEX price_schedules_class_day
        ON price_schedules (rate_class, effective_from);

      CREATE TABLE price_tiers (
        schedule_id      TEXT NOT NULL REFERENCES price_schedules (id) ON DELETE CASCADE,
        from_gallons     REAL NOT NULL CHECK (from_gallons >= 0),
        price_per_gallon INTEGER NOT NULL CHECK (price_per_gallon > 0),
        PRIMARY KEY (schedule_id, from_gallons)
      );

      CREATE TABLE price_locks (
        id                TEXT PRIMARY KEY,
        customer_id       TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
        price_per_gallon  INTEGER NOT NULL CHECK (price_per_gallon > 0),
        gallons_committed REAL NOT NULL CHECK (gallons_committed > 0),
        gallons_used      REAL NOT NULL DEFAULT 0 CHECK (gallons_used >= 0),
        signed_on         TEXT NOT NULL,
        expires_on        TEXT NOT NULL,
        CHECK (gallons_used <= gallons_committed)
      );

      CREATE INDEX price_locks_customer ON price_locks (customer_id, expires_on);
    `);
  },
};
