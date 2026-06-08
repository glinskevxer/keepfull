import { Db, inTransaction } from './connection';
import { Logger, silentLogger } from '../util/logger';

/**
 * Migrations are numbered typescript modules rather than sql files, because
 * two of them have to walk existing rows and recompute a column, and doing that
 * in sql alone would mean reimplementing the volume correction table inside a
 * trigger.
 *
 * They only ever go forward. There is no down step: on a single file database
 * the recovery from a bad migration is to restore last night's copy, which is
 * both simpler and the thing anybody would actually do at seven in the morning
 * with three trucks waiting.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: Db): void;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: string;
}

const LEDGER_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  )
`;

export function ensureLedger(db: Db): void {
  db.exec(LEDGER_TABLE);
}

export function appliedMigrations(db: Db): AppliedMigration[] {
  ensureLedger(db);
  return db
    .prepare<[], { version: number; name: string; applied_at: string }>(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version',
    )
    .all()
    .map((row) => ({ version: row.version, name: row.name, appliedAt: row.applied_at }));
}

/**
 * The applied version without creating anything, so it can be asked of a
 * read only connection. `currentVersion` creates the ledger table if it is
 * missing, which is right on the live database and wrong on a backup opened
 * read only to be checked.
 */
export function readVersion(db: Db): number {
  const table = db
    .prepare<
      [],
      { name: string }
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) {
    return 0;
  }
  const row = db
    .prepare<
      [],
      { version: number | null }
    >('SELECT max(version) AS version FROM schema_migrations')
    .get();
  return row?.version ?? 0;
}

export function currentVersion(db: Db): number {
  const applied = appliedMigrations(db);
  return applied.length === 0 ? 0 : (applied[applied.length - 1] as AppliedMigration).version;
}

export interface MigrateOptions {
  readonly logger?: Logger;
  readonly now?: () => Date;
  /** Stop after this version rather than running everything. */
  readonly upTo?: number;
}

export function migrate(
  db: Db,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): number[] {
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? (() => new Date());
  ensureLedger(db);

  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  for (let index = 1; index < ordered.length; index += 1) {
    if ((ordered[index] as Migration).version === (ordered[index - 1] as Migration).version) {
      throw new Error(`two migrations both claim version ${(ordered[index] as Migration).version}`);
    }
  }

  const already = new Set(appliedMigrations(db).map((entry) => entry.version));
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  const ran: number[] = [];

  for (const migration of ordered) {
    if (already.has(migration.version)) {
      continue;
    }
    if (options.upTo !== undefined && migration.version > options.upTo) {
      break;
    }
    inTransaction(db, () => {
      migration.up(db);
      record.run(migration.version, migration.name, now().toISOString());
    });
    logger.info('applied migration', { version: migration.version, name: migration.name });
    ran.push(migration.version);
  }
  return ran;
}

/** True when every known migration is in the ledger. */
export function isUpToDate(db: Db, migrations: readonly Migration[]): boolean {
  const already = new Set(appliedMigrations(db).map((entry) => entry.version));
  return migrations.every((migration) => already.has(migration.version));
}

export function pendingMigrations(db: Db, migrations: readonly Migration[]): Migration[] {
  const already = new Set(appliedMigrations(db).map((entry) => entry.version));
  return migrations
    .filter((migration) => !already.has(migration.version))
    .sort((left, right) => left.version - right.version);
}
