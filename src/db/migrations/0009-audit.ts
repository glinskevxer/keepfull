import { Migration } from '../migrate';

/**
 * Who changed what.
 *
 * This exists for one reason: a customer disputed a fill and the only record of
 * the ticket having been edited was that the number was different from what
 * they had written down. There was no way to say whether it had been keyed
 * wrong, corrected, or altered, and no way to say by whom.
 *
 * It is append only. Nothing in the application updates or deletes a row here,
 * and the retention job leaves it alone.
 */
export const migration: Migration = {
  version: 9,
  name: 'audit trail',
  up(db) {
    db.exec(`
      CREATE TABLE audit_entries (
        id          TEXT PRIMARY KEY,
        at          TEXT NOT NULL,
        actor       TEXT NOT NULL,
        action      TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id  TEXT NOT NULL,
        request_id  TEXT,
        before_json TEXT,
        after_json  TEXT,
        note        TEXT
      );

      CREATE INDEX audit_subject ON audit_entries (subject_kind, subject_id, at);
      CREATE INDEX audit_at ON audit_entries (at);
      CREATE INDEX audit_actor ON audit_entries (actor, at);
    `);
  },
};
