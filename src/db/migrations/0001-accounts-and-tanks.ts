import { Migration } from '../migrate';

/**
 * The two tables everything else hangs off. Tanks point at customers and
 * nothing points back, so a tank can move to a different account without
 * rewriting history.
 */
export const migration: Migration = {
  version: 1,
  name: 'accounts and tanks',
  up(db) {
    db.exec(`
      CREATE TABLE customers (
        id              TEXT PRIMARY KEY,
        account_number  TEXT NOT NULL UNIQUE,
        billing_name    TEXT NOT NULL,
        service_name    TEXT NOT NULL,
        address_line1   TEXT NOT NULL,
        address_line2   TEXT,
        town            TEXT NOT NULL,
        county          TEXT NOT NULL,
        postal_code     TEXT NOT NULL,
        latitude        REAL NOT NULL,
        longitude       REAL NOT NULL,
        delivery_mode   TEXT NOT NULL CHECK (delivery_mode IN ('keep_full', 'will_call', 'budget')),
        rate_class      TEXT NOT NULL CHECK (rate_class IN ('residential', 'commercial', 'agricultural', 'resale')),
        station_id      TEXT NOT NULL,
        opened_on       TEXT NOT NULL,
        closed_on       TEXT,
        hold_reason     TEXT
      );

      CREATE INDEX customers_station ON customers (station_id);
      CREATE INDEX customers_mode ON customers (delivery_mode) WHERE closed_on IS NULL;

      CREATE TABLE tanks (
        id                 TEXT PRIMARY KEY,
        customer_id        TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
        serial_number      TEXT NOT NULL UNIQUE,
        water_capacity     INTEGER NOT NULL CHECK (water_capacity > 0),
        owner              TEXT NOT NULL CHECK (owner IN ('company', 'customer')),
        setting            TEXT NOT NULL CHECK (setting IN ('above_ground', 'underground', 'mounded')),
        fill_limit         REAL NOT NULL CHECK (fill_limit > 0 AND fill_limit <= 90),
        reserve_percent    REAL NOT NULL CHECK (reserve_percent >= 0),
        appliances         TEXT NOT NULL DEFAULT '',
        installed_on       TEXT NOT NULL,
        removed_on         TEXT,
        monitor_id         TEXT,
        last_leak_check_on TEXT,
        notes              TEXT,
        CHECK (reserve_percent < fill_limit)
      );

      CREATE INDEX tanks_customer ON tanks (customer_id);
      CREATE UNIQUE INDEX tanks_monitor ON tanks (monitor_id) WHERE monitor_id IS NOT NULL;
    `);
  },
};
