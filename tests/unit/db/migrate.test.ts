import { afterEach, describe, expect, it } from 'vitest';
import {
  Db,
  closeDatabase,
  compact,
  inTransaction,
  integrityCheck,
  openMemoryDatabase,
  tableNames,
} from '../../../src/db/connection';
import {
  Migration,
  appliedMigrations,
  currentVersion,
  isUpToDate,
  migrate,
  pendingMigrations,
  readVersion,
} from '../../../src/db/migrate';
import { MIGRATIONS } from '../../../src/db/migrations';
import { MemorySink, Logger } from '../../../src/util/logger';

const open: Db[] = [];

function db(): Db {
  const connection = openMemoryDatabase();
  open.push(connection);
  return connection;
}

afterEach(() => {
  while (open.length > 0) {
    closeDatabase(open.pop() as Db);
  }
});

function fake(version: number, table: string): Migration {
  return {
    version,
    name: `creates ${table}`,
    up(connection) {
      connection.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
    },
  };
}

describe('openDatabase', () => {
  it('turns foreign keys on', () => {
    expect(db().pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('comes up healthy', () => {
    expect(integrityCheck(db())).toBe('ok');
  });

  it('is safe to close twice', () => {
    const connection = openMemoryDatabase();
    closeDatabase(connection);
    expect(() => closeDatabase(connection)).not.toThrow();
  });
});

describe('inTransaction', () => {
  it('commits on success', () => {
    const connection = db();
    connection.exec('CREATE TABLE t (a TEXT)');
    inTransaction(connection, () => {
      connection.prepare('INSERT INTO t VALUES (?)').run('x');
    });
    expect(connection.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 1 });
  });

  it('rolls back on a throw', () => {
    const connection = db();
    connection.exec('CREATE TABLE t (a TEXT)');
    expect(() =>
      inTransaction(connection, () => {
        connection.prepare('INSERT INTO t VALUES (?)').run('x');
        throw new Error('nope');
      }),
    ).toThrowError('nope');
    expect(connection.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
  });

  it('joins an outer transaction rather than opening a second', () => {
    const connection = db();
    connection.exec('CREATE TABLE t (a TEXT)');
    inTransaction(connection, () => {
      inTransaction(connection, () => {
        connection.prepare('INSERT INTO t VALUES (?)').run('x');
      });
    });
    expect(connection.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 1 });
  });
});

describe('migrate', () => {
  it('runs everything on an empty database', () => {
    const connection = db();
    const ran = migrate(connection, [fake(1, 'a'), fake(2, 'b')]);
    expect(ran).toEqual([1, 2]);
    expect(tableNames(connection)).toEqual(['a', 'b', 'schema_migrations']);
  });

  it('is idempotent', () => {
    const connection = db();
    const migrations = [fake(1, 'a'), fake(2, 'b')];
    migrate(connection, migrations);
    expect(migrate(connection, migrations)).toEqual([]);
  });

  it('runs them in version order however they arrive', () => {
    const connection = db();
    expect(migrate(connection, [fake(3, 'c'), fake(1, 'a'), fake(2, 'b')])).toEqual([1, 2, 3]);
  });

  it('picks up a migration added later', () => {
    const connection = db();
    migrate(connection, [fake(1, 'a')]);
    expect(migrate(connection, [fake(1, 'a'), fake(2, 'b')])).toEqual([2]);
  });

  it('stops where it is told to', () => {
    const connection = db();
    expect(migrate(connection, [fake(1, 'a'), fake(2, 'b')], { upTo: 1 })).toEqual([1]);
    expect(currentVersion(connection)).toBe(1);
  });

  it('refuses two migrations claiming the same version', () => {
    expect(() => migrate(db(), [fake(1, 'a'), fake(1, 'b')])).toThrowError(/both claim version 1/);
  });

  it('rolls back a migration that throws partway', () => {
    const connection = db();
    const broken: Migration = {
      version: 2,
      name: 'broken',
      up(inner) {
        inner.exec('CREATE TABLE half (id TEXT)');
        inner.exec('THIS IS NOT SQL');
      },
    };
    expect(() => migrate(connection, [fake(1, 'a'), broken])).toThrowError();
    expect(tableNames(connection)).not.toContain('half');
    expect(currentVersion(connection)).toBe(1);
  });

  it('records what it applied and when', () => {
    const connection = db();
    migrate(connection, [fake(1, 'a')], { now: () => new Date('2025-05-20T10:00:00Z') });
    expect(appliedMigrations(connection)).toEqual([
      { version: 1, name: 'creates a', appliedAt: '2025-05-20T10:00:00.000Z' },
    ]);
  });

  it('says so in the log', () => {
    const sink = new MemorySink();
    migrate(db(), [fake(1, 'a')], { logger: new Logger({ sink, level: 'debug' }) });
    expect(sink.messages()).toEqual(['applied migration']);
  });
});

describe('version reporting', () => {
  it('starts at zero', () => {
    expect(currentVersion(db())).toBe(0);
  });

  it('reads the version without creating the ledger', () => {
    const connection = db();
    expect(readVersion(connection)).toBe(0);
    expect(tableNames(connection)).not.toContain('schema_migrations');
    migrate(connection, [fake(1, 'a'), fake(2, 'b')]);
    expect(readVersion(connection)).toBe(2);
  });

  it('knows what is still pending', () => {
    const connection = db();
    const migrations = [fake(1, 'a'), fake(2, 'b')];
    migrate(connection, migrations, { upTo: 1 });
    expect(pendingMigrations(connection, migrations).map((m) => m.version)).toEqual([2]);
    expect(isUpToDate(connection, migrations)).toBe(false);
    migrate(connection, migrations);
    expect(isUpToDate(connection, migrations)).toBe(true);
  });
});

describe('the real migrations', () => {
  it('build the schema', () => {
    const connection = db();
    migrate(connection, MIGRATIONS);
    expect(tableNames(connection)).toContain('customers');
    expect(tableNames(connection)).toContain('tanks');
    expect(integrityCheck(connection)).toBe('ok');
  });

  it('refuse a tank whose reserve is above its filling limit', () => {
    const connection = db();
    migrate(connection, MIGRATIONS);
    expect(() =>
      connection
        .prepare(
          `INSERT INTO tanks (id, customer_id, serial_number, water_capacity, owner, setting,
            fill_limit, reserve_percent, installed_on)
           VALUES ('t-1', 'c-1', 'S-1', 500, 'company', 'above_ground', 80, 90, '2020-01-01')`,
        )
        .run(),
    ).toThrowError();
  });

  it('survive a compaction', () => {
    const connection = db();
    migrate(connection, MIGRATIONS);
    expect(() => compact(connection)).not.toThrow();
    expect(tableNames(connection)).toContain('tanks');
  });
});
