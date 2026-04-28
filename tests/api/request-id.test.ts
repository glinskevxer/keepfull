import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { IdFactory } from '../../src/util/ids';
import { Logger, MemorySink } from '../../src/util/logger';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    ids: new IdFactory({ now: () => 1_700_000_000_000 }, () => 0.5),
  });
  return { context, sink, app: testServer(context) };
}

describe('request ids', () => {
  it('makes one and puts it on the response', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toMatch(/^req_/);
  });

  it('keeps the one the caller sent', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'handheld-4471' },
    });
    expect(response.headers['x-request-id']).toBe('handheld-4471');
  });

  it('makes a fresh one when the caller sends something unusable', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'not a safe id' },
    });
    expect(response.headers['x-request-id']).toMatch(/^req_/);
  });

  it('puts the same id on the log line', async () => {
    const { app, sink } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'handheld-4471' },
    });
    expect(response.headers['x-request-id']).toBe('handheld-4471');
    const record = sink.records.find((entry) => entry.msg === 'handled a request');
    expect(record?.requestId).toBe('handheld-4471');
  });

  it('puts it in the body of a failure so a screenshot is enough to trace it', async () => {
    const { app } = setup();
    const response = await call<{ detail: { requestId: string } }>(
      app,
      'GET',
      '/customers/c-nope',
      undefined,
      { 'x-request-id': 'office-882' },
    );
    expect(response.status).toBe(404);
    expect(response.body.detail.requestId).toBe('office-882');
  });

  it('puts it in a not found body too', async () => {
    const { app } = setup();
    const response = await call<{ detail: { requestId: string } }>(app, 'GET', '/nope', undefined, {
      'x-request-id': 'office-883',
    });
    expect(response.body.detail.requestId).toBe('office-883');
  });

  it('leaves the rest of the failure body alone', async () => {
    const { app } = setup();
    const response = await call<{ code: string; message: string; detail: Record<string, unknown> }>(
      app,
      'GET',
      '/customers/c-nope',
    );
    expect(response.body.code).toBe('not_found');
    expect(response.body.detail.id).toBe('c-nope');
  });
});
