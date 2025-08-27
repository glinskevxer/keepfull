import { Migration } from '../migrate';

/** Trucks and drivers. Tickets already carried their ids as free text. */
export const migration: Migration = {
  version: 4,
  name: 'trucks and drivers',
  up(db) {
    db.exec(`
      CREATE TABLE trucks (
        id              TEXT PRIMARY KEY,
        unit_number     TEXT NOT NULL UNIQUE,
        kind            TEXT NOT NULL CHECK (kind IN ('bobtail', 'transport', 'service')),
        water_capacity  REAL NOT NULL CHECK (water_capacity > 0),
        fill_limit      REAL NOT NULL CHECK (fill_limit > 0 AND fill_limit <= 90),
        heel_gallons    REAL NOT NULL CHECK (heel_gallons >= 0),
        meter_sealed_on TEXT,
        active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      );

      CREATE TABLE drivers (
        id                       TEXT PRIMARY KEY,
        name                     TEXT NOT NULL,
        licence_number           TEXT NOT NULL UNIQUE,
        endorsements             TEXT NOT NULL DEFAULT '',
        medical_card_expires_on  TEXT,
        active                   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      );

      CREATE INDEX trucks_active ON trucks (active);
      CREATE INDEX drivers_active ON drivers (active);
    `);
  },
};
