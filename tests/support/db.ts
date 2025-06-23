import { Db, closeDatabase, openMemoryDatabase } from '../../src/db/connection';
import { MIGRATIONS } from '../../src/db/migrations';
import { migrate } from '../../src/db/migrate';

const open: Db[] = [];

/** A migrated in memory database, torn down by `closeTestDatabases`. */
export function testDatabase(): Db {
  const db = openMemoryDatabase();
  migrate(db, MIGRATIONS);
  open.push(db);
  return db;
}

export function closeTestDatabases(): void {
  while (open.length > 0) {
    closeDatabase(open.pop() as Db);
  }
}
