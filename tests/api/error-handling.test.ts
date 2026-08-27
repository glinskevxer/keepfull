import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/service/context';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases, testDatabase } from '../support/db';
import { buildServer } from '../../src/api/server';
import { Logger, MemorySink } from '../../src/util/logger';

const servers: { close(): Promise<unknown> }[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
  await closeTestServers();
  closeTestDatabases();
});

const YARD = { latitude: 42.4432, longitude: -76.5019 };

/**
 * The paths a request takes when something has gone wrong. Every one of these
 * is a branch in the one error handler, and the reason they are worth pinning
 * down is that a caller's mistake and a defect of ours have to be told apart:
 * the first gets a useful message, the second gets nothing at all.
 */
function bare() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), { logger: new Logger({ sink, level: 'debug' }) });
  const app = buildServer({ context, yard: YARD });
  servers.push(app);
  return { app, sink };
}

describe('a caller getting it wrong', () => {
  it('is a four hundred for malformed json rather than a five hundred', async () => {
    const { app } = bare();
    const response = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).code).toBe('invalid_input');
  });

  it('is a four one three for a body past the limit', async () => {
    const sink = new MemorySink();
    const context = buildContext(testDatabase(), { logger: new Logger({ sink, level: 'error' }) });
    const app = buildServer({ context, yard: YARD, bodyLimitBytes: 128 });
    servers.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(500) }),
    });
    expect(response.statusCode).toBe(413);
  });

  it('is a four oh four with the method and path on a route that is not there', async () => {
    const { app } = bare();
    const response = await call<{ message: string }>(app, 'POST', '/nowhere', {});
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('nothing at POST /nowhere');
  });
});

describe('a defect of ours', () => {
  it('tells the caller nothing and puts the real thing in the log', async () => {
    const sink = new MemorySink();
    const context = buildContext(testDatabase(), { logger: new Logger({ sink, level: 'debug' }) });
    const app = buildServer({ context, yard: YARD });
    app.get('/boom', async () => {
      throw new TypeError('cannot read property serial of undefined');
    });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { code: string; message: string };
    expect(body.code).toBe('internal');
    expect(body.message).not.toMatch(/serial/);

    const logged = sink.at('error').find((record) => record.msg === 'request failed');
    expect(String(logged?.error)).toMatch(/cannot read property serial/);
  });

  it('logs nothing at error level for a caller mistake', async () => {
    const { app, sink } = bare();
    await call(app, 'GET', '/customers/c-nope');
    expect(sink.at('error')).toEqual([]);
  });
});

describe('the response every failure carries', () => {
  it('keeps the domain detail so a screen can point at the field', async () => {
    const scenario = buildScenario({ today: '2026-08-27' });
    const app = testServer(scenario.context);
    const response = await call<{ code: string; detail: Record<string, unknown> }>(
      app,
      'GET',
      '/tanks/t-nope',
    );
    expect(response.body.code).toBe('not_found');
    expect(response.body.detail.id).toBe('t-nope');
  });

  it('carries the field list on a validation failure', async () => {
    const scenario = buildScenario({ today: '2026-08-27' });
    const app = testServer(scenario.context);
    const response = await call<{ problems: { field: string }[] }>(app, 'POST', '/tanks', {
      customerId: scenario.customer.id,
      serialNumber: '',
      waterCapacity: 400,
      owner: 'company',
      installedOn: 'soon',
    });
    expect(response.status).toBe(400);
    expect(response.body.problems.map((problem) => problem.field).sort()).toEqual([
      'installedOn',
      'serialNumber',
      'waterCapacity',
    ]);
  });

  it('counts a failure in the metrics like any other response', async () => {
    const scenario = buildScenario({ today: '2026-08-27' });
    const app = testServer(scenario.context);
    await call(app, 'GET', '/tanks/t-nope');
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toMatch(/route="\/tanks\/:id",status="404"/);
  });
});
