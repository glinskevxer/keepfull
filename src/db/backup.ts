import { Db, openDatabase } from './connection';
import { MIGRATIONS } from './migrations';
import { currentVersion, readVersion } from './migrate';
import { integrityCheck } from './connection';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Taking a copy of the database, and proving the copy is worth having.
 *
 * A file copy of a live sqlite database is not a backup. If a write lands
 * between the pages being read the copy is torn, and a torn sqlite file usually
 * opens perfectly and only fails when somebody reads the one table that was
 * being written at the time. Which is to say: months later, during an incident.
 *
 * So the copy goes through sqlite's own backup, and then it is opened and
 * checked. A backup nobody has opened is a hope, not a backup.
 */

export interface BackupResult {
  readonly path: string;
  readonly bytes: number;
  readonly schemaVersion: number;
  readonly integrity: string;
  readonly tables: number;
  readonly durationMs: number;
}

export interface VerifyResult {
  readonly path: string;
  readonly ok: boolean;
  readonly integrity: string;
  readonly schemaVersion: number;
  readonly pendingMigrations: number;
  readonly problems: string[];
  readonly counts: Record<string, number>;
}

/** Tables a restored copy has to be able to read before it counts as usable. */
const REQUIRED_TABLES = [
  'customers',
  'tanks',
  'deliveries',
  'tank_readings',
  'stations',
  'observations',
];

export async function backup(db: Db, path: string, now = () => Date.now()): Promise<BackupResult> {
  mkdirSync(dirname(path), { recursive: true });
  const started = now();
  // better-sqlite3's backup runs sqlite's own online backup, which is safe
  // against concurrent writes in a way a file copy is not.
  await db.backup(path);
  const durationMs = now() - started;

  const copy = openDatabase(path, { walMode: false });
  try {
    return {
      path,
      bytes: statSync(path).size,
      schemaVersion: currentVersion(copy),
      integrity: integrityCheck(copy),
      tables: countTables(copy),
      durationMs,
    };
  } finally {
    copy.close();
  }
}

export function verify(path: string): VerifyResult {
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  let integrity = 'unreadable';
  let schemaVersion = 0;
  let pending = MIGRATIONS.length;

  let copy: Db | undefined;
  try {
    copy = openDatabase(path, { readonly: true });
    integrity = integrityCheck(copy);
    if (integrity !== 'ok') {
      problems.push(`integrity check says ${integrity}`);
    }
    schemaVersion = readVersion(copy);
    pending = MIGRATIONS.length - schemaVersion;
    if (pending > 0) {
      problems.push(`${pending} migrations have not been applied to this copy`);
    }
    for (const table of REQUIRED_TABLES) {
      try {
        const row = copy.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get();
        counts[table] = row?.n ?? 0;
      } catch (error) {
        problems.push(`cannot read ${table}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    problems.push(`cannot open the copy: ${(error as Error).message}`);
  } finally {
    copy?.close();
  }

  return {
    path,
    ok: problems.length === 0,
    integrity,
    schemaVersion,
    pendingMigrations: pending,
    problems,
    counts,
  };
}

function countTables(db: Db): number {
  const row = db
    .prepare<
      [],
      { n: number }
    >("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get();
  return row?.n ?? 0;
}
