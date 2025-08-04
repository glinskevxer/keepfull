import { Migration } from '../migrate';

/**
 * Tickets and gauge readings.
 *
 * Net gallons are stored alongside gross rather than recomputed on read. The
 * correction table has been revised once and will be again, and a ticket has to
 * keep saying what the customer was billed on the day, not what a later table
 * would say about the same gross and temperature.
 */
export const migration: Migration = {
  version: 3,
  name: 'delivery tickets and gauge readings',
  up(db) {
    db.exec(`
      CREATE TABLE deliveries (
        id                TEXT PRIMARY KEY,
        ticket_number     TEXT NOT NULL UNIQUE,
        customer_id       TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
        tank_id           TEXT NOT NULL REFERENCES tanks (id) ON DELETE RESTRICT,
        delivered_on      TEXT NOT NULL,
        gross_gallons     REAL NOT NULL CHECK (gross_gallons >= 0),
        meter_temperature REAL NOT NULL,
        net_gallons       REAL NOT NULL CHECK (net_gallons >= 0),
        gauge_before      REAL,
        gauge_after       REAL,
        reason            TEXT NOT NULL,
        status            TEXT NOT NULL CHECK (status IN ('posted', 'void')),
        driver_id         TEXT NOT NULL,
        truck_id          TEXT NOT NULL,
        notes             TEXT
      );

      CREATE INDEX deliveries_tank_day ON deliveries (tank_id, delivered_on);
      CREATE INDEX deliveries_customer_day ON deliveries (customer_id, delivered_on);
      CREATE INDEX deliveries_day ON deliveries (delivered_on) WHERE status = 'posted';
      CREATE INDEX deliveries_truck_day ON deliveries (truck_id, delivered_on);

      CREATE TABLE tank_readings (
        id          TEXT PRIMARY KEY,
        tank_id     TEXT NOT NULL REFERENCES tanks (id) ON DELETE CASCADE,
        taken_on    TEXT NOT NULL,
        gauge       REAL NOT NULL CHECK (gauge >= 0 AND gauge <= 100),
        source      TEXT NOT NULL CHECK (source IN ('monitor', 'driver', 'customer', 'estimated')),
        monitor_id  TEXT,
        note        TEXT
      );

      CREATE INDEX tank_readings_tank_day ON tank_readings (tank_id, taken_on DESC);
      CREATE UNIQUE INDEX tank_readings_one_per_source
        ON tank_readings (tank_id, taken_on, source);
    `);
  },
};
