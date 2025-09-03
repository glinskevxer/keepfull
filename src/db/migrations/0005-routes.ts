import { Migration } from '../migrate';

/**
 * Routes and their stops. The planned gallons on a stop are frozen at the
 * moment the sheet was printed, which is the only way tonight's reconciliation
 * can say anything about how good the plan was.
 */
export const migration: Migration = {
  version: 5,
  name: 'routes and stops',
  up(db) {
    db.exec(`
      CREATE TABLE routes (
        id              TEXT PRIMARY KEY,
        truck_id        TEXT NOT NULL REFERENCES trucks (id) ON DELETE RESTRICT,
        driver_id       TEXT REFERENCES drivers (id) ON DELETE SET NULL,
        run_on          TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (
                          status IN ('planned', 'released', 'in_progress', 'closed', 'cancelled')),
        planned_gallons REAL NOT NULL DEFAULT 0 CHECK (planned_gallons >= 0),
        planned_miles   REAL NOT NULL DEFAULT 0 CHECK (planned_miles >= 0)
      );

      CREATE INDEX routes_day ON routes (run_on);
      CREATE UNIQUE INDEX routes_truck_day ON routes (truck_id, run_on)
        WHERE status <> 'cancelled';

      CREATE TABLE route_stops (
        id              TEXT PRIMARY KEY,
        route_id        TEXT NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
        tank_id         TEXT NOT NULL REFERENCES tanks (id) ON DELETE RESTRICT,
        customer_id     TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
        position        INTEGER NOT NULL CHECK (position > 0),
        planned_gallons REAL NOT NULL CHECK (planned_gallons >= 0),
        outcome         TEXT NOT NULL CHECK (
                          outcome IN ('pending', 'delivered', 'no_access', 'not_needed', 'skipped')),
        delivery_id     TEXT REFERENCES deliveries (id) ON DELETE SET NULL,
        note            TEXT
      );

      CREATE UNIQUE INDEX route_stops_position ON route_stops (route_id, position);
      CREATE UNIQUE INDEX route_stops_tank ON route_stops (route_id, tank_id);
      CREATE INDEX route_stops_outcome ON route_stops (outcome) WHERE outcome = 'pending';
    `);
  },
};
