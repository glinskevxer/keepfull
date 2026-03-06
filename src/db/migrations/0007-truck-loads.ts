import { Migration } from '../migrate';

/**
 * What went onto a truck at the plant, and what its own meter read at each end
 * of the shift.
 *
 * Without this there is no way to tell a meter drifting out of calibration from
 * a driver keying a ticket wrong, because both of them show up the same way in
 * the ticket totals. The plant meter is the independent reading.
 */
export const migration: Migration = {
  version: 7,
  name: 'truck loads and shift meters',
  up(db) {
    db.exec(`
      CREATE TABLE truck_loads (
        id                TEXT PRIMARY KEY,
        truck_id          TEXT NOT NULL REFERENCES trucks (id) ON DELETE RESTRICT,
        driver_id         TEXT REFERENCES drivers (id) ON DELETE SET NULL,
        loaded_on         TEXT NOT NULL,
        sequence          INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
        plant_gallons     REAL NOT NULL CHECK (plant_gallons >= 0),
        plant_temperature REAL NOT NULL,
        meter_start       REAL NOT NULL CHECK (meter_start >= 0),
        meter_end         REAL,
        note              TEXT,
        CHECK (meter_end IS NULL OR meter_end >= meter_start)
      );

      CREATE UNIQUE INDEX truck_loads_shift ON truck_loads (truck_id, loaded_on, sequence);
      CREATE INDEX truck_loads_day ON truck_loads (loaded_on);
    `);
  },
};
