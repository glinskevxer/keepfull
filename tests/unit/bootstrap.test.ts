import { afterEach, describe, expect, it } from 'vitest';
import { boot } from '../../src/bootstrap';
import { currentVersion } from '../../src/db/migrate';
import { loadSettings } from '../../src/config/env';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../../src/bootstrap';
import { tableNames } from '../../src/db/connection';

const cleanup: { runtime?: Runtime; dir: string }[] = [];

afterEach(() => {
  while (cleanup.length > 0) {
    const entry = cleanup.pop();
    entry?.runtime?.shutdown();
    if (entry) {
      rmSync(entry.dir, { recursive: true, force: true });
    }
  }
});

function settingsIn(dir: string) {
  return loadSettings({
    YARD_LATITUDE: '42.4432',
    YARD_LONGITUDE: '-76.5019',
    DATABASE_PATH: join(dir, 'nested', 'keepfull.db'),
    LOG_LEVEL: 'error',
  } as NodeJS.ProcessEnv);
}

describe('boot', () => {
  it('creates the directory and migrates on a fresh file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keepfull-'));
    const runtime = boot(settingsIn(dir));
    cleanup.push({ runtime, dir });
    expect(tableNames(runtime.db)).toContain('customers');
    expect(currentVersion(runtime.db)).toBeGreaterThan(0);
  });

  it('is happy to boot twice against the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keepfull-'));
    const settings = settingsIn(dir);
    const first = boot(settings);
    const version = currentVersion(first.db);
    first.shutdown();
    const second = boot(settings);
    cleanup.push({ runtime: second, dir });
    expect(currentVersion(second.db)).toBe(version);
  });

  it('can be told not to migrate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keepfull-'));
    const runtime = boot(settingsIn(dir), { skipMigrations: true });
    cleanup.push({ runtime, dir });
    expect(tableNames(runtime.db)).not.toContain('customers');
  });

  it('hands back a context wired to the same database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keepfull-'));
    const runtime = boot(settingsIn(dir));
    cleanup.push({ runtime, dir });
    expect(runtime.context.db).toBe(runtime.db);
    expect(runtime.context.customers.list()).toEqual([]);
  });

  it('takes an injected clock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keepfull-'));
    const runtime = boot(settingsIn(dir), { clock: () => new Date('2026-03-01T00:00:00Z') });
    cleanup.push({ runtime, dir });
    expect(runtime.context.clock().toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('shuts the database down and stays safe if asked twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keepfull-'));
    const runtime = boot(settingsIn(dir));
    runtime.shutdown();
    expect(() => runtime.shutdown()).not.toThrow();
    cleanup.push({ dir });
  });
});
