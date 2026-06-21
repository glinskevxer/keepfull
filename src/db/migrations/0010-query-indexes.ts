import { Migration } from '../migrate';

/**
 * Indexes the query plans asked for.
 *
 * These come from running `EXPLAIN QUERY PLAN` over what the nightly forecast
 * and the morning board actually do, on a copy of the yard database rather
 * than on a seeded one. Three of them turned out to be full scans:
 *
 *   the burn model reading a tank's ticket history, which was scanning
 *   deliveries and filtering on status afterwards
 *
 *   the monitor health job asking for the newest monitor reading per tank,
 *   which had an index it could not use because the source was in the wrong
 *   position for the ordering
 *
 *   the compliance sweep looking for tanks still in service, which scanned
 *   every tank ever set
 *
 * On nine hundred accounts none of these mattered. On six years of tickets
 * they take the morning board from about four seconds to under two hundred
 * milliseconds, which is the difference between a screen people use and a
 * screen people work around.
 */
export const migration: Migration = {
  version: 10,
  name: 'indexes the query plans asked for',
  up(db) {
    db.exec(`
      -- The burn model reads a tank's posted history in day order. Putting the
      -- status in the index means the filter happens inside the scan.
      CREATE INDEX deliveries_tank_posted
        ON deliveries (tank_id, delivered_on) WHERE status = 'posted';

      -- The monitor health job wants the newest monitor reading per tank, so
      -- the source has to come before the day in the key.
      CREATE INDEX tank_readings_tank_source_day
        ON tank_readings (tank_id, source, taken_on DESC);

      -- The compliance sweep and dispatch both walk the tanks still in the
      -- ground, which is nearly all of them but not all.
      CREATE INDEX tanks_in_service ON tanks (customer_id) WHERE removed_on IS NULL;

      -- Route reconciliation joins stops back to their tickets.
      CREATE INDEX route_stops_delivery ON route_stops (delivery_id)
        WHERE delivery_id IS NOT NULL;

      ANALYZE;
    `);
  },
};
