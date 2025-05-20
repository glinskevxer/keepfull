import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One sqlite file per yard.
 *
 * This is a two truck dealer with about nine hundred accounts. The whole
 * dataset is a few tens of megabytes and it is read far more than it is
 * written, so a server database would be three more things to keep running for
 * no benefit. What it does need is durability across a power cut, which is what
 * the write ahead log and the full synchronous setting below are for.
 */

export type Db = Database.Database;

export interface OpenOptions {
  readonly readonly?: boolean;
  /** Turned off in tests, where the file is a temporary one anyway. */
  readonly walMode?: boolean;
  readonly busyTimeoutMs?: number;
}

export function openDatabase(path: string, options: OpenOptions = {}): Db {
  if (path !== ':memory:' && !options.readonly) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, options.readonly ? { readonly: true } : {});
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  if (!options.readonly) {
    if (options.walMode ?? path !== ':memory:') {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('synchronous = FULL');
  }
  return db;
}

export function openMemoryDatabase(): Db {
  return openDatabase(':memory:', { walMode: false });
}

export function closeDatabase(db: Db): void {
  if (db.open) {
    db.close();
  }
}

/**
 * Runs work inside a transaction and rolls it back on anything thrown. Nested
 * calls join the outer transaction rather than opening a second one, which
 * sqlite would refuse.
 */
export function inTransaction<T>(db: Db, work: () => T): T {
  if (db.inTransaction) {
    return work();
  }
  const run = db.transaction(work);
  return run();
}

/** Reclaims space and refreshes the query planner statistics. Run after a purge. */
export function compact(db: Db): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.exec('ANALYZE');
}

export function tableNames(db: Db): string[] {
  const rows = db
    .prepare<
      [],
      { name: string }
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  return rows.map((row) => row.name);
}

export function integrityCheck(db: Db): string {
  const row = db.prepare<[], { integrity_check: string }>('PRAGMA integrity_check').get();
  return row?.integrity_check ?? 'unknown';
}
