import Fastify, { FastifyInstance } from 'fastify';
import { AppContext } from '../service/context';
import { bodyFor, statusFor } from './errors';
import { KeyRing, authenticate } from './auth';
import { describeError } from '../core/errors';
import { registerCustomerRoutes } from './routes/customers';
import { registerHealthRoutes } from './routes/health';
import { registerTankRoutes } from './routes/tanks';

/**
 * The http server.
 *
 * This is a small internal api. It is reached by the office screens, by the
 * handhelds over the yard wifi, and by the tank monitor vendor pushing readings
 * in. It is not on the public internet and it never will be, which is why the
 * authentication is an api key per caller rather than anything with a login.
 */

export interface ServerOptions {
  readonly context: AppContext;
  /** Keys that may reach anything but the health endpoints. */
  readonly keyRing?: KeyRing;
  /** Turns fastify's own logging on. Off by default because we log our own. */
  readonly requestLogging?: boolean;
  readonly bodyLimitBytes?: number;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const { context } = options;
  const app = Fastify({
    logger: options.requestLogging ?? false,
    bodyLimit: options.bodyLimitBytes ?? 1_048_576,
    disableRequestLogging: true,
  });

  app.addHook('onRequest', async (request) => {
    request.startedAt = Date.now();
  });

  if (options.keyRing) {
    app.addHook('onRequest', authenticate(options.keyRing));
  }

  app.addHook('onResponse', async (request, reply) => {
    context.logger.info('handled a request', {
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      caller: request.caller?.name ?? null,
      ms: Date.now() - (request.startedAt ?? Date.now()),
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      code: 'not_found',
      message: `nothing at ${request.method} ${request.url}`,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const status = statusFor(error);
    if (status >= 500) {
      context.logger.error('request failed', {
        method: request.method,
        path: request.url,
        error: describeError(error),
      });
    }
    // Fastify raises its own errors for malformed json and oversized bodies,
    // and those are the caller's fault rather than ours.
    if (status === 500 && typeof error.statusCode === 'number' && error.statusCode < 500) {
      reply.code(error.statusCode).send({ code: 'invalid_input', message: error.message });
      return;
    }
    reply.code(status).send(bodyFor(error));
  });

  registerHealthRoutes(app, context);
  registerCustomerRoutes(app, context);
  registerTankRoutes(app, context);
  return app;
}

declare module 'fastify' {
  interface FastifyRequest {
    startedAt?: number;
  }
}
