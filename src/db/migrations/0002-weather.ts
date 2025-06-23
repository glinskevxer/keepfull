import { Migration } from '../migrate';

/**
 * Weather, kept per station.
 *
 * Daily observations are stored as the high and the low rather than as degree
 * days, because the base temperature is a property of the station and it has
 * been changed once already. Storing the derived number would have meant
 * rewriting six years of rows the day somebody decided the lake shore accounts
 * should sit on a sixty degree base.
 */
export const migration: Migration = {
  version: 2,
  name: 'weather stations and their observations',
  up(db) {
    db.exec(`
      CREATE TABLE stations (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        latitude         REAL NOT NULL,
        longitude        REAL NOT NULL,
        elevation_feet   REAL NOT NULL,
        base_temperature REAL NOT NULL,
        active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      );

      CREATE TABLE observations (
        station_id  TEXT NOT NULL REFERENCES stations (id) ON DELETE CASCADE,
        day         TEXT NOT NULL,
        high_f      REAL NOT NULL,
        low_f       REAL NOT NULL,
        source      TEXT NOT NULL DEFAULT 'nws',
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (station_id, day),
        CHECK (low_f <= high_f)
      );

      CREATE INDEX observations_day ON observations (day);

      CREATE TABLE degree_day_normals (
        station_id  TEXT NOT NULL REFERENCES stations (id) ON DELETE CASCADE,
        month_day   TEXT NOT NULL,
        heating     REAL NOT NULL CHECK (heating >= 0),
        PRIMARY KEY (station_id, month_day)
      );
    `);
  },
};
