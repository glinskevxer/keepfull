import { afterEach, describe, expect, it } from 'vitest';
import { createServer, Server } from 'node:http';
import { probe } from '../../src/health-probe';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop() as Server;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function serve(handler: (status: number) => number, body = '{}'): Promise<number> {
  const server = createServer((_request, response) => {
    response.statusCode = handler(200);
    response.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

describe('probe', () => {
  it('is happy with a two hundred', async () => {
    const port = await serve(() => 200);
    await expect(probe(port)).resolves.toBe(0);
  });

  it('fails on a service unavailable', async () => {
    const port = await serve(() => 503);
    await expect(probe(port)).resolves.toBe(1);
  });

  it('fails when nothing is listening', async () => {
    await expect(probe(1)).resolves.toBe(1);
  });

  it('drains the body rather than leaving the socket open', async () => {
    const port = await serve(() => 200, JSON.stringify({ status: 'ready' }).repeat(500));
    await expect(probe(port)).resolves.toBe(0);
  });
});
