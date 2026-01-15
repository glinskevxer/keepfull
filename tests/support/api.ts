import { AppContext } from '../../src/service/context';
import { FastifyInstance } from 'fastify';
import { KeyRing, makeKeyRecord } from '../../src/api/auth';
import { buildServer } from '../../src/api/server';

export const TEST_KEY = 'test-office-key-long-enough-here';

export const testKeyRing = new KeyRing([makeKeyRecord('tests', 'admin', TEST_KEY)]);

/** The plant, so route sequencing has somewhere to start. */
export const TEST_YARD = { latitude: 42.4432, longitude: -76.5019 };

const running: FastifyInstance[] = [];

export function testServer(context: AppContext): FastifyInstance {
  const app = buildServer({ context, keyRing: testKeyRing, yard: TEST_YARD });
  running.push(app);
  return app;
}

export async function closeTestServers(): Promise<void> {
  while (running.length > 0) {
    await (running.pop() as FastifyInstance).close();
  }
}

export interface JsonResponse<T = unknown> {
  readonly status: number;
  readonly body: T;
}

/** Fastify can serve a request without a socket, which is all the tests need. */
export async function call<T = unknown>(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse<T>> {
  const response = await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TEST_KEY}`,
      ...headers,
    },
  });
  const text = response.body;
  return {
    status: response.statusCode,
    body: (text.length > 0 ? JSON.parse(text) : undefined) as T,
  };
}
