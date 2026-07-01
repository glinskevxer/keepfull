import { Migration } from '../migrate';

/**
 * Who to ring, and about what.
 *
 * Accounts had a single phone number, which was fine until the first farm where
 * the person who pays the bill lives four hundred miles away and the person who
 * needs to know the truck is coming is the one who has to unchain the gate.
 * Ringing the wrong one is how a driver ends up parked outside a locked yard.
 */
export const migration: Migration = {
  version: 11,
  name: 'account contacts',
  up(db) {
    db.exec(`
      CREATE TABLE contacts (
        id           TEXT PRIMARY KEY,
        customer_id  TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        role         TEXT NOT NULL CHECK (role IN ('billing', 'site', 'emergency', 'other')),
        phone        TEXT,
        email        TEXT,
        notes        TEXT,
        active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        CHECK (phone IS NOT NULL OR email IS NOT NULL)
      );

      CREATE INDEX contacts_customer ON contacts (customer_id, role);
      CREATE UNIQUE INDEX contacts_one_primary_per_role
        ON contacts (customer_id, role) WHERE active = 1;
    `);
  },
};
