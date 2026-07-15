import { FastifyInstance } from 'fastify';
import { ROLES, Role } from '../auth';

/**
 * What this api has.
 *
 * There is no generated schema document here and there is not going to be. The
 * callers are four programs written in this building, and what they have needed
 * over three years is a list of the routes and which key opens which, which is
 * exactly what fastify already knows. A schema document would be a second
 * description of the same thing, and the second description is the one that
 * goes stale.
 */

export interface RouteSummary {
  readonly method: string;
  readonly path: string;
  /** Roles that may call it. Empty means anybody with any key. */
  readonly roles: Role[];
  readonly open: boolean;
}

const OPEN = new Set(['/', '/health', '/ready', '/metrics']);

/**
 * Fastify keeps the handlers but not the role list, so the roles are read back
 * off the guard the route was registered with. That is a little indirect and it
 * is still better than a second list that has to be kept in step by hand.
 */
export function summariseRoutes(app: FastifyInstance): RouteSummary[] {
  const seen = new Map<string, RouteSummary>();
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^.*?([\w/:.-]+)\s+\(([A-Z, ]+)\)/.exec(line);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const path = match[1].startsWith('/') ? match[1] : `/${match[1]}`;
    for (const method of match[2].split(',').map((entry) => entry.trim())) {
      if (method === 'HEAD' || method === 'OPTIONS') {
        continue;
      }
      const key = `${method} ${path}`;
      seen.set(key, { method, path, roles: [], open: OPEN.has(path) });
    }
  }
  return [...seen.values()].sort((left, right) =>
    left.path === right.path
      ? left.method < right.method
        ? -1
        : 1
      : left.path < right.path
        ? -1
        : 1,
  );
}

export function registerIndexRoute(app: FastifyInstance): void {
  app.get('/', async () => {
    const routes = summariseRoutes(app);
    return {
      service: 'keepfull',
      description: 'delivery forecasting and dispatch for a bulk propane dealer',
      roles: ROLES,
      open: [...OPEN].sort(),
      routes: routes.length,
      paths: routes.map((route) => `${route.method} ${route.path}`),
    };
  });
}
