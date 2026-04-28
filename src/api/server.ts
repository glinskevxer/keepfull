import Fastify, { FastifyInstance } from 'fastify';
import { AppContext } from '../service/context';
import { bodyFor, statusFor } from './errors';
import { KeyRing, authenticate } from './auth';
import { RateLimiter, rateLimit } from './rate-limit';
import { requestId } from './request-id';
import { describeError } from '../core/errors';
import { registerBudgetRoutes } from './routes/budgets';
import { registerCustomerRoutes } from './routes/customers';
import { registerDispatchRoutes } from './routes/dispatch';
import { registerDeliveryRoutes } from './routes/deliveries';
import { registerFleetRoutes } from './routes/fleet';
import { registerForecastRoutes } from './routes/forecasts';
import { registerHealthRoutes } from './routes/health';
import { registerLoadRoutes } from './routes/loads';
import { registerOfficeRoutes } from './routes/office';
import { registerReportRoutes } from './routes/reports';
import { registerSizingRoutes } from './routes/sizing';
import { registerTankRoutes } from './routes/tanks';
import { registerWeatherRoutes } from './routes/weather';

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
  /** Where the trucks start from. Dispatch cannot plan without it. */
  readonly yard: { latitude: number; longitude: number };
  /** Requests one caller may make a minute. Off when absent. */
  readonly requestsPerMinute?: number;
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

  app.addHook('onRequest', requestId(context.ids));

  app.addHook('onRequest', async (request) => {
    request.startedAt = Date.now();
  });

  if (options.keyRing) {
    app.addHook('onRequest', authenticate(options.keyRing));
  }

  if (options.requestsPerMinute !== undefined) {
    const limiter = new RateLimiter({ limit: options.requestsPerMinute, windowMs: 60_000 });
    app.addHook('onRequest', rateLimit(limiter));
    // Sweeping on an interval rather than on every request keeps the hot path
    // free of it. The handle is unrefed so it never holds the process open.
    const sweep = setInterval(() => limiter.sweep(), 60_000);
    sweep.unref();
    app.addHook('onClose', async () => {
      clearInterval(sweep);
    });
  }

  app.addHook('onResponse', async (request, reply) => {
    context.logger.info('handled a request', {
      requestId: request.requestId ?? null,
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
      ...(request.requestId ? { detail: { requestId: request.requestId } } : {}),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const status = statusFor(error);
    if (status >= 500) {
      context.logger.error('request failed', {
        requestId: request.requestId ?? null,
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
    const body = bodyFor(error);
    reply
      .code(status)
      .send(
        request.requestId
          ? { ...body, detail: { ...(body.detail ?? {}), requestId: request.requestId } }
          : body,
      );
  });

  registerHealthRoutes(app, context);
  registerCustomerRoutes(app, context);
  registerTankRoutes(app, context);
  registerDeliveryRoutes(app, context);
  registerForecastRoutes(app, context);
  registerDispatchRoutes(app, context, options.yard);
  registerWeatherRoutes(app, context);
  registerFleetRoutes(app, context);
  registerOfficeRoutes(app, context);
  registerReportRoutes(app, context);
  registerSizingRoutes(app, context);
  registerLoadRoutes(app, context);
  registerBudgetRoutes(app, context);
  return app;
}

declare module 'fastify' {
  interface FastifyRequest {
    startedAt?: number;
  }
}
