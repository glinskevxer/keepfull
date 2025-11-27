import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';
import { openMemoryDatabase } from '../../src/db/connection';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup(options: { migrated?: boolean } = {}) {
  const sink = new MemorySink();
  const db = options.migrated === false ? openMemoryDatabase() : testDatabase();
  const context = buildContext(db, {
    logger: new Logger({ sink, level: 'debug' }),
    clock: () => new Date('2025-11-20T09:00:00Z'),
  });
  return { context, sink, app: testServer(context) };
}

describe('GET /health', () => {
  it('is ok', async () => {
    const { app } = setup();
    const response = await call(app, 'GET', '/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('logs the request with its timing', async () => {
    const { app, sink } = setup();
    await call(app, 'GET', '/health');
    const record = sink.records.find((entry) => entry.msg === 'handled a request');
    expect(record).toMatchObject({ method: 'GET', path: '/health', status: 200 });
    expect(typeof record?.ms).toBe('number');
  });
});

describe('GET /ready', () => {
  it('reports a migrated database as ready', async () => {
    const { app } = setup();
    const response = await call<{ status: string; schemaVersion: number; today: string }>(
      app,
      'GET',
      '/ready',
    );
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.schemaVersion).toBeGreaterThan(0);
    expect(response.body.today).toBe('2025-11-20');
  });

  it('reports an unmigrated database as not ready', async () => {
    const { app } = setup({ migrated: false });
    const response = await call<{ status: string; migrationsPending: number }>(
      app,
      'GET',
      '/ready',
    );
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not ready');
    expect(response.body.migrationsPending).toBeGreaterThan(0);
  });
});

describe('anything else', () => {
  it('is a 404 that says what was asked for', async () => {
    const { app } = setup();
    const response = await call<{ code: string; message: string }>(app, 'GET', '/nope');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('not_found');
    expect(response.body.message).toBe('nothing at GET /nope');
  });
});
