import { afterEach, describe, expect, it } from 'vitest';
import { backup, verify } from '../../../src/db/backup';
import { buildContext } from '../../../src/service/context';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { Logger, MemorySink } from '../../../src/util/logger';
import { aCustomer } from '../../support/fixtures';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryDatabase } from '../../../src/db/connection';
import { tmpdir } from 'node:os';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
  closeTestDatabases();
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-backup-'));
  dirs.push(dir);
  return dir;
}

function setup() {
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink: new MemorySink(), level: 'error' }),
  });
  context.customers.insert(aCustomer());
  return context;
}

describe('backup', () => {
  it('writes a copy and reports on it', async () => {
    const context = setup();
    const path = join(workspace(), 'nested', 'copy.db');
    const result = await backup(context.db, path);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.integrity).toBe('ok');
    expect(result.schemaVersion).toBeGreaterThan(0);
    expect(result.tables).toBeGreaterThan(5);
  });

  it('makes the directory if it is not there', async () => {
    const context = setup();
    const path = join(workspace(), 'a', 'b', 'c', 'copy.db');
    await expect(backup(context.db, path)).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('times itself', async () => {
    const context = setup();
    let clock = 1000;
    const result = await backup(context.db, join(workspace(), 'copy.db'), () => (clock += 25));
    expect(result.durationMs).toBe(25);
  });

  it('carries the rows across', async () => {
    const context = setup();
    const path = join(workspace(), 'copy.db');
    await backup(context.db, path);
    expect(verify(path).counts.customers).toBe(1);
  });
});

describe('verify', () => {
  it('is happy with a good copy', async () => {
    const context = setup();
    const path = join(workspace(), 'copy.db');
    await backup(context.db, path);
    const result = verify(path);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.pendingMigrations).toBe(0);
  });

  it('reports a file that is not a database at all', () => {
    const path = join(workspace(), 'junk.db');
    writeFileSync(path, 'this is not a database', 'utf8');
    const result = verify(path);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/cannot open the copy|integrity/);
  });

  it('reports a file that is not there', () => {
    const result = verify(join(workspace(), 'missing.db'));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/cannot open the copy/);
  });

  it('reports a copy taken before the migrations ran', async () => {
    const empty = openMemoryDatabase();
    const path = join(workspace(), 'empty.db');
    await empty.backup(path);
    empty.close();
    const result = verify(path);
    expect(result.ok).toBe(false);
    expect(result.pendingMigrations).toBeGreaterThan(0);
    expect(result.problems.join(' ')).toMatch(/migrations have not been applied/);
  });

  it('counts every table it insists on being able to read', async () => {
    const context = setup();
    const path = join(workspace(), 'copy.db');
    await backup(context.db, path);
    const result = verify(path);
    for (const table of ['customers', 'tanks', 'deliveries', 'stations']) {
      expect(result.counts[table]).toBeGreaterThanOrEqual(0);
    }
  });
});
