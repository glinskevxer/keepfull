import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, makeKeyRecord, requireRole } from '../../src/api/auth';
import { buildContext } from '../../src/service/context';
import { buildServer } from '../../src/api/server';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';

const OFFICE_KEY = 'office-key-that-is-long-enough';
const DRIVER_KEY = 'driver-key-that-is-long-enough';

const servers: { close(): Promise<unknown> }[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
  closeTestDatabases();
});

function setup() {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
  });
  const app = buildServer({
    context,
    keyRing: new KeyRing([
      makeKeyRecord('office screens', 'office', OFFICE_KEY),
      makeKeyRecord('handhelds', 'driver', DRIVER_KEY),
    ]),
  });
  app.get('/office-only', { preHandler: requireRole('office') }, async () => ({ ok: true }));
  app.get('/anyone', async (request) => ({ caller: request.caller?.name }));
  servers.push(app);
  return { app, sink };
}

describe('the key check', () => {
  it('lets the health endpoints through with no key', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('refuses anything else without a key', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'GET', url: '/anyone' });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).message).toBe('that key is not one of ours');
  });

  it('accepts a bearer token', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/anyone',
      headers: { authorization: `Bearer ${OFFICE_KEY}` },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).caller).toBe('office screens');
  });

  it('accepts the header the monitor vendor sends', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/anyone',
      headers: { 'x-api-key': DRIVER_KEY },
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a key that is not ours', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/anyone',
      headers: { authorization: 'Bearer not-a-key-but-long-enough' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('still checks the key when there is a query string', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/anyone?x=1' })).statusCode).toBe(401);
  });

  it('names the caller in the log line', async () => {
    const { app, sink } = setup();
    await app.inject({
      method: 'GET',
      url: '/anyone',
      headers: { authorization: `Bearer ${OFFICE_KEY}` },
    });
    expect(sink.records.find((r) => r.msg === 'handled a request')?.caller).toBe('office screens');
  });
});

describe('requireRole', () => {
  it('lets the right role through', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/office-only',
      headers: { authorization: `Bearer ${OFFICE_KEY}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('turns the wrong role away with the path in the message', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'GET',
      url: '/office-only',
      headers: { authorization: `Bearer ${DRIVER_KEY}` },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).message).toBe('not allowed to get /office-only');
  });
});
