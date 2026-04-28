import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, makeKeyRecord } from '../../src/api/auth';
import { buildContext } from '../../src/service/context';
import { buildServer } from '../../src/api/server';
import { closeTestDatabases, testDatabase } from '../support/db';
import { Logger, MemorySink } from '../../src/util/logger';

const KEY = 'office-key-that-is-long-enough';
const servers: { close(): Promise<unknown> }[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
  closeTestDatabases();
});

function setup(requestsPerMinute: number) {
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink: new MemorySink(), level: 'error' }),
  });
  const app = buildServer({
    context,
    yard: { latitude: 42.4432, longitude: -76.5019 },
    keyRing: new KeyRing([makeKeyRecord('office', 'admin', KEY)]),
    requestsPerMinute,
  });
  servers.push(app);
  return app;
}

const headers = { authorization: `Bearer ${KEY}` };

describe('the limiter in front of the api', () => {
  it('lets requests through up to the limit', async () => {
    const app = setup(2);
    expect((await app.inject({ method: 'GET', url: '/customers', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/customers', headers })).statusCode).toBe(200);
  });

  it('turns the next one away with a retry after', async () => {
    const app = setup(1);
    await app.inject({ method: 'GET', url: '/customers', headers });
    const response = await app.inject({ method: 'GET', url: '/customers', headers });
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(JSON.parse(response.body).message).toMatch(/slow down/);
  });

  it('reports what is left on every response', async () => {
    const app = setup(3);
    const response = await app.inject({ method: 'GET', url: '/customers', headers });
    expect(response.headers['x-ratelimit-remaining']).toBe('2');
    expect(Number(response.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('never limits the health endpoints', async () => {
    const app = setup(1);
    await app.inject({ method: 'GET', url: '/customers', headers });
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('is off entirely when nothing is configured', async () => {
    const context = buildContext(testDatabase(), {
      logger: new Logger({ sink: new MemorySink(), level: 'error' }),
    });
    const app = buildServer({
      context,
      yard: { latitude: 42.4432, longitude: -76.5019 },
      keyRing: new KeyRing([makeKeyRecord('office', 'admin', KEY)]),
    });
    servers.push(app);
    for (let index = 0; index < 20; index += 1) {
      expect((await app.inject({ method: 'GET', url: '/customers', headers })).statusCode).toBe(
        200,
      );
    }
  });
});
